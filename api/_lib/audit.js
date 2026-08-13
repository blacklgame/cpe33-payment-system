/* ------------------------------------------------------------
   Audit log helper — call writeAuditLog(db, action, email, details)
   from any admin API endpoint to record who did what and when.

   Collection: /auditLog/{autoId}
   Fields:
     action   – short string key, e.g. "approve_slip", "create_event"
     actor    – admin email address
     details  – plain object with relevant IDs / values (no PII beyond
                what's already in Firestore for the original record)
     createdAt – server timestamp

   Intentionally fire-and-forget (non-blocking): a logging failure
   should never break the primary action.
------------------------------------------------------------ */

/**
 * @param {import("firebase-admin").firestore.Firestore} db
 * @param {string} action  e.g. "create_event", "add_transaction"
 * @param {string} actor   admin email
 * @param {object} details extra context (IDs, labels, amounts …)
 */
async function writeAuditLog(db, action, actor, details = {}) {
  try {
    const admin = require("firebase-admin");
    await db.collection("auditLog").add({
      action,
      actor: actor || "unknown",
      details,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    // Non-fatal — log to console but don't throw.
    console.warn("[audit] Failed to write audit log:", err.message);
  }
}

module.exports = { writeAuditLog };
