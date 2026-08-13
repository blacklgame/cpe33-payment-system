const admin = require("firebase-admin");
const { checkIsAdmin } = require("../../_lib/admins");
const { rateLimit, clientIp } = require("../../_lib/rate-limit");
const { writeAuditLog } = require("../../_lib/audit");

/* ------------------------------------------------------------
   PUT /api/admin/events/update-transaction
   Edit any field of an existing transaction.

   Body: {
     eventId: string,
     txId: string,
     type?: "income" | "expense",
     label?: string,
     amount?: number,
     quantity?: number,
     note?: string
   }
   Returns: { ok: true, totalAmount: number }
------------------------------------------------------------ */

if (!admin.apps.length) {
  const saJson = Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "",
    "base64"
  ).toString("utf8");
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saJson)) });
}

module.exports = async function handler(req, res) {
  if (req.method !== "PUT") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    if (rateLimit(`update-tx:${clientIp(req)}`, { limit: 60, windowMs: 60_000 }).limited) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) { res.status(401).json({ error: "Missing auth token" }); return; }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const email = (decoded.email || "").toLowerCase();
    if (!(await checkIsAdmin(email))) {
      res.status(403).json({ error: "Not an approved admin" });
      return;
    }

    const { eventId, txId, type, label, amount, quantity, note } = req.body || {};

    if (!eventId || !txId) {
      res.status(400).json({ error: "eventId and txId are required" }); return;
    }

    const db = admin.firestore();
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
      if (!Number.isFinite(a) || a <= 0 || a > 10_000_000) {
        res.status(400).json({ error: "Invalid amount" }); return;
      }
      updates.amount = a;
      newAmount = a;
    }
    if (quantity !== undefined) {
      const q = Math.floor(Number(quantity));
      if (!Number.isFinite(q) || q <= 0) {
        res.status(400).json({ error: "Invalid quantity" }); return;
      }
      updates.quantity = q;
      newQty = q;
    }

    updates.totalAmount = newAmount * newQty;
    if (typeof note === "string") updates.note = note.trim().slice(0, 300);

    await txRef.update(updates);
    await writeAuditLog(db, "update_transaction", email, { eventId, txId, updates });

    res.status(200).json({ ok: true, totalAmount: updates.totalAmount });
  } catch (err) {
    console.error("update-transaction failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
