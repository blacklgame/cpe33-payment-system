const admin = require("firebase-admin");
const { rateLimit, clientIp } = require("../_lib/rate-limit");

/* ------------------------------------------------------------
   GET /api/events/list
   Public (member) endpoint — returns all events with totals.
   Optimized to use a single Collection Group Query to avoid the N+1 database reads.
   Also utilizes Vercel Edge caching to keep latency under 20ms for most users.

   Returns: { events: [ { id, name, emoji, createdAt,
                           totalIncome, totalExpense, balance,
                           transactionCount, transactions } ] }
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
    if (rateLimit(`pub-list-events:${clientIp(req)}`, { limit: 100, windowMs: 60_000 }).limited) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) { res.status(401).json({ error: "Missing auth token" }); return; }

    // Any valid Firebase session — not admin-only
    await admin.auth().verifyIdToken(idToken);

    // Set Edge Cache Headers: Cache for 5s, background revalidation for up to 60s
    res.setHeader("Cache-Control", "public, max-age=5, s-maxage=60, stale-while-revalidate=30");

    const db = admin.firestore();
    const [eventsSnap, txSnap, monthlySnap] = await Promise.all([
      db.collection("events").orderBy("createdAt", "asc").get(),
      db.collectionGroup("transactions").get(),
      db.collectionGroup("months").get()
    ]);

    let monthlyIncomeTotal = 0;
    let monthlyPaidCount = 0;
    monthlySnap.docs.forEach((d) => {
      if (!d.ref.parent.parent) return; // skip top-level billing period doc definitions
      const data = d.data();
      if (data.paid) {
        monthlyIncomeTotal += Number(data.amount) || 0;
        monthlyPaidCount += 1;
      }
    });

    // Group transactions by eventId in-memory
    const txsByEvent = {};
    txSnap.docs.forEach((doc) => {
      const t = doc.data();
      const parentEventRef = doc.ref.parent.parent;
      if (!parentEventRef) return; // safety check
      const eventId = parentEventRef.id;

      if (!txsByEvent[eventId]) {
        txsByEvent[eventId] = [];
      }

      const amt = (Number(t.amount) || 0) * (Number(t.quantity) || 1);
      txsByEvent[eventId].push({
        id: doc.id,
        type: t.type,
        label: t.label || "",
        amount: t.amount || 0,
        quantity: t.quantity || 1,
        totalAmount: t.totalAmount || amt,
        note: t.note || "",
        createdAt: t.createdAt ? t.createdAt.toDate().toISOString() : null
      });
    });

    const events = eventsSnap.docs.map((doc) => {
      const data = doc.data();
      const eventTransactions = txsByEvent[doc.id] || [];

      // Sort transactions by date asc
      eventTransactions.sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dbTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return da - dbTime;
      });

      const totalIncome = Number(data.totalIncome) || 0;
      const totalExpense = Number(data.totalExpense) || 0;

      return {
        id: doc.id,
        name: data.name || "",
        emoji: data.emoji || "🎉",
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
        totalIncome,
        totalExpense,
        balance: totalIncome - totalExpense,
        transactionCount: Number(data.transactionCount) || eventTransactions.length,
        transactions: eventTransactions
      };
    });

    res.status(200).json({ events, monthlyIncomeTotal, monthlyPaidCount });
  } catch (err) {
    console.error("pub-list-events failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
