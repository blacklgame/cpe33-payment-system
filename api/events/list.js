const admin = require("firebase-admin");
const { rateLimit, clientIp } = require("../_lib/rate-limit");

/* ------------------------------------------------------------
   GET /api/events/list
   Public (member) endpoint — returns all events with totals.
   Requires a valid Firebase ID token (any authenticated user),
   but does NOT require admin privileges.

   This gives CPE33 members a read-only view of all events and
   their income/expense/balance summaries.

   Returns: { events: [ { id, name, emoji, createdAt,
                           totalIncome, totalExpense, balance,
                           transactionCount } ] }
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
    if (rateLimit(`pub-list-events:${clientIp(req)}`, { limit: 60, windowMs: 60_000 }).limited) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) { res.status(401).json({ error: "Missing auth token" }); return; }

    // Any valid Firebase session — not admin-only
    await admin.auth().verifyIdToken(idToken);

    const db = admin.firestore();
    const eventsSnap = await db.collection("events").orderBy("createdAt", "asc").get();

    const events = await Promise.all(
      eventsSnap.docs.map(async (doc) => {
        const data = doc.data();
        const txSnap = await db
          .collection("events")
          .doc(doc.id)
          .collection("transactions")
          .get();

        let totalIncome = 0;
        let totalExpense = 0;
        const transactions = [];

        txSnap.forEach((tx) => {
          const t = tx.data();
          const amt = (Number(t.amount) || 0) * (Number(t.quantity) || 1);
          if (t.type === "income") totalIncome += amt;
          else if (t.type === "expense") totalExpense += amt;

          transactions.push({
            id: tx.id,
            type: t.type,
            label: t.label || "",
            amount: t.amount || 0,
            quantity: t.quantity || 1,
            totalAmount: t.totalAmount || amt,
            note: t.note || "",
            createdAt: t.createdAt ? t.createdAt.toDate().toISOString() : null
          });
        });

        return {
          id: doc.id,
          name: data.name || "",
          emoji: data.emoji || "🎉",
          createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
          totalIncome,
          totalExpense,
          balance: totalIncome - totalExpense,
          transactionCount: txSnap.size,
          transactions
        };
      })
    );

    res.status(200).json({ events });
  } catch (err) {
    console.error("pub-list-events failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
