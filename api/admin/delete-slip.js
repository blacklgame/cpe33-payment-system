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

    const { nuid, monthId, slipPublicId, confirm } = request.body || {};
    if (confirm !== true) {
      response.status(400).json({ error: "Missing confirmation: set confirm=true to proceed with this destructive action" });
      return;
    }
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
    const paymentRef = db.collection("payments").doc(nuid);
    const monthsSubcollRef = paymentRef.collection("months");

    let publicIdToDelete = slipPublicId || null;

    await db.runTransaction(async (transaction) => {
      const userMonthsSnap = await transaction.get(monthsSubcollRef);
      const userMonthsMap = {};

      let targetDocRef = null;
      let targetDocId = null;
      let slipData = null;

      userMonthsSnap.docs.forEach((d) => {
        const data = d.data();
        userMonthsMap[d.id] = data;

        if (publicIdToDelete && data.slipPublicId === publicIdToDelete) {
          targetDocRef = d.ref;
          targetDocId = d.id;
          slipData = data;
        } else if (!targetDocRef && (monthId === "ALL" || d.id === monthId) && data.reviewStatus === "pending") {
          targetDocRef = d.ref;
          targetDocId = d.id;
          slipData = data;
        }
      });

      if (!targetDocRef && monthId !== "ALL") {
        targetDocRef = monthsSubcollRef.doc(monthId);
        targetDocId = monthId;
        const snap = await transaction.get(targetDocRef);
        if (snap.exists) {
          slipData = snap.data();
        }
      }

      if (!targetDocRef) {
        throw new Error("SLIP_NOT_FOUND");
      }

      if (!publicIdToDelete && slipData?.slipPublicId) {
        publicIdToDelete = slipData.slipPublicId;
      }

      const isApprovedSlip = slipData && slipData.reviewStatus === "approved";
      let amountToDeduct = isApprovedSlip && typeof slipData.amountPaid === "number" && slipData.amountPaid > 0
        ? slipData.amountPaid
        : 0;

      if (publicIdToDelete) {
        try {
          await cloudinary.uploader.destroy(publicIdToDelete, { resource_type: "image" });
        } catch (cErr) {
          console.warn("Cloudinary destroy warning:", cErr);
        }
      }

      if (amountToDeduct > 0) {
        const monthsSnap = await transaction.get(db.collection("months"));
        const allMonthsDescending = monthsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => b.id.localeCompare(a.id));

        for (const mDef of allMonthsDescending) {
          const mId = mDef.id;
          const mSnap = userMonthsMap[mId] || {};
          const mTarget = mSnap.targetAmount || mSnap.amount || mDef.amount || 0;
          const mPaid = mSnap.paidAmount || (mSnap.paid ? mTarget : 0);

          if (mPaid > 0 && amountToDeduct > 0) {
            const deduction = Math.min(amountToDeduct, mPaid);
            const newPaidAmount = Math.max(0, mPaid - deduction);
            const newRemaining = Math.max(0, mTarget - newPaidAmount);
            const isPaid = newPaidAmount >= mTarget && mTarget > 0;

            amountToDeduct -= deduction;

            const mRef = monthsSubcollRef.doc(mId);
            const updatePayload = {
              targetAmount: mTarget,
              paidAmount: newPaidAmount,
              remainingBalance: newRemaining,
              paid: isPaid
            };

            if (mRef.path === targetDocRef.path) {
              updatePayload.reviewStatus = "rejected";
              updatePayload.rejectedBy = email;
              updatePayload.rejectedAt = admin.firestore.FieldValue.serverTimestamp();
              updatePayload.slipUrl = admin.firestore.FieldValue.delete();
              updatePayload.slipPublicId = admin.firestore.FieldValue.delete();
              updatePayload.fileName = admin.firestore.FieldValue.delete();
              updatePayload.amountPaid = admin.firestore.FieldValue.delete();
              updatePayload.paymentMode = admin.firestore.FieldValue.delete();
              updatePayload.approvedBy = admin.firestore.FieldValue.delete();
              updatePayload.approvedAt = admin.firestore.FieldValue.delete();
            }

            transaction.set(mRef, updatePayload, { merge: true });
          }
        }
      }

      const targetUpdate = {
        reviewStatus: "rejected",
        rejectedBy: email,
        rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
        slipUrl: admin.firestore.FieldValue.delete(),
        slipPublicId: admin.firestore.FieldValue.delete(),
        fileName: admin.firestore.FieldValue.delete(),
        amountPaid: admin.firestore.FieldValue.delete(),
        paymentMode: admin.firestore.FieldValue.delete(),
        approvedBy: admin.firestore.FieldValue.delete(),
        approvedAt: admin.firestore.FieldValue.delete()
      };

      transaction.set(targetDocRef, targetUpdate, { merge: true });
    });

    await writeAuditLog(db, "delete_slip", email, { nuid, monthId, publicId: publicIdToDelete || null });

    response.status(200).json({ ok: true });
  } catch (err) {
    console.error("Admin delete-slip failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};
