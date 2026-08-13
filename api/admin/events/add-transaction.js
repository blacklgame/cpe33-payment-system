const admin = require("firebase-admin");
const { checkIsAdmin } = require("../../_lib/admins");
const { rateLimit, clientIp } = require("../../_lib/rate-limit");
const { writeAuditLog } = require("../../_lib/audit");

/* ------------------------------------------------------------
   POST /api/admin/events/add-transaction
   Adds an income or expense transaction to an event.

   Body: {
     eventId: string,
     type: "income" | "expense",
     label: string,          ← item name (can include emoji)
     amount: number,         ← unit price
     quantity: number,       ← defaults to 1
     note: string            ← optional
   }
   Returns: { ok: true, txId: string, totalAmount: number }
------------------------------------------------------------ */

if (!admin.apps.length) {
  const saJson = Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "",
    "base64"
  ).toString("utf8");
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saJson)) });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    if (rateLimit(`add-tx:${clientIp(req)}`, { limit: 60, windowMs: 60_000 }).limited) {
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
    if (label.trim().length > 100) {
      res.status(400).json({ error: "label too long (max 100 chars)" }); return;
    }

    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 10_000_000) {
      res.status(400).json({ error: "amount must be a positive number" }); return;
    }

    const qty = Number(quantity);
    const quantityNum = Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;
    const totalAmount = amountNum * quantityNum;

    const db = admin.firestore();
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
  } catch (err) {
    console.error("add-transaction failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
