const admin = require("firebase-admin");
const { checkIsAdmin } = require("../../_lib/admins");
const { rateLimit, clientIp } = require("../../_lib/rate-limit");
const { writeAuditLog } = require("../../_lib/audit");

/* ------------------------------------------------------------
   POST /api/admin/events/create
   Creates a new event with a name and emoji.

   Body: { name: string, emoji: string }
   Returns: { ok: true, eventId: string }
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
    if (rateLimit(`create-event:${clientIp(req)}`, { limit: 30, windowMs: 60_000 }).limited) {
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

    const { name, emoji } = req.body || {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Event name is required" });
      return;
    }
    if (name.trim().length > 100) {
      res.status(400).json({ error: "Event name too long (max 100 chars)" });
      return;
    }

    const db = admin.firestore();
    const ref = await db.collection("events").add({
      name: name.trim(),
      emoji: (typeof emoji === "string" ? emoji.trim() : "") || "🎉",
      createdBy: email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await writeAuditLog(db, "create_event", email, { eventId: ref.id, name: name.trim() });

    res.status(200).json({ ok: true, eventId: ref.id });
  } catch (err) {
    console.error("create-event failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
