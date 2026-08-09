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
const ADMIN_EMAILS = require("../../public/admin/admin-emails.json");

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

    const { nuid } = request.body || {};
    if (!nuid || typeof nuid !== "string") {
      response.status(400).json({ error: "Missing nuid" });
      return;
    }

    // Look up the slip's public_id ourselves via the Admin SDK rather
    // than trusting whatever the client sends -- this way a tampered
    // request can't be used to delete an arbitrary Cloudinary asset.
    const db = admin.firestore();
    const paymentRef = db.collection("payments").doc(nuid);
    const paymentSnap = await paymentRef.get();

    if (!paymentSnap.exists) {
      response.status(404).json({ error: "No payment record for this nuid" });
      return;
    }

    const publicId = paymentSnap.data().slipPublicId;
    if (publicId) {
      await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    }

    await paymentRef.set(
      {
        paid: false,
        // BUG FIX: this used to leave reviewStatus:"pending" in place
        // after a delete, since only the slip fields below were
        // cleared. The student's Stats page reads reviewStatus on its
        // own (not "does a slip still exist"), so a deleted slip kept
        // showing as "รอตรวจสอบ / pending review" forever with no way
        // to re-upload out of that state from the student's point of
        // view. Explicitly setting it to "rejected" here (rather than
        // just deleting the field) also lets the Stats page tell a
        // rejected slip apart from someone who never uploaded one.
        reviewStatus: "rejected",
        slipUrl: admin.firestore.FieldValue.delete(),
        slipPublicId: admin.firestore.FieldValue.delete(),
        fileName: admin.firestore.FieldValue.delete(),
        rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
        rejectedBy: email
      },
      { merge: true }
    );

    response.status(200).json({ ok: true });
  } catch (err) {
    console.error("Admin delete-slip failed:", err);
    response.status(500).json({ error: err.message });
  }
};
