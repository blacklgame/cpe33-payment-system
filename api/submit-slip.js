const admin = require("firebase-admin");
const { rateLimit, clientIp } = require("./_lib/rate-limit");
const { isValidNuid } = require("./_lib/validate");
const { isValidMonthId } = require("./_lib/months");

/* ------------------------------------------------------------
   Records a submitted payment slip after it's already been
   uploaded to Cloudinary (see public/logined/index.js).

   THIS IS THE FIX for the "fake slip" exploit: the browser used
   to be allowed to setDoc() straight into Firestore with
   `paid: true` as long as slipUrl/slipPublicId matched a regex --
   but a regex only checks the *shape* of a string, not whether a
   human ever looked at the image. Anyone could upload an unrelated
   picture to Cloudinary (unsigned uploads let the client pick the
   public_id) and get a URL that matched the pattern perfectly.

   Now:
   - The client can only ever request "pending" (this endpoint
     hardcodes paid:false / reviewStatus:"pending" -- it never reads
     a `paid` field from the request body at all, so there's no way
     to smuggle paid:true through here).
   - Only an admin, via /api/admin/approve-slip.js (Admin SDK,
     verified ID token, whitelist-checked), can flip paid:true.
   - firestore.rules now denies ALL client writes to payments/{nuid}
     -- every write goes through an Admin-SDK endpoint like this one,
     so a direct SDK write from the console (like the exploit script)
     no longer has any path to succeed.

   This app still has no password login -- a Nu ID alone isn't proof
   of identity. But the caller must now present a Firebase ID token
   whose uid matches the nuid in the body (that uid comes from
   /api/mint-session after logging in with that Nu ID -- see that
   file for exactly what it does and doesn't guarantee). That closes
   the "POST here directly, no login flow needed at all" gap; it does
   NOT prove the person submitting is really that student, since
   nothing stops someone from logging in with a classmate's Nu ID in
   the first place.

   What this endpoint DOES fully guarantee is that no submission can
   ever mark itself paid; every slip is inert until an admin approves
   it.

   Requires the same env var as api/admin/*.js (set in Vercel ->
   Project -> Settings -> Environment Variables):
   - FIREBASE_SERVICE_ACCOUNT_BASE64
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

    const { nuid, monthId, fileName, slipUrl, slipPublicId } = request.body || {};

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
    // Cap fileName length -- it's stored in Firestore and rendered
    // as-is (not currently a display target in the dashboard, but no
    // reason to let an arbitrarily long string through just because
    // nothing reads it today). 300 chars is generous for any real
    // filename.
    if (fileName.length > 300) {
      response.status(400).json({ error: "fileName too long" });
      return;
    }
    if (!slipUrl || typeof slipUrl !== "string" || !CLOUDINARY_URL_RE.test(slipUrl)) {
      response.status(400).json({ error: "Invalid slipUrl" });
      return;
    }

    // Escape any regex metacharacters in nuid (e.g. ".", "*") before
    // interpolating -- raw interpolation would turn them into wildcards.
    // The path must also match the exact month being paid for, so a
    // slip uploaded (and signed) for one month can't be submitted
    // against a different month's payment record.
    const escapedNuid = nuid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const publicIdRe = new RegExp("^slips/" + escapedNuid + "/" + monthId + "/.+");
    if (!slipPublicId || typeof slipPublicId !== "string" || !publicIdRe.test(slipPublicId)) {
      response.status(400).json({ error: "Invalid slipPublicId" });
      return;
    }

    const db = admin.firestore();

    // Verify student exists in the roster
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

    // Terminated students can't submit new slips -- mirrors the
    // client-side check in logined/index.js, but this is the copy
    // that actually matters.
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

    // Confirm the Cloudinary asset is real (not just a URL that
    // happens to match the regex) by asking Cloudinary about it
    // directly, server-side, using the private Admin API -- this
    // can't be spoofed from the browser the way a client-supplied
    // URL string can.
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

    // paid is ALWAYS false here -- there is no code path in this
    // file that ever writes paid:true. Only approve-slip.js can.
    //
    // Explicitly clear any approvedBy/approvedAt/rejectedBy/rejectedAt
    // left over from a previous cycle (approve -> delete/reject ->
    // resubmit) for THIS month. With merge:true, fields not mentioned
    // here are left untouched -- so without this, a fresh "pending"
    // submission could still carry a stale approvedAt from a previous
    // rejected attempt at the same month, which is confusing at best
    // (looks approved-then-pending at once) and actively misleading
    // if anything ever reads approvedAt as "last time this nuid was
    // approved for this month" without also checking reviewStatus.
    //
    // amount is snapshotted from the month's current price at the
    // moment of submission -- so if an admin edits a month's amount
    // later (create-month.js), already-submitted/approved payments
    // keep showing what was actually charged at the time.
    await monthlyRef.set(
      {
        paid: false,
        reviewStatus: "pending",
        fileName,
        slipUrl,
        slipPublicId,
        amount: monthSnap.data().amount,
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
