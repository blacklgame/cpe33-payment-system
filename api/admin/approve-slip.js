const admin = require("firebase-admin");

/* ------------------------------------------------------------
   Approves a pending payment slip -- the ONLY place in this whole
   codebase that is allowed to set paid:true. Paired with
   api/submit-slip.js, which only ever writes paid:false.

   Same auth pattern as set-status.js/delete-slip.js: this is the
   real security check (client-side whitelist checks in
   admin.js/dashboard.js are just UI gates).

   Requires the same env var as the other api/admin/*.js files (set
   in Vercel -> Project -> Settings -> Environment Variables):
   - FIREBASE_SERVICE_ACCOUNT_BASE64
------------------------------------------------------------ */
const { checkIsAdmin } = require("../_lib/admins");
const { rateLimit, clientIp } = require("../_lib/rate-limit");
const { isValidNuid } = require("../_lib/validate");
const { isValidMonthId } = require("../_lib/months");

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
    if (rateLimit(`approve-slip:${clientIp(request)}`, { limit: 30, windowMs: 60_000 }).limited) {
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

    const { nuid, monthId } = request.body || {};
    if (!nuid || typeof nuid !== "string") {
      response.status(400).json({ error: "Missing nuid" });
      return;
    }
    if (!isValidNuid(nuid)) {
      response.status(400).json({ error: "Invalid Nu ID format" });
      return;
    }
    if (!isValidMonthId(monthId)) {
      response.status(400).json({ error: "Invalid monthId" });
      return;
    }

    const db = admin.firestore();
    const paymentRef = db.collection("payments").doc(nuid).collection("months").doc(monthId);
    const paymentSnap = await paymentRef.get();

    // Require reviewStatus === "pending", not just "a slipUrl exists".
    // Previously this only checked slipUrl was present, so an already
    // -approved slip (still has slipUrl) or a slip an admin had just
    // rejected in the same instant could both be re-approved by a
    // stale/duplicate click -- e.g. two admin tabs open, or a retried
    // request -- silently re-running approvedBy/approvedAt with no
    // error. Pinning this to reviewStatus makes approve a one-way,
    // one-shot transition from "pending" only.
    if (!paymentSnap.exists || paymentSnap.data().reviewStatus !== "pending") {
      response.status(404).json({ error: "No pending slip for this nuid" });
      return;
    }

    await paymentRef.set(
      {
        paid: true,
        reviewStatus: "approved",
        approvedBy: email,
        approvedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    response.status(200).json({ ok: true });
  } catch (err) {
    console.error("Admin approve-slip failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};
