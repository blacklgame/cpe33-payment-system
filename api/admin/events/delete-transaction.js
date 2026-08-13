const admin = require("firebase-admin");
const { checkIsAdmin } = require("../../_lib/admins");
const { rateLimit, clientIp } = require("../../_lib/rate-limit");
const { writeAuditLog } = require("../../_lib/audit");

/* ------------------------------------------------------------
   DELETE /api/admin/events/delete-transaction
   Deletes a single transaction from an event.

   Body: { eventId: string, txId: string }
   Returns: { ok: true }
------------------------------------------------------------ */

if (!admin.apps.length) {
  const saJson = Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "",
    "base64"
  ).toString("utf8");
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saJson)) });
}

module.exports = async function handler(req, res) {
  if (req.method !== "DELETE") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    if (rateLimit(`delete-tx:${clientIp(req)}`, { limit: 30, windowMs: 60_000 }).limited) {
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

    const { eventId, txId } = req.body || {};
    if (!eventId || !txId) {
      res.status(400).json({ error: "eventId and txId are required" }); return;
    }

    const db = admin.firestore();
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
  } catch (err) {
    console.error("delete-transaction failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
