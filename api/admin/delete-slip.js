const admin = require("firebase-admin");
const cloudinary = require("cloudinary").v2;
const { checkIsAdmin } = require("../_lib/admins");
const { rateLimit, clientIp } = require("../_lib/rate-limit");
const { isValidNuid } = require("../_lib/validate");
const { isValidMonthId } = require("../_lib/months");
const { writeAuditLog } = require("../_lib/audit");

/* ------------------------------------------------------------
   Deletes/Rejects a payment slip from Cloudinary and resets the
   student's payment & ledger status across months.
   Supports monthId="ALL" or specific monthId.
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

    const { nuid, monthId, slipPublicId } = request.body || {};
    if (!nuid || typeof nuid !== "string") {
      response.status(400).json({ error: "Missing nuid" });
      return;
    }
    if (!isValidNuid(nuid)) {
      response.status(400).json({ error: "Invalid Nu ID format" });
      return;
    }
    if (monthId !== "ALL" && !isValidMonthId(monthId)) {
      response.status(400).json({ error: "Invalid monthId" });
      return;
    }

    const db = admin.firestore();
    const monthsSubcollRef = db.collection("payments").doc(nuid).collection("months");
    const userMonthsSnap = await monthsSubcollRef.get();

    let publicIdToDelete = slipPublicId || null;
    let targetDocId = (monthId !== "ALL") ? monthId : null;

    userMonthsSnap.docs.forEach((d) => {
      const data = d.data();
      if (!publicIdToDelete && data.slipPublicId) {
        publicIdToDelete = data.slipPublicId;
      }
      if (!targetDocId && (data.slipPublicId || data.reviewStatus === "pending")) {
        targetDocId = d.id;
      }
    });

    if (publicIdToDelete) {
      try {
        await cloudinary.uploader.destroy(publicIdToDelete, { resource_type: "image" });
      } catch (cErr) {
        console.warn("Cloudinary destroy warning:", cErr);
      }
    }

    const batch = db.batch();

    // Reset ledger and clear slip records for student's month docs
    userMonthsSnap.docs.forEach((d) => {
      const data = d.data();
      const mTarget = data.targetAmount || data.amount || 0;
      const ref = monthsSubcollRef.doc(d.id);

      batch.set(
        ref,
        {
          paid: false,
          paidAmount: 0,
          remainingBalance: mTarget,
          reviewStatus: "rejected",
          slipUrl: admin.firestore.FieldValue.delete(),
          slipPublicId: admin.firestore.FieldValue.delete(),
          fileName: admin.firestore.FieldValue.delete(),
          amountPaid: admin.firestore.FieldValue.delete(),
          paymentMode: admin.firestore.FieldValue.delete(),
          approvedBy: admin.firestore.FieldValue.delete(),
          approvedAt: admin.firestore.FieldValue.delete(),
          rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
          rejectedBy: email
        },
        { merge: true }
      );
    });

    await batch.commit();

    await writeAuditLog(db, "delete_slip", email, { nuid, monthId, publicId: publicIdToDelete || null });

    response.status(200).json({ ok: true });
  } catch (err) {
    console.error("Admin delete-slip failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};
