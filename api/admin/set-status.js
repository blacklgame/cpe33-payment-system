const admin = require("firebase-admin");
const { checkIsAdmin } = require("../_lib/admins");
const { rateLimit, clientIp } = require("../_lib/rate-limit");
const { isValidNuid } = require("../_lib/validate");
const { writeAuditLog } = require("../_lib/audit");

const VALID_STATUSES = ["normal", "termination", "unpaid"];

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
    if (rateLimit(`set-status:${clientIp(request)}`, { limit: 30, windowMs: 60_000 }).limited) {
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

    const { nuid, status } = request.body || {};
    if (!nuid || typeof nuid !== "string") {
      response.status(400).json({ error: "Missing nuid" });
      return;
    }
    if (!isValidNuid(nuid)) {
      response.status(400).json({ error: "Invalid Nu ID format" });
      return;
    }
    if (!VALID_STATUSES.includes(status)) {
      response.status(400).json({ error: "Invalid status" });
      return;
    }

    const db = admin.firestore();

    const userRef = db.collection("users").doc(nuid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      response.status(404).json({ error: "Student ID does not exist in the roster" });
      return;
    }

    const paymentRef = db.collection("payments").doc(nuid);
    await paymentRef.set(
      {
        studentStatus: status,
        statusSetBy: email,
        statusSetAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    // If status is set to "unpaid", reset month docs as well so ledger reflects unpaid
    if (status === "unpaid") {
      const monthsSubcollRef = paymentRef.collection("months");
      const userMonthsSnap = await monthsSubcollRef.get();
      const batch = db.batch();

      userMonthsSnap.docs.forEach((d) => {
        const data = d.data();
        const mTarget = data.targetAmount || data.amount || 0;
        batch.set(
          monthsSubcollRef.doc(d.id),
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
    }

    await writeAuditLog(db, "set_status", email, { nuid, studentStatus: status });

    response.status(200).json({ ok: true });
  } catch (err) {
    console.error("Admin set-status failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};
