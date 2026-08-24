const admin = require("firebase-admin");
const { checkIsAdmin } = require("../_lib/admins");
const { rateLimit, clientIp } = require("../_lib/rate-limit");
const { isValidNuid } = require("../_lib/validate");
const { isValidMonthId } = require("../_lib/months");
const { writeAuditLog } = require("../_lib/audit");

/* ------------------------------------------------------------
   Approves a pending payment slip with Auto-Cascading Allocation.
   Allocates funds to close out oldest unpaid balances first.
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

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    if (rateLimit(`approve-slip:${clientIp(request)}`, { limit: 30, windowMs: 60_000 }).limited) {
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
    if (monthId !== "ALL" && !isValidMonthId(monthId)) {
      response.status(400).json({ error: "Invalid monthId" });
      return;
    }

    const db = admin.firestore();

    try {
      await db.runTransaction(async (transaction) => {
        const userMonthsSnap = await transaction.get(db.collection("payments").doc(nuid).collection("months"));
        const userMonthsMap = {};
        let targetMonthRef = null;
        let slipData = null;

        // Identify target month doc and slip data
        let targetMonthId = null;
        userMonthsSnap.docs.forEach((d) => {
          const data = d.data();
          userMonthsMap[d.id] = data;
          if ((monthId === "ALL" || d.id === monthId) && data.reviewStatus === "pending") {
            targetMonthRef = d.ref;
            targetMonthId = d.id;
            slipData = data;
          }
        });

        if (!targetMonthRef && monthId !== "ALL") {
          targetMonthRef = db.collection("payments").doc(nuid).collection("months").doc(monthId);
          targetMonthId = monthId;
          const snap = await transaction.get(targetMonthRef);
          if (snap.exists && snap.data().reviewStatus === "pending") {
            slipData = snap.data();
          }
        }

        if (!targetMonthRef || !slipData) {
          throw new Error("NO_PENDING_SLIP");
        }

        let fundsToAllocate = typeof slipData.amountPaid === "number" && slipData.amountPaid > 0
          ? slipData.amountPaid
          : (slipData.amount || 0);

        const monthsSnap = await transaction.get(db.collection("months"));
        const allMonths = monthsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => a.id.localeCompare(b.id));

        // Order of allocation:
        // If specific month (targetMonthId), allocate to targetMonthId first, then remaining months sorted oldest first.
        // If monthId === "ALL", sort all months oldest first.
        let allocationOrder = [];
        if (targetMonthId && targetMonthId !== "ALL") {
          const targetDef = allMonths.find((m) => m.id === targetMonthId) || { id: targetMonthId };
          const otherMonths = allMonths.filter((m) => m.id !== targetMonthId);
          allocationOrder = [targetDef, ...otherMonths];
        } else {
          allocationOrder = [...allMonths];
        }

        let targetMonthUpdated = false;

        for (const mDef of allocationOrder) {
          const mId = mDef.id;
          const mSnap = userMonthsMap[mId] || {};
          const mTarget = mSnap.targetAmount || mSnap.amount || mDef.amount || 0;
          const mPaid = mSnap.paidAmount || (mSnap.paid ? mTarget : 0);
          const mRemaining = Math.max(0, mTarget - mPaid);

          const mRef = db.collection("payments").doc(nuid).collection("months").doc(mId);
          const updatePayload = {};

          if (mRef.path === targetMonthRef.path) {
            updatePayload.reviewStatus = "approved";
            updatePayload.approvedBy = email;
            updatePayload.approvedAt = admin.firestore.FieldValue.serverTimestamp();
            targetMonthUpdated = true;
          }

          if (mRemaining > 0 && fundsToAllocate > 0) {
            const allocated = Math.min(fundsToAllocate, mRemaining);
            const newPaidAmount = mPaid + allocated;
            const newRemaining = Math.max(0, mTarget - newPaidAmount);
            const isPaid = newPaidAmount >= mTarget;

            fundsToAllocate -= allocated;

            updatePayload.targetAmount = mTarget;
            updatePayload.paidAmount = newPaidAmount;
            updatePayload.remainingBalance = newRemaining;
            updatePayload.paid = isPaid;

            transaction.set(mRef, updatePayload, { merge: true });
          } else if (Object.keys(updatePayload).length > 0) {
            transaction.set(mRef, updatePayload, { merge: true });
          }
        }

        if (!targetMonthUpdated) {
          transaction.set(
            targetMonthRef,
            {
              paid: true,
              reviewStatus: "approved",
              approvedBy: email,
              approvedAt: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        }
      });
    } catch (txErr) {
      if (txErr.message === "NO_PENDING_SLIP") {
        response.status(404).json({ error: "No pending slip for this nuid" });
        return;
      }
      throw txErr;
    }

    await writeAuditLog(db, "approve_slip", email, { nuid, monthId });

    response.status(200).json({ ok: true });
  } catch (err) {
    console.error("Admin approve-slip failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};
