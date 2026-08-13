/* ------------------------------------------------------------
   Shared helpers for the monthly-dues feature.

   A "month" is a billing period an admin creates (e.g. February
   2026, 80 baht). Its Firestore doc ID is always "YYYY-MM" (zero
   -padded month) -- e.g. "2026-02" -- so IDs sort correctly as
   plain strings and can be validated with one regex everywhere
   they're accepted from a client (create-month.js, delete-month.js,
   sign-upload.js, submit-slip.js, approve-slip.js, delete-slip.js).
------------------------------------------------------------ */

const MONTH_ID_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function isValidMonthId(monthId) {
  return typeof monthId === "string" && MONTH_ID_RE.test(monthId);
}

function monthIdOf(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

function labelOf(year, month) {
  const name = THAI_MONTHS[month - 1] || String(month);
  return `${name} ${year}`;
}

module.exports = { isValidMonthId, monthIdOf, labelOf, MONTH_ID_RE };
