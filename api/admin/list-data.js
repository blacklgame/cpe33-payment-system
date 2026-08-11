const admin = require("firebase-admin");
const { checkIsAdmin } = require("../_lib/admins");
const { rateLimit, clientIp } = require("../_lib/rate-limit");

/* ------------------------------------------------------------
   Returns every user + payment doc for the admin dashboard.

   dashboard.js used to read the `users` and `payments` collections
   directly with the client SDK. That worked because firestore.rules
   used to allow `read: if true` on both. Now that payments/{nuid} is
   owner-only (request.auth.uid == nuid) and users is fully locked
   down, an admin's own auth session -- a Google uid -- will never
   match any nuid, so a direct client bulk read no longer returns
   anything. This endpoint does that bulk read server-side with the
   Admin SDK (which bypasses Firestore rules entirely) after
   independently verifying the caller is an approved admin, same
   pattern as every other api/admin/*.js file.

   Requires the same env var as the other api/admin/*.js files (set
   in Vercel -> Project -> Settings -> Environment Variables):
   - FIREBASE_SERVICE_ACCOUNT_BASE64
------------------------------------------------------------ */

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
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    if (rateLimit(`list-data:${clientIp(request)}`, { limit: 30, windowMs: 60_000 }).limited) {
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
    const [usersSnap, paymentsSnap] = await Promise.all([
      db.collection("users").get(),
      db.collection("payments").get()
    ]);

    const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Only send the fields the dashboard actually renders -- no need
    // to ship raw Firestore Timestamps (approvedAt/rejectedAt/etc.)
    // to the browser for a table it doesn't display them in.
    const payments = paymentsSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        paid: !!data.paid,
        studentStatus: data.studentStatus || null,
        slipUrl: data.slipUrl || null,
        slipPublicId: data.slipPublicId || null
      };
    });

    response.status(200).json({ users, payments });
  } catch (err) {
    console.error("Admin list-data failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};
