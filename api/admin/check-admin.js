const admin = require("firebase-admin");

/* ------------------------------------------------------------
   Checks whether the caller is an approved admin.

   Called by dashboard.js on every load to replace the old
   client-side fetch of admin-emails.json (which was a public
   static file -- anyone could read the admin email list).
   This endpoint reads admin-emails.json server-side instead,
   so the list is never exposed to the browser.

   Requires env var (set in Vercel -> Project -> Settings ->
   Environment Variables):
   - FIREBASE_SERVICE_ACCOUNT_BASE64
------------------------------------------------------------ */
const ADMIN_EMAILS = require("../../config/admin-emails.json");

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
    const authHeader = request.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) {
      response.status(401).json({ error: "Missing auth token" });
      return;
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const email = (decoded.email || "").toLowerCase();

    const isAdmin =
      !!decoded.email_verified &&
      ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email);

    // Always return 200 with a boolean rather than 403, so the client
    // can distinguish "server error" (non-200) from "not an admin"
    // (200 + isAdmin:false) without exposing which emails are admins.
    response.status(200).json({ isAdmin });
  } catch (err) {
    console.error("check-admin failed:", err);
    response.status(500).json({ error: err.message });
  }
};
