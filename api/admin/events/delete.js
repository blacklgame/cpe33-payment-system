const admin = require("firebase-admin");
const { checkIsAdmin } = require("../../_lib/admins");
const { rateLimit, clientIp } = require("../../_lib/rate-limit");
const { writeAuditLog } = require("../../_lib/audit");

/* ------------------------------------------------------------
   DELETE /api/admin/events/delete
   Deletes an event and ALL its transactions (subcollection).

   Body: { eventId: string }
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
    if (rateLimit(`delete-event:${clientIp(req)}`, { limit: 10, windowMs: 60_000 }).limited) {
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

    const { eventId } = req.body || {};
    if (!eventId || typeof eventId !== "string") {
      res.status(400).json({ error: "eventId is required" });
      return;
    }

    const db = admin.firestore();
    const eventRef = db.collection("events").doc(eventId);
    const snap = await eventRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const eventName = snap.data().name || eventId;

    // Delete all transactions in the subcollection first
    const txSnap = await eventRef.collection("transactions").get();
    const batch = db.batch();
    txSnap.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(eventRef);
    await batch.commit();

    await writeAuditLog(db, "delete_event", email, { eventId, eventName, transactionsDeleted: txSnap.size });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("delete-event failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
