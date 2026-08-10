/* ------------------------------------------------------------
   Loads the admin email whitelist.

   Preferred source: the ADMIN_EMAILS env var (comma-separated,
   e.g. "a@nu.ac.th,b@nu.ac.th"), set in Vercel -> Project ->
   Settings -> Environment Variables. This keeps the actual list of
   admins' real names/emails out of the git repo entirely -- config/
   admin-emails.json used to be committed to source control, which
   is fine for *access control* (it's never served to the browser,
   the Admin SDK-only endpoints already re-check server-side) but
   does mean anyone with read access to the repo (e.g. a public
   GitHub repo, or any collaborator added later) could read the
   admins' personal @nu.ac.th addresses straight out of git history,
   forever, even after the file is deleted or edited.

   Falls back to config/admin-emails.json if ADMIN_EMAILS isn't set,
   so local dev / a fresh clone still works without extra setup.
   config/admin-emails.json is now just a template (see the .example
   file next to it) -- keep your real list in the env var instead,
   and don't commit a filled-in version of the JSON file.
------------------------------------------------------------ */
const path = require("path");

function loadAdminEmails() {
  const fromEnv = process.env.ADMIN_EMAILS;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }

  try {
    // eslint-disable-next-line global-require
    const fallback = require(path.join(__dirname, "../../config/admin-emails.json"));
    return fallback.map((e) => e.toLowerCase());
  } catch {
    return [];
  }
}

module.exports = { loadAdminEmails };
