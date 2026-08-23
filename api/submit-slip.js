const admin = require("firebase-admin");
const { rateLimit, clientIp } = require("./_lib/rate-limit");
const { isValidNuid } = require("./_lib/validate");
const { isValidMonthId } = require("./_lib/months");

/* ------------------------------------------------------------
   Records a submitted payment slip after it's already been
   uploaded to Cloudinary (see public/logined/index.js).

   Supports 3 payment modes:
   - "full": Pay full amount for selected month
   - "installment": Custom partial amount for selected month
   - "all": Pay total remaining balance across all unpaid months

   Saves reviewStatus:"pending", paymentMode, amountPaid.
   Paid status can ONLY be flipped by /api/admin/approve-slip.js.
------------------------------------------------------------ */

const CLOUDINARY_URL_RE = /^https:\/\/res\.cloudinary\.com\/egcc6hml\/image\/upload\/.+/;

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
    if (rateLimit(`submit-slip:${clientIp(request)}`, { limit: 10, windowMs: 60_000 }).limited) {
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

    const { nuid, monthId, fileName, slipUrl, slipPublicId, paymentMode, amountPaid } = request.body || {};

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

    if (decoded.uid !== nuid) {
      response.status(403).json({ error: "Not authorized for this Nu ID" });
      return;
    }
    if (!fileName || typeof fileName !== "string") {
      response.status(400).json({ error: "Missing fileName" });
      return;
    }
    if (fileName.length > 300) {
      response.status(400).json({ error: "fileName too long" });
      return;
    }
    const safeFileName = fileName.replace(/[<>"'&]/g, "");
    if (!slipUrl || typeof slipUrl !== "string" || !CLOUDINARY_URL_RE.test(slipUrl)) {
      response.status(400).json({ error: "Invalid slipUrl" });
      return;
    }

    const escapedNuid = nuid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const publicIdRe = new RegExp("^slips/" + escapedNuid + "/" + monthId + "/.+");
    if (!slipPublicId || typeof slipPublicId !== "string" || !publicIdRe.test(slipPublicId)) {
      response.status(400).json({ error: "Invalid slipPublicId" });
      return;
    }

    const db = admin.firestore();

    const userSnap = await db.collection("users").doc(nuid).get();
    if (!userSnap.exists) {
      response.status(404).json({ error: "Student ID does not exist in the roster" });
      return;
    }

    const monthSnap = await db.collection("months").doc(monthId).get();
    if (!monthSnap.exists) {
      response.status(404).json({ error: "That month has not been set up by an admin yet" });
      return;
    }

    const paymentRef = db.collection("payments").doc(nuid);
    const paymentSnap = await paymentRef.get();

    if (paymentSnap.exists && paymentSnap.data().studentStatus === "termination") {
      response.status(403).json({ error: "Account is terminated" });
      return;
    }

    const monthlyRef = paymentRef.collection("months").doc(monthId);
    const monthlySnap = await monthlyRef.get();
    if (monthlySnap.exists && monthlySnap.data().paid) {
      response.status(409).json({ error: "This month is already marked as paid" });
      return;
    }

    const cloudinary = require("cloudinary").v2;
    cloudinary.config({
      cloud_name: "egcc6hml",
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });

    try {
      const asset = await cloudinary.api.resource(slipPublicId, { resource_type: "image" });
      if (!asset || asset.secure_url !== slipUrl) {
        response.status(400).json({ error: "Slip could not be verified with Cloudinary" });
        return;
      }
    } catch (cloudErr) {
      response.status(400).json({ error: "Slip could not be verified with Cloudinary" });
      return;
    }

    const validPaymentMode = ["full", "installment", "all"].includes(paymentMode) ? paymentMode : "full";
    let parsedAmountPaid = Number(amountPaid);
    if (isNaN(parsedAmountPaid) || parsedAmountPaid <= 0) {
      parsedAmountPaid = Number(monthSnap.data().amount || 0);
    }

    await monthlyRef.set(
      {
        paid: false,
        reviewStatus: "pending",
        fileName: safeFileName,
        slipUrl,
        slipPublicId,
        paymentMode: validPaymentMode,
        amountPaid: parsedAmountPaid,
        amount: monthSnap.data().amount,
        targetAmount: monthSnap.data().amount,
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        approvedBy: admin.firestore.FieldValue.delete(),
        approvedAt: admin.firestore.FieldValue.delete(),
        rejectedBy: admin.firestore.FieldValue.delete(),
        rejectedAt: admin.firestore.FieldValue.delete()
      },
      { merge: true }
    );

    response.status(200).json({ ok: true });
  } catch (err) {
    console.error("submit-slip failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};
