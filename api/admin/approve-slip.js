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
const ADMIN_EMAILS = require("./_admin-emails");

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

    if (!decoded.email_verified || !ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email)) {
      response.status(403).json({ error: "Not an approved admin" });
      return;
    }

    const { nuid } = request.body || {};
    if (!nuid || typeof nuid !== "string") {
      response.status(400).json({ error: "Missing nuid" });
      return;
    }

    const db = admin.firestore();
    const paymentRef = db.collection("payments").doc(nuid);
    const paymentSnap = await paymentRef.get();

    if (!paymentSnap.exists || !paymentSnap.data().slipUrl) {
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
    response.status(500).json({ error: err.message });
  }
};
