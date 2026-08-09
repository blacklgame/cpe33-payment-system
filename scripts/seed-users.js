/* ------------------------------------------------------------
   One-time admin-side seed script. Run this from your own
   computer with Node.js installed -- it does NOT run in the
   browser, so it isn't affected by anonymous-auth timing or
   firestore.rules at all (the Admin SDK has full access by
   design). This is the most reliable way to load the roster.

   Setup (once):
     1. npm install firebase-admin
     2. Firebase Console -> Project settings (gear icon) ->
        Service accounts -> Generate new private key.
        Save the downloaded file as serviceAccountKey.json in
        this project's root folder (same level as package.json).
        NEVER commit this file or upload it anywhere public --
        it's a full admin credential for your Firebase project.
     3. Add "serviceAccountKey.json" to .gitignore.

   Run:
     node scripts/seed-users.js
------------------------------------------------------------ */
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const keyPath = path.join(__dirname, "..", "serviceAccountKey.json");
if (!fs.existsSync(keyPath)) {
  console.error(
    "Missing serviceAccountKey.json in the project root.\n" +
    "Firebase Console -> Project settings -> Service accounts -> Generate new private key."
  );
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(keyPath)),
});

const db = admin.firestore();

// public/user.js is plain JS (`const USERS = {...}`), not JSON --
// load it the same way a browser would, just without a DOM.
const userJsPath = path.join(__dirname, "..", "public", "user.js");
const userJsSource = fs.readFileSync(userJsPath, "utf8");
const USERS = (() => {
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  const fn = new Function("module", "exports", `${userJsSource}\nmodule.exports = USERS;`);
  fn(module, module.exports);
  return module.exports;
})();

async function main() {
  const ids = Object.keys(USERS);
  console.log(`Found ${ids.length} users in public/user.js. Writing to Firestore...`);

  const chunkSize = 450; // Firestore batch limit is 500
  let written = 0;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = db.batch();
    const chunk = ids.slice(i, i + chunkSize);

    chunk.forEach((id) => {
      const u = USERS[id];
      batch.set(db.collection("users").doc(id), {
        name: u.name,
        email: u.email,
        stat: u.stat,
      });
    });

    await batch.commit();
    written += chunk.length;
    console.log(`Wrote ${written} / ${ids.length}...`);
  }

  console.log("Done! Verify in Firebase Console -> Firestore -> Data.");
  console.log("Remember: if you'd temporarily loosened firestore.rules for the");
  console.log("old browser-based seed page, you can now lock users back to");
  console.log("`allow write: if false;` since this script doesn't need it.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
