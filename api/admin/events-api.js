const admin = require("firebase-admin");
const { checkIsAdmin } = require("../_lib/admins");
const { rateLimit, clientIp } = require("../_lib/rate-limit");
const { writeAuditLog } = require("../_lib/audit");

/* ------------------------------------------------------------
   api/admin/events-api.js
   Consolidated Serverless Function for all Admin Event/Transaction CRUD
   operations to comply with Vercel's Hobby Plan limit of 12 serverless functions.

   Route actions are parsed from `req.query.action` or `req.body.action`.
------------------------------------------------------------ */

if (!admin.apps.length) {
  const saJson = Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "",
    "base64"
  ).toString("utf8");
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saJson)) });
}

module.exports = async function handler(req, res) {
  try {
    // 1. Rate limiting
    if (rateLimit(`events-api:${clientIp(req)}`, { limit: 100, windowMs: 60_000 }).limited) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    // 2. Auth check
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) {
      res.status(401).json({ error: "Missing auth token" });
      return;
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const email = (decoded.email || "").toLowerCase();
    if (!(await checkIsAdmin(email))) {
      res.status(403).json({ error: "Not an approved admin" });
      return;
    }

    // Determine action
    const action = (req.query.action || req.body?.action || "").toLowerCase();
    const db = admin.firestore();

    // 3. Routing
    // --- GET ACTIONS ---
    if (req.method === "GET") {
      if (action === "list") {
        // --- List Events ---
        const eventsSnap = await db.collection("events").orderBy("createdAt", "asc").get();
        const events = await Promise.all(
          eventsSnap.docs.map(async (doc) => {
            const data = doc.data();
            const txSnap = await db.collection("events").doc(doc.id).collection("transactions").get();

            let totalIncome = 0;
            let totalExpense = 0;
            let transactions_income_count = 0;
            let transactions_expense_count = 0;

            txSnap.forEach((tx) => {
              const t = tx.data();
              const amt = (Number(t.amount) || 0) * (Number(t.quantity) || 1);
              if (t.type === "income") {
                totalIncome += amt;
                transactions_income_count++;
              } else if (t.type === "expense") {
                totalExpense += amt;
                transactions_expense_count++;
              }
            });

            return {
              id: doc.id,
              name: data.name || "",
              emoji: data.emoji || "🎉",
              createdBy: data.createdBy || "",
              createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
              totalIncome,
              totalExpense,
              balance: totalIncome - totalExpense,
              transactionCount: txSnap.size,
              transactions_income_count,
              transactions_expense_count
            };
          })
        );
        res.status(200).json({ events });
        return;
      }

      if (action === "get-transactions") {
        // --- Get single event transactions ---
        const { eventId } = req.query;
        if (!eventId) {
          res.status(400).json({ error: "eventId query param is required" });
          return;
        }

        const eventRef = db.collection("events").doc(eventId);
        const eventSnap = await eventRef.get();
        if (!eventSnap.exists) {
          res.status(404).json({ error: "Event not found" });
          return;
        }

        const txSnap = await eventRef.collection("transactions").orderBy("createdAt", "asc").get();
        const transactions = txSnap.docs.map((doc) => {
          const d = doc.data();
          return {
            id: doc.id,
            type: d.type,
            label: d.label || "",
            amount: d.amount || 0,
            quantity: d.quantity || 1,
            totalAmount: d.totalAmount || (d.amount * d.quantity),
            note: d.note || "",
            createdBy: d.createdBy || "",
            createdAt: d.createdAt ? d.createdAt.toDate().toISOString() : null,
            updatedAt: d.updatedAt ? d.updatedAt.toDate().toISOString() : null
          };
        });

        const eventData = eventSnap.data();
        res.status(200).json({
          event: {
            id: eventId,
            name: eventData.name || "",
            emoji: eventData.emoji || "🎉",
            createdBy: eventData.createdBy || "",
            createdAt: eventData.createdAt ? eventData.createdAt.toDate().toISOString() : null
          },
          transactions
        });
        return;
      }

      res.status(400).json({ error: "Unknown GET action" });
      return;
    }

    // --- POST ACTIONS ---
    if (req.method === "POST") {
      if (action === "create") {
        // --- Create Event ---
        const { name, emoji } = req.body || {};
        if (!name || typeof name !== "string" || name.trim().length === 0) {
          res.status(400).json({ error: "Event name is required" });
          return;
        }
        if (name.trim().length > 100) {
          res.status(400).json({ error: "Event name too long" });
          return;
        }

        const ref = await db.collection("events").add({
          name: name.trim(),
          emoji: (typeof emoji === "string" ? emoji.trim() : "") || "🎉",
          createdBy: email,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        await writeAuditLog(db, "create_event", email, { eventId: ref.id, name: name.trim() });
        res.status(200).json({ ok: true, eventId: ref.id });
        return;
      }

      if (action === "add-transaction") {
        // --- Add Transaction ---
        const { eventId, type, label, amount, quantity, note } = req.body || {};
        if (!eventId || typeof eventId !== "string") {
          res.status(400).json({ error: "eventId is required" }); return;
        }
        if (type !== "income" && type !== "expense") {
          res.status(400).json({ error: "type must be 'income' or 'expense'" }); return;
        }
        if (!label || typeof label !== "string" || label.trim().length === 0) {
          res.status(400).json({ error: "label is required" }); return;
        }

        const amountNum = Number(amount);
        if (!Number.isFinite(amountNum) || amountNum <= 0) {
          res.status(400).json({ error: "amount must be a positive number" }); return;
        }

        const qty = Number(quantity);
        const quantityNum = Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;
        const totalAmount = amountNum * quantityNum;

        const eventRef = db.collection("events").doc(eventId);
        const snap = await eventRef.get();
        if (!snap.exists) {
          res.status(404).json({ error: "Event not found" }); return;
        }

        const txRef = await eventRef.collection("transactions").add({
          type,
          label: label.trim(),
          amount: amountNum,
          quantity: quantityNum,
          totalAmount,
          note: typeof note === "string" ? note.trim().slice(0, 300) : "",
          createdBy: email,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        await writeAuditLog(db, "add_transaction", email, {
          eventId,
          txId: txRef.id,
          type,
          label: label.trim(),
          amount: amountNum,
          quantity: quantityNum,
          totalAmount
        });

        res.status(200).json({ ok: true, txId: txRef.id, totalAmount });
        return;
      }

      res.status(400).json({ error: "Unknown POST action" });
      return;
    }

    // --- PUT ACTIONS ---
    if (req.method === "PUT") {
      if (action === "update") {
        // --- Update Event ---
        const { eventId, name, emoji } = req.body || {};
        if (!eventId || typeof eventId !== "string") {
          res.status(400).json({ error: "eventId is required" });
          return;
        }

        const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: email };
        if (typeof name === "string" && name.trim().length > 0) {
          if (name.trim().length > 100) { res.status(400).json({ error: "Name too long" }); return; }
          updates.name = name.trim();
        }
        if (typeof emoji === "string") {
          updates.emoji = emoji.trim() || "🎉";
        }

        const ref = db.collection("events").doc(eventId);
        const snap = await ref.get();
        if (!snap.exists) {
          res.status(404).json({ error: "Event not found" });
          return;
        }

        await ref.update(updates);
        await writeAuditLog(db, "update_event", email, { eventId, updates });
        res.status(200).json({ ok: true });
        return;
      }

      if (action === "update-transaction") {
        // --- Update Transaction ---
        const { eventId, txId, type, label, amount, quantity, note } = req.body || {};
        if (!eventId || !txId) {
          res.status(400).json({ error: "eventId and txId are required" }); return;
        }

        const txRef = db.collection("events").doc(eventId).collection("transactions").doc(txId);
        const snap = await txRef.get();
        if (!snap.exists) {
          res.status(404).json({ error: "Transaction not found" }); return;
        }

        const current = snap.data();
        const updates = {
          updatedBy: email,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (type === "income" || type === "expense") updates.type = type;
        if (typeof label === "string" && label.trim().length > 0) {
          if (label.trim().length > 100) { res.status(400).json({ error: "label too long" }); return; }
          updates.label = label.trim();
        }

        let newAmount = current.amount;
        let newQty = current.quantity;

        if (amount !== undefined) {
          const a = Number(amount);
          if (!Number.isFinite(a) || a <= 0) { res.status(400).json({ error: "Invalid amount" }); return; }
          updates.amount = a;
          newAmount = a;
        }
        if (quantity !== undefined) {
          const q = Math.floor(Number(quantity));
          if (!Number.isFinite(q) || q <= 0) { res.status(400).json({ error: "Invalid quantity" }); return; }
          updates.quantity = q;
          newQty = q;
        }

        updates.totalAmount = newAmount * newQty;
        if (typeof note === "string") updates.note = note.trim().slice(0, 300);

        await txRef.update(updates);
        await writeAuditLog(db, "update_transaction", email, { eventId, txId, updates });

        res.status(200).json({ ok: true, totalAmount: updates.totalAmount });
        return;
      }

      res.status(400).json({ error: "Unknown PUT action" });
      return;
    }

    // --- DELETE ACTIONS ---
    if (req.method === "DELETE") {
      if (action === "delete") {
        // --- Delete Event ---
        const { eventId } = req.body || {};
        if (!eventId || typeof eventId !== "string") {
          res.status(400).json({ error: "eventId is required" });
          return;
        }

        const eventRef = db.collection("events").doc(eventId);
        const snap = await eventRef.get();
        if (!snap.exists) {
          res.status(404).json({ error: "Event not found" });
          return;
        }

        const eventName = snap.data().name || eventId;
        const txSnap = await eventRef.collection("transactions").get();
        const batch = db.batch();
        txSnap.docs.forEach((doc) => batch.delete(doc.ref));
        batch.delete(eventRef);
        await batch.commit();

        await writeAuditLog(db, "delete_event", email, { eventId, eventName, transactionsDeleted: txSnap.size });
        res.status(200).json({ ok: true });
        return;
      }

      if (action === "delete-transaction") {
        // --- Delete Transaction ---
        const { eventId, txId } = req.body || {};
        if (!eventId || !txId) {
          res.status(400).json({ error: "eventId and txId are required" }); return;
        }

        const txRef = db.collection("events").doc(eventId).collection("transactions").doc(txId);
        const snap = await txRef.get();
        if (!snap.exists) {
          res.status(404).json({ error: "Transaction not found" }); return;
        }

        const txData = snap.data();
        await txRef.delete();
        await writeAuditLog(db, "delete_transaction", email, {
          eventId,
          txId,
          label: txData.label,
          type: txData.type,
          totalAmount: txData.totalAmount
        });

        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: "Unknown DELETE action" });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Events consolidated API failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
