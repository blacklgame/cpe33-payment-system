const admin = require("firebase-admin");

/* ------------------------------------------------------------
   Sets a student's manual status: "normal", "termination", or
   "unpaid". This is admin-only and, like delete-slip.js, does the
   REAL security check server-side -- the whitelist checks in
   admin.js/dashboard.js are just UI gates and can be bypassed by
   anyone with devtools, so THIS check is what actually decides who
   can change a student's status.

   The admin email list itself lives in ONE place --
   public/admin/admin-emails.json -- and this file reads directly
   from it, so adding or removing an admin only ever means editing
   that one JSON file.

   This can't be a plain client-side Firestore write at all --
   firestore.rules denies every client write to payments/{nuid}
   unconditionally, student or admin. A status field that can mark
   someone "terminated" needs to be admin-only, so it's set here
   using the Admin SDK (which bypasses Firestore rules) after
   independently verifying the caller is an approved admin.

   Requires the same env var as delete-slip.js (set in Vercel ->
   Project -> Settings -> Environment Variables):
   - FIREBASE_SERVICE_ACCOUNT_BASE64
------------------------------------------------------------ */
const ADMIN_EMAILS = require("../../config/admin-emails.json");
const { rateLimit, clientIp } = require("../_lib/rate-limit");

const VALID_STATUSES = ["normal", "termination", "unpaid"];

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
    if (rateLimit(`set-status:${clientIp(request)}`, { limit: 30, windowMs: 60_000 }).limited) {
      response.status(429).json({ error: "Too many requests, please slow down" });
      return;
    }

    const authHeader = request.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) {
      response.status(401).json({ error: "Missing auth token" });
      return;
    }

    // Independently verifies the token with Firebase's servers -- this
    // cannot be spoofed by editing client-side JS, unlike a check that
    // only ran in the browser.
    const decoded = await admin.auth().verifyIdToken(idToken);
    const email = (decoded.email || "").toLowerCase();

    if (!decoded.email_verified || !ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email)) {
      response.status(403).json({ error: "Not an approved admin" });
      return;
    }

    const { nuid, status } = request.body || {};
    if (!nuid || typeof nuid !== "string") {
      response.status(400).json({ error: "Missing nuid" });
      return;
    }
    if (!VALID_STATUSES.includes(status)) {
      response.status(400).json({ error: "Invalid status" });
      return;
    }

    const db = admin.firestore();

    // Verify student exists in the roster
    const userRef = db.collection("users").doc(nuid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      response.status(404).json({ error: "Student ID does not exist in the roster" });
      return;
    }

    const paymentRef = db.collection("payments").doc(nuid);

    await paymentRef.set(
      {
        studentStatus: status,
        statusSetBy: email,
        statusSetAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    response.status(200).json({ ok: true });
  } catch (err) {
    console.error("Admin set-status failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};
