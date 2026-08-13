const admin = require("firebase-admin");
const { checkIsAdmin } = require("../_lib/admins");
const { rateLimit, clientIp } = require("../_lib/rate-limit");
const { isValidMonthId } = require("../_lib/months");

/* ------------------------------------------------------------
   Deletes a billing month definition (e.g. removing "February
   2026" from the list an admin can pick when reviewing slips or
   a student can pick when paying).

   This intentionally does NOT touch any payments/{nuid}/months/
   {monthId} records that already exist for that month -- a
   student's submitted/approved slip and the amount they were
   charged (snapshotted at submission time) stay exactly as they
   were, they just won't show up under a "current month" picker
   anymore. Deleting the month definition is reversible in effect
   by recreating it with the same year/month via create-month.js.

   Requires the same env var as the other api/admin/*.js files:
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
    if (rateLimit(`delete-month:${clientIp(request)}`, { limit: 20, windowMs: 60_000 }).limited) {
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
      response.status(403).json({ error: "Not an approved admin", email });
      return;
    }

    const { monthId } = request.body || {};
    if (!isValidMonthId(monthId)) {
      response.status(400).json({ error: "Invalid monthId" });
      return;
    }

    await admin.firestore().collection("months").doc(monthId).delete();

    response.status(200).json({ ok: true });
  } catch (err) {
    console.error("Admin delete-month failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};
