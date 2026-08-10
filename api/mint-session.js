const admin = require("firebase-admin");
const { rateLimit, clientIp } = require("./_lib/rate-limit");

/* ------------------------------------------------------------
   Mints a Firebase Auth custom token with uid == nuid, after
   checking the Nu ID exists in the roster -- and returns that
   student's name/email from the roster doc, since the client no
   longer ships a copy of the full roster (public/user.js was a
   plaintext leak of every student's name/email/Nu ID to anyone who
   loaded the login page, logged in or not).

   WHAT THIS DOES: after the client signs in with the returned
   token, request.auth.uid in Firestore rules and request headers
   in our other API routes will genuinely equal this nuid -- so
   "owner-only" checks (firestore.rules on payments/{nuid}, and the
   auth check in submit-slip.js / sign-upload.js) actually mean
   something instead of being pure client-side trust.

   WHAT THIS DOES NOT DO: verify that the person typing the Nu ID
   is actually that student. Anyone who knows (or guesses) a valid
   Nu ID can still mint a session for it -- there's no password,
   OTP, or SSO check here. That's a deliberate, scoped-down version
   of "real auth": it closes the "read/write with no session at
   all" hole cheaply, while leaving true identity verification
   (e.g. restricted Google SSO, email OTP) as a separate, bigger
   project.

   Requires the same env var as the other Admin-SDK endpoints (set
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
    if (rateLimit(`mint-session:${clientIp(request)}`, { limit: 20, windowMs: 60_000 }).limited) {
      response.status(429).json({ error: "Too many requests, please slow down" });
      return;
    }

    const { nuid } = request.body || {};
    if (!nuid || typeof nuid !== "string") {
      response.status(400).json({ error: "Missing nuid" });
      return;
    }

    const db = admin.firestore();
    const userSnap = await db.collection("users").doc(nuid).get();
    if (!userSnap.exists) {
      response.status(404).json({ error: "Student ID does not exist in the roster" });
      return;
    }

    const userData = userSnap.data();
    const token = await admin.auth().createCustomToken(nuid);
    response.status(200).json({
      token,
      name: userData.name || "",
      email: userData.email || ""
    });
  } catch (err) {
    console.error("mint-session failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};
