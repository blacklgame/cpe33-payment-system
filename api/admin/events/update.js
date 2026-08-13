const admin = require("firebase-admin");
const { checkIsAdmin } = require("../../_lib/admins");
const { rateLimit, clientIp } = require("../../_lib/rate-limit");
const { writeAuditLog } = require("../../_lib/audit");

/* ------------------------------------------------------------
   PUT /api/admin/events/update
   Updates an event's name and/or emoji.

   Body: { eventId: string, name?: string, emoji?: string }
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
  if (req.method !== "PUT") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    if (rateLimit(`update-event:${clientIp(req)}`, { limit: 30, windowMs: 60_000 }).limited) {
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

    const { eventId, name, emoji } = req.body || {};
    if (!eventId || typeof eventId !== "string") {
      res.status(400).json({ error: "eventId is required" });
      return;
    }

    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: email };
    if (typeof name === "string" && name.trim().length > 0) {
      if (name.trim().length > 100) {
        res.status(400).json({ error: "Name too long" });
        return;
      }
      updates.name = name.trim();
    }
    if (typeof emoji === "string") {
      updates.emoji = emoji.trim() || "🎉";
    }

    const db = admin.firestore();
    const ref = db.collection("events").doc(eventId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    await ref.update(updates);
    await writeAuditLog(db, "update_event", email, { eventId, updates });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("update-event failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
