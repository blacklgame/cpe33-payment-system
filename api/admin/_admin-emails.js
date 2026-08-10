/* ------------------------------------------------------------
   Loads the admin email whitelist from the ADMIN_EMAILS env var
   instead of a JSON file, so the list never lives in the repo /
   GitHub history.

   Set in Vercel -> Project -> Settings -> Environment Variables:
   - ADMIN_EMAILS = comma-separated list, e.g.
     "a@nu.ac.th,b@nu.ac.th,c@nu.ac.th"

   For local dev, put the same var in your .env.local (already
   gitignored) -- see .env.example.
------------------------------------------------------------ */

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

if (ADMIN_EMAILS.length === 0) {
  console.warn(
    "[admin-emails] ADMIN_EMAILS env var is empty or unset -- no one will pass the admin check."
  );
}

module.exports = ADMIN_EMAILS;
