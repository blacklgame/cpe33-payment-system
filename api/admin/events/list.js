const admin = require("firebase-admin");
const { checkIsAdmin } = require("../../_lib/admins");
const { rateLimit, clientIp } = require("../../_lib/rate-limit");

/* ------------------------------------------------------------
   GET /api/admin/events/list
   Returns all events with pre-computed transaction summaries
   (totalIncome, totalExpense, balance, transactionCount).

   Admin only. Returns:
   { events: [ { id, name, emoji, createdBy, createdAt,
                 totalIncome, totalExpense, balance, transactionCount } ] }
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
    if (rateLimit(`list-events:${clientIp(req)}`, { limit: 60, windowMs: 60_000 }).limited) {
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

    const db = admin.firestore();
    const eventsSnap = await db.collection("events").orderBy("createdAt", "asc").get();

    const events = await Promise.all(
      eventsSnap.docs.map(async (doc) => {
        const data = doc.data();
        // Fetch all transactions for this event
        const txSnap = await db
          .collection("events")
          .doc(doc.id)
          .collection("transactions")
          .get();

        let totalIncome = 0;
        let totalExpense = 0;
        txSnap.forEach((tx) => {
          const t = tx.data();
          const amt = (Number(t.amount) || 0) * (Number(t.quantity) || 1);
          if (t.type === "income") totalIncome += amt;
          else if (t.type === "expense") totalExpense += amt;
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
          transactionCount: txSnap.size
        };
      })
    );

    res.status(200).json({ events });
  } catch (err) {
    console.error("list-events failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
