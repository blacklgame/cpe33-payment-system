const admin = require("firebase-admin");
const { checkIsAdmin } = require("../_lib/admins");
const { rateLimit, clientIp } = require("../_lib/rate-limit");
const { monthIdOf, labelOf } = require("../_lib/months");

/* ------------------------------------------------------------
   Creates (or updates the amount of) a billing month, e.g.
   "February 2026, 80 baht". Admin-only, same auth pattern as
   every other api/admin/*.js file.

   The doc ID is always derived from {year, month} (see
   api/_lib/months.js), so calling this again for a month that
   already exists just updates its amount/label -- it does NOT
   touch any student's already-submitted slips for that month
   (submit-slip.js snapshots the amount onto the payment record
   at submission time, so changing a month's price later never
   silently changes what a past payment "cost").

   Requires the same env var as the other api/admin/*.js files:
   - FIREBASE_SERVICE_ACCOUNT_BASE64
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

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    if (rateLimit(`create-month:${clientIp(request)}`, { limit: 20, windowMs: 60_000 }).limited) {
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

    const { action, year, month, amount, monthId: reqMonthId } = request.body || {};

    const db = admin.firestore();

    if (action === "delete") {
      const targetMonthId = reqMonthId || (year && month ? monthIdOf(Number(year), Number(month)) : null);
      if (!targetMonthId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonthId)) {
        response.status(400).json({ error: "Invalid monthId" });
        return;
      }

      await db.collection("months").doc(targetMonthId).delete();
      await writeAuditLog(db, "delete_month", email, { monthId: targetMonthId });
      response.status(200).json({ ok: true });
      return;
    }

    const yearNum = Number(year);
    const monthNum = Number(month);
    const amountNum = Number(amount);

    if (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 2100) {
      response.status(400).json({ error: "Invalid year" });
      return;
    }
    if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
      response.status(400).json({ error: "Invalid month" });
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 1_000_000) {
      response.status(400).json({ error: "Invalid amount" });
      return;
    }

    const monthId = monthIdOf(yearNum, monthNum);
    const monthRef = db.collection("months").doc(monthId);
    const existing = await monthRef.get();

    await monthRef.set(
      {
        year: yearNum,
        month: monthNum,
        amount: amountNum,
        label: labelOf(yearNum, monthNum),
        ...(existing.exists
          ? { updatedBy: email, updatedAt: admin.firestore.FieldValue.serverTimestamp() }
          : { createdBy: email, createdAt: admin.firestore.FieldValue.serverTimestamp() })
      },
      { merge: true }
    );

    await writeAuditLog(db, existing.exists ? "update_month" : "create_month", email, {
      monthId,
      year: yearNum,
      month: monthNum,
      amount: amountNum
    });

    response.status(200).json({ ok: true, monthId });
  } catch (err) {
    console.error("Admin create-month failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};

