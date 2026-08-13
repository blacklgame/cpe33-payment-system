const admin = require("firebase-admin");
const { checkIsAdmin } = require("../../_lib/admins");
const { rateLimit, clientIp } = require("../../_lib/rate-limit");

/* ------------------------------------------------------------
   GET /api/admin/events/get-transactions?eventId=xxx
   Returns all transactions for one event, ordered by createdAt asc.
   Admin only.

   Returns: { transactions: [ { id, type, label, amount, quantity,
                                totalAmount, note, createdBy, createdAt } ] }
------------------------------------------------------------ */

if (!admin.apps.length) {
  const saJson = Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "",
    "base64"
  ).toString("utf8");
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saJson)) });
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    if (rateLimit(`get-tx:${clientIp(req)}`, { limit: 60, windowMs: 60_000 }).limited) {
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

    const { eventId } = req.query || {};
    if (!eventId) {
      res.status(400).json({ error: "eventId query param is required" }); return;
    }

    const db = admin.firestore();
    const eventRef = db.collection("events").doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      res.status(404).json({ error: "Event not found" }); return;
    }

    const txSnap = await eventRef
      .collection("transactions")
      .orderBy("createdAt", "asc")
      .get();

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
  } catch (err) {
    console.error("get-transactions failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
