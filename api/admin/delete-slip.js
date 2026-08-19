const admin = require("firebase-admin");
const cloudinary = require("cloudinary").v2;

/* ------------------------------------------------------------
   Deletes a slip image from Cloudinary and resets that student's
   payment status back to unpaid.

   This is the REAL security check for admin actions -- the
   whitelist checks in admin.js/dashboard.js are just UI gates and
   can be bypassed by anyone with devtools, so THIS check is what
   actually decides who's allowed to delete a slip.

   The admin email list itself lives in ONE place --
   public/admin/admin-emails.json -- and this file reads directly
   from it (same as the client pages, via fetch), so adding or
   removing an admin only ever means editing that one JSON file.

   Requires env vars (set in Vercel -> Project -> Settings ->
   Environment Variables):
   - FIREBASE_SERVICE_ACCOUNT_BASE64  (see README for how to get this)
   - CLOUDINARY_API_KEY
   - CLOUDINARY_API_SECRET
   (Cloud name is hardcoded below to match your existing setup --
   it's not secret, so no env var needed for it.)
------------------------------------------------------------ */
const { checkIsAdmin } = require("../_lib/admins");
const { rateLimit, clientIp } = require("../_lib/rate-limit");
const { isValidNuid } = require("../_lib/validate");
const { isValidMonthId } = require("../_lib/months");
const { writeAuditLog } = require("../_lib/audit");

if (!admin.apps.length) {
  const saJson = Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "",
    "base64"
  ).toString("utf8");

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(saJson))
  });
}

cloudinary.config({
  cloud_name: "egcc6hml",
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    if (rateLimit(`delete-slip:${clientIp(request)}`, { limit: 30, windowMs: 60_000 }).limited) {
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

    if (!paymentSnap.exists) {
      response.status(404).json({ error: "No payment record for this nuid/month" });
      return;
    }

    const publicId = paymentSnap.data().slipPublicId;
    if (publicId) {
      await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    }

    await paymentRef.set(
      {
        paid: false,
        reviewStatus: "rejected",
        slipUrl: admin.firestore.FieldValue.delete(),
        slipPublicId: admin.firestore.FieldValue.delete(),
        fileName: admin.firestore.FieldValue.delete(),
        rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
        rejectedBy: email
      },
      { merge: true }
    );

    await writeAuditLog(db, "delete_slip", email, { nuid, monthId, publicId: publicId || null });

    response.status(200).json({ ok: true });
  } catch (err) {
    console.error("Admin delete-slip failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};

