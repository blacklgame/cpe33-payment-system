const admin = require("firebase-admin");
const { checkIsAdmin } = require("../_lib/admins");
const { rateLimit, clientIp } = require("../_lib/rate-limit");

if (!admin.apps.length) {
  const saJson = Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "",
    "base64"
  ).toString("utf8");

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(saJson))
  });
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    if (rateLimit(`audit-list:${clientIp(request)}`, { limit: 60, windowMs: 60_000 }).limited) {
      response.status(429).json({ error: "Too many requests, please slow down" });
      return;
    }

    const authHeader = request.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) {
      response.status(401).json({ error: "Missing auth token" });
      return;
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const email = (decoded.email || "").toLowerCase();
    const isGoogle = decoded.firebase && decoded.firebase.sign_in_provider === "google.com";
    const isVerified = !!decoded.email_verified || isGoogle;

    if (!isVerified || !(await checkIsAdmin(email))) {
      response.status(403).json({ error: "Not an approved admin" });
      return;
    }

    const db = admin.firestore();
    const snap = await db.collection("auditLog").orderBy("createdAt", "desc").limit(100).get();

    const logs = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        action: data.action || "",
        actor: data.actor || "",
        details: data.details || {},
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null
      };
    });

    response.status(200).json({ logs });
  } catch (err) {
    console.error("Admin audit-list failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};
