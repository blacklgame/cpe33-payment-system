const admin = require("firebase-admin");
const cloudinary = require("cloudinary").v2;
const crypto = require("crypto");
const { checkIsAdmin } = require("../_lib/admins");
const { rateLimit, clientIp } = require("../_lib/rate-limit");
const { writeAuditLog } = require("../_lib/audit");

/* ------------------------------------------------------------
   api/admin/events-api.js
   Consolidated Serverless Function for all Admin Event/Transaction CRUD
   operations, updated to implement Option A (Denormalized Totals) and
   support receipt photo attachments for income & expense transactions.

   All transaction mutations are executed inside Firestore transactions
   to keep the event totals in sync.
------------------------------------------------------------ */

if (!admin.apps.length) {
  const saJson = Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "",
    "base64"
  ).toString("utf8");
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saJson)) });
}

cloudinary.config({
  cloud_name: "egcc6hml",
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

module.exports = async function handler(req, res) {
  try {
    // 1. Rate limiting
    if (rateLimit(`events-api:${clientIp(req)}`, { limit: 120, windowMs: 60_000 }).limited) {
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

    const action = (req.query.action || req.body?.action || "").toLowerCase();
    const db = admin.firestore();

    // 3. Routing
    // --- GET ACTIONS ---
    if (req.method === "GET") {
      if (action === "list") {
        // --- List Events (Fetch events + monthly payment income) ---
        const [eventsSnap, monthlySnap] = await Promise.all([
          db.collection("events").orderBy("createdAt", "asc").get(),
          db.collectionGroup("months").get()
        ]);

        let monthlyIncomeTotal = 0;
        let monthlyPaidCount = 0;
        monthlySnap.docs.forEach((d) => {
          if (!d.ref.parent.parent) return; // skip top-level billing period doc definitions
          const data = d.data();
          const target = Number(data.targetAmount || data.amount || 0);
          const paidAmt = typeof data.paidAmount === "number" ? data.paidAmount : (data.paid ? target : 0);

          if (paidAmt > 0) {
            monthlyIncomeTotal += paidAmt;
            monthlyPaidCount += 1;
          }
        });

        const events = eventsSnap.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            name: data.name || "",
            emoji: data.emoji || "🎉",
            createdBy: data.createdBy || "",
            createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
            totalIncome: Number(data.totalIncome) || 0,
            totalExpense: Number(data.totalExpense) || 0,
            balance: (Number(data.totalIncome) || 0) - (Number(data.totalExpense) || 0),
            transactionCount: Number(data.transactionCount) || 0,
            transactions_income_count: Number(data.transactions_income_count) || 0,
            transactions_expense_count: Number(data.transactions_expense_count) || 0
          };
        });
        res.status(200).json({ events, monthlyIncomeTotal, monthlyPaidCount });
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
          let receipts = [];
          if (Array.isArray(d.receipts)) {
            receipts = d.receipts.filter((r) => r && typeof r.url === "string" && r.url.startsWith("https://"));
          } else if (d.receiptUrl) {
            receipts = [{ url: d.receiptUrl, publicId: d.receiptPublicId || null }];
          }

          return {
            id: doc.id,
            type: d.type,
            label: d.label || "",
            amount: d.amount || 0,
            quantity: d.quantity || 1,
            totalAmount: d.totalAmount || (d.amount * d.quantity),
            note: d.note || "",
            receipts,
            receiptUrl: receipts[0]?.url || d.receiptUrl || null,
            receiptPublicId: receipts[0]?.publicId || d.receiptPublicId || null,
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
      if (action === "sign-receipt-upload") {
        // --- Issue signed ticket for receipt image upload to Cloudinary ---
        const { eventId } = req.body || {};
        if (!eventId || typeof eventId !== "string") {
          res.status(400).json({ error: "eventId is required" });
          return;
        }

        const eventRef = db.collection("events").doc(eventId);
        const eventSnap = await eventRef.get();
        if (!eventSnap.exists) {
          res.status(404).json({ error: "Event not found" });
          return;
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const publicId = `events/${eventId}/receipts/${timestamp}_${crypto.randomBytes(8).toString("hex")}`;
        const paramsToSign = { overwrite: "false", public_id: publicId, timestamp };
        const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET);

        res.status(200).json({
          timestamp,
          signature,
          publicId,
          apiKey: process.env.CLOUDINARY_API_KEY,
          cloudName: "egcc6hml"
        });
        return;
      }

      if (action === "create") {
        // --- Create Event (Initialize totals at 0) ---
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
          totalIncome: 0,
          totalExpense: 0,
          transactionCount: 0,
          transactions_income_count: 0,
          transactions_expense_count: 0,
          createdBy: email,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        await writeAuditLog(db, "create_event", email, { eventId: ref.id, name: name.trim() });
        res.status(200).json({ ok: true, eventId: ref.id });
        return;
      }

      if (action === "add-transaction") {
        // --- Add Transaction (Uses Transaction to update Event totals) ---
        const { eventId, type, label, amount, quantity, note, receipts, receiptUrl, receiptPublicId } = req.body || {};
        if (!eventId || typeof eventId !== "string") {
          res.status(400).json({ error: "eventId is required" }); return;
        }
        if (type !== "income" && type !== "expense") {
          res.status(400).json({ error: "type must be 'income' or 'expense'" }); return;
        }
        if (!label || typeof label !== "string" || label.trim().length === 0) {
          res.status(400).json({ error: "label is required" }); return;
        }
        if (label.trim().length > 200) {
          res.status(400).json({ error: "label too long (max 200 characters)" }); return;
        }

        if (note !== undefined && typeof note === "string" && note.trim().length > 300) {
          res.status(400).json({ error: "note too long (max 300 characters)" }); return;
        }

        const amountNum = Number(amount);
        if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 10_000_000) {
          res.status(400).json({ error: "amount must be a positive number up to 10,000,000" }); return;
        }

        const qty = Number(quantity);
        const quantityNum = Number.isFinite(qty) && qty >= 1 ? Math.min(1000, Math.floor(qty)) : 1;
        const totalAmount = amountNum * quantityNum;

        let cleanReceipts = [];
        if (Array.isArray(receipts)) {
          cleanReceipts = receipts
            .filter((r) => r && typeof r.url === "string" && r.url.startsWith("https://"))
            .map((r) => ({ url: r.url.trim(), publicId: typeof r.publicId === "string" ? r.publicId.trim() : null }));
        } else if (typeof receiptUrl === "string" && receiptUrl.startsWith("https://")) {
          cleanReceipts = [{ url: receiptUrl.trim(), publicId: typeof receiptPublicId === "string" ? receiptPublicId.trim() : null }];
        }

        const eventRef = db.collection("events").doc(eventId);
        const newTxRef = eventRef.collection("transactions").doc();

        let finalTotalAmount = totalAmount;

        await db.runTransaction(async (transaction) => {
          const eventSnap = await transaction.get(eventRef);
          if (!eventSnap.exists) {
            throw new Error("Event not found");
          }

          const eventData = eventSnap.data();
          let totalIncome = Number(eventData.totalIncome) || 0;
          let totalExpense = Number(eventData.totalExpense) || 0;
          let transactionCount = Number(eventData.transactionCount) || 0;
          let transactions_income_count = Number(eventData.transactions_income_count) || 0;
          let transactions_expense_count = Number(eventData.transactions_expense_count) || 0;

          if (type === "income") {
            totalIncome += totalAmount;
            transactions_income_count++;
          } else {
            totalExpense += totalAmount;
            transactions_expense_count++;
          }
          transactionCount++;

          transaction.set(newTxRef, {
            type,
            label: label.trim(),
            amount: amountNum,
            quantity: quantityNum,
            totalAmount,
            note: typeof note === "string" ? note.trim() : "",
            receipts: cleanReceipts,
            receiptUrl: cleanReceipts[0]?.url || null,
            receiptPublicId: cleanReceipts[0]?.publicId || null,
            createdBy: email,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          transaction.update(eventRef, {
            totalIncome,
            totalExpense,
            transactionCount,
            transactions_income_count,
            transactions_expense_count,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });

        await writeAuditLog(db, "add_transaction", email, {
          eventId,
          txId: newTxRef.id,
          type,
          label: label.trim(),
          amount: amountNum,
          quantity: quantityNum,
          totalAmount: finalTotalAmount,
          receiptCount: cleanReceipts.length
        });

        res.status(200).json({ ok: true, txId: newTxRef.id, totalAmount: finalTotalAmount });
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
        // --- Update Transaction (Uses Transaction to re-calculate Event totals) ---
        const { eventId, txId, type, label, amount, quantity, note, receipts, receiptUrl, receiptPublicId, removeReceipt, deletedPublicIds } = req.body || {};
        if (!eventId || !txId) {
          res.status(400).json({ error: "eventId and txId are required" }); return;
        }
        if (note !== undefined && typeof note === "string" && note.trim().length > 300) {
          res.status(400).json({ error: "note too long (max 300 characters)" }); return;
        }

        const eventRef = db.collection("events").doc(eventId);
        const txRef = eventRef.collection("transactions").doc(txId);

        let finalTotalAmount = 0;
        const publicIdsToDestroy = Array.isArray(deletedPublicIds) ? [...deletedPublicIds] : [];

        await db.runTransaction(async (transaction) => {
          const eventSnap = await transaction.get(eventRef);
          const txSnap = await transaction.get(txRef);

          if (!eventSnap.exists) throw new Error("Event not found");
          if (!txSnap.exists) throw new Error("Transaction not found");

          const eventData = eventSnap.data();
          const txData = txSnap.data();

          let totalIncome = Number(eventData.totalIncome) || 0;
          let totalExpense = Number(eventData.totalExpense) || 0;
          let transactions_income_count = Number(eventData.transactions_income_count) || 0;
          let transactions_expense_count = Number(eventData.transactions_expense_count) || 0;

          // 1. Rollback old values from the event counters
          const oldTotalAmount = Number(txData.totalAmount) || (Number(txData.amount) * Number(txData.quantity));
          if (txData.type === "income") {
            totalIncome -= oldTotalAmount;
            transactions_income_count = Math.max(0, transactions_income_count - 1);
          } else {
            totalExpense -= oldTotalAmount;
            transactions_expense_count = Math.max(0, transactions_expense_count - 1);
          }

          // 2. Derive updated values
          const updatedType = (type === "income" || type === "expense") ? type : txData.type;
          const updatedAmount = amount !== undefined ? Number(amount) : txData.amount;
          const updatedQty = quantity !== undefined ? Math.floor(Number(quantity)) : txData.quantity;
          const newTotalAmount = updatedAmount * updatedQty;
          finalTotalAmount = newTotalAmount;

          // 3. Add new values to the event counters
          if (updatedType === "income") {
            totalIncome += newTotalAmount;
            transactions_income_count++;
          } else {
            totalExpense += newTotalAmount;
            transactions_expense_count++;
          }

          // 4. Update documents
          const txUpdates = {
            type: updatedType,
            amount: updatedAmount,
            quantity: updatedQty,
            totalAmount: newTotalAmount,
            updatedBy: email,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          };
          if (label !== undefined) txUpdates.label = label.trim();
          if (note !== undefined) txUpdates.note = note.trim();

          if (removeReceipt === true) {
            txUpdates.receipts = [];
            txUpdates.receiptUrl = null;
            txUpdates.receiptPublicId = null;
            if (txData.receiptPublicId) publicIdsToDestroy.push(txData.receiptPublicId);
            if (Array.isArray(txData.receipts)) {
              txData.receipts.forEach((r) => { if (r?.publicId) publicIdsToDestroy.push(r.publicId); });
            }
          } else if (Array.isArray(receipts)) {
            const cleanReceipts = receipts
              .filter((r) => r && typeof r.url === "string" && r.url.startsWith("https://"))
              .map((r) => ({ url: r.url.trim(), publicId: typeof r.publicId === "string" ? r.publicId.trim() : null }));
            txUpdates.receipts = cleanReceipts;
            txUpdates.receiptUrl = cleanReceipts[0]?.url || null;
            txUpdates.receiptPublicId = cleanReceipts[0]?.publicId || null;
          } else if (typeof receiptUrl === "string" && receiptUrl.startsWith("https://")) {
            const cleanReceipts = [{ url: receiptUrl.trim(), publicId: typeof receiptPublicId === "string" ? receiptPublicId.trim() : null }];
            txUpdates.receipts = cleanReceipts;
            txUpdates.receiptUrl = cleanReceipts[0].url;
            txUpdates.receiptPublicId = cleanReceipts[0].publicId;
          }

          transaction.update(txRef, txUpdates);
          transaction.update(eventRef, {
            totalIncome,
            totalExpense,
            transactions_income_count,
            transactions_expense_count,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });

        for (const pId of publicIdsToDestroy) {
          try {
            await cloudinary.uploader.destroy(pId, { resource_type: "image" });
          } catch (cErr) {
            console.warn("Cloudinary destroy warning:", cErr);
          }
        }

        await writeAuditLog(db, "update_transaction", email, { eventId, txId, label });
        res.status(200).json({ ok: true, totalAmount: finalTotalAmount });
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
        const publicIdsToDestroy = [];

        txSnap.docs.forEach((doc) => {
          const tData = doc.data();
          if (tData.receiptPublicId) {
            publicIdsToDestroy.push(tData.receiptPublicId);
          }
          if (Array.isArray(tData.receipts)) {
            tData.receipts.forEach((r) => {
              if (r?.publicId) publicIdsToDestroy.push(r.publicId);
            });
          }
          batch.delete(doc.ref);
        });
        batch.delete(eventRef);
        await batch.commit();

        for (const pId of publicIdsToDestroy) {
          try {
            await cloudinary.uploader.destroy(pId, { resource_type: "image" });
          } catch (cErr) {
            console.warn("Cloudinary destroy warning:", cErr);
          }
        }

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

        const eventRef = db.collection("events").doc(eventId);
        const txRef = eventRef.collection("transactions").doc(txId);
        const publicIdsToDestroy = [];

        await db.runTransaction(async (transaction) => {
          const eventSnap = await transaction.get(eventRef);
          const txSnap = await transaction.get(txRef);

          if (!eventSnap.exists) throw new Error("Event not found");
          if (!txSnap.exists) throw new Error("Transaction not found");

          const eventData = eventSnap.data();
          const txData = txSnap.data();

          let totalIncome = Number(eventData.totalIncome) || 0;
          let totalExpense = Number(eventData.totalExpense) || 0;
          let transactionCount = Number(eventData.transactionCount) || 0;
          let transactions_income_count = Number(eventData.transactions_income_count) || 0;
          let transactions_expense_count = Number(eventData.transactions_expense_count) || 0;

          const txTotalAmount = Number(txData.totalAmount) || (Number(txData.amount) * Number(txData.quantity));
          if (txData.type === "income") {
            totalIncome = Math.max(0, totalIncome - txTotalAmount);
            transactions_income_count = Math.max(0, transactions_income_count - 1);
          } else {
            totalExpense = Math.max(0, totalExpense - txTotalAmount);
            transactions_expense_count = Math.max(0, transactions_expense_count - 1);
          }
          transactionCount = Math.max(0, transactionCount - 1);

          if (txData.receiptPublicId) {
            publicIdsToDestroy.push(txData.receiptPublicId);
          }
          if (Array.isArray(txData.receipts)) {
            txData.receipts.forEach((r) => {
              if (r?.publicId) publicIdsToDestroy.push(r.publicId);
            });
          }

          transaction.delete(txRef);
          transaction.update(eventRef, {
            totalIncome,
            totalExpense,
            transactionCount,
            transactions_income_count,
            transactions_expense_count,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });

        for (const pId of publicIdsToDestroy) {
          try {
            await cloudinary.uploader.destroy(pId, { resource_type: "image" });
          } catch (cErr) {
            console.warn("Cloudinary destroy warning:", cErr);
          }
        }

        await writeAuditLog(db, "delete_transaction", email, { eventId, txId });
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
