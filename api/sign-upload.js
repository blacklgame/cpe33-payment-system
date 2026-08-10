const admin = require("firebase-admin");
const crypto = require("crypto");
const { rateLimit, clientIp } = require("./_lib/rate-limit");
const { isValidNuid } = require("./_lib/validate");

/* ------------------------------------------------------------
   Issues a signed-upload ticket for a payment slip.

   THIS IS THE FIX for the "unsigned upload" hole: the browser used
   to upload straight to Cloudinary with an UNSIGNED preset, and the
   browser itself chose the public_id -- so anyone with devtools open
   could upload (or overwrite, since nothing set overwrite:false) an
   image under any student's slips/{nuid}/... path, logged in as that
   student or not.

   Now:
   - The caller must present a Firebase ID token whose uid matches
     the nuid they're uploading for (that uid comes from
     /api/mint-session -- see that file for what it does and doesn't
     guarantee).
   - This endpoint -- not the browser -- decides the public_id, and
     it's always under slips/{that nuid}/..., matching the caller's
     own token.
   - overwrite:false is part of what gets signed, so Cloudinary
     itself rejects any attempt to clobber an existing asset at that
     public_id, regardless of what the browser sends.
   - The browser gets back a signature valid only for these exact
     params -- it can't reuse it for a different public_id or nuid.

   Requires env vars (set in Vercel -> Project -> Settings ->
   Environment Variables):
   - FIREBASE_SERVICE_ACCOUNT_BASE64
   - CLOUDINARY_API_KEY
   - CLOUDINARY_API_SECRET
------------------------------------------------------------ */

const cloudinary = require("cloudinary").v2;

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
    if (rateLimit(`sign-upload:${clientIp(request)}`, { limit: 20, windowMs: 60_000 }).limited) {
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

    const { nuid } = request.body || {};
    if (!nuid || typeof nuid !== "string") {
      response.status(400).json({ error: "Missing nuid" });
      return;
    }
    if (!isValidNuid(nuid)) {
      response.status(400).json({ error: "Invalid Nu ID format" });
      return;
    }

    if (decoded.uid !== nuid) {
      response.status(403).json({ error: "Not authorized for this Nu ID" });
      return;
    }

    const db = admin.firestore();

    const userSnap = await db.collection("users").doc(nuid).get();
    if (!userSnap.exists) {
      response.status(404).json({ error: "Student ID does not exist in the roster" });
      return;
    }

    const paymentSnap = await db.collection("payments").doc(nuid).get();
    if (paymentSnap.exists && paymentSnap.data().studentStatus === "termination") {
      response.status(403).json({ error: "Account is terminated" });
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `slips/${nuid}/${timestamp}_${crypto.randomBytes(8).toString("hex")}`;

    // overwrite must be signed as the exact string the browser will
    // send back -- keep it a string ("false") on both sides, since
    // Cloudinary's signature is computed over the literal param
    // values, not their JS types.
    const paramsToSign = { overwrite: "false", public_id: publicId, timestamp };
    const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET);

    response.status(200).json({
      timestamp,
      signature,
      publicId,
      apiKey: process.env.CLOUDINARY_API_KEY,
      cloudName: "egcc6hml"
    });
  } catch (err) {
    console.error("sign-upload failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};
