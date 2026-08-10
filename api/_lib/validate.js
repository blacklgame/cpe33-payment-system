/* ------------------------------------------------------------
   Nu IDs in this app's roster are always exactly 8 digits (see
   scripts/roster-data.json). Every endpoint below eventually does
   one of:
     - db.collection(...).doc(nuid)  -- a nuid containing "/" changes
       which Firestore path gets addressed, since Firestore treats
       "/" as a path separator inside .doc(). An odd-looking nuid
       here throws (caught -> 500) at best and reaches a path other
       than the intended top-level users/{nuid} doc at worst.
     - new RegExp("^slips/" + nuid + ...) or a template string
       building a Cloudinary public_id -- not a regex-escaping bug
       (submit-slip.js already escapes for that), but still no
       reason to accept something that isn't a real Nu ID shape.

   Checking the format here, before any of that, means a malformed
   ID is rejected cleanly with 400 right away instead of surfacing
   as a confusing downstream error.
------------------------------------------------------------ */

const NUID_RE = /^\d{8}$/;

function isValidNuid(nuid) {
  return typeof nuid === "string" && NUID_RE.test(nuid);
}

module.exports = { isValidNuid };
