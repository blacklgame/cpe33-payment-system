/* ------------------------------------------------------------
   One-time admin-side seed script. Run this from your own
   computer with Node.js installed -- it does NOT run in the
   browser, so it isn't affected by anonymous-auth timing or
   firestore.rules at all (the Admin SDK has full access by
   design). This is the most reliable way to load the roster.

   Two ways to authenticate -- use whichever works for you:

   OPTION A -- service account key (simplest, but some Google
   Workspace / school organizations block key creation entirely):
     1. npm install
     2. Firebase Console -> Project settings -> Service accounts
        -> Generate new private key. Save it as
        serviceAccountKey.json in this project's root folder.
        NEVER commit or share this file -- it's a full admin
        credential. (Already in .gitignore.)
     3. node scripts/seed-users.js

   OPTION B -- Application Default Credentials (use this if you
   see "Key creation is not allowed on this service account" --
   this authenticates as YOUR Google account instead, no key
   file needed):
     1. Install the Google Cloud CLI:
        https://cloud.google.com/sdk/docs/install
     2. Run: gcloud auth application-default login
        (opens a browser -- log in with the Google account that
        has access to this Firebase project)
     3. Run: gcloud auth application-default set-quota-project cpe33-79979
     4. npm install
     5. node scripts/seed-users.js
        (it automatically falls back to this if no
        serviceAccountKey.json is present)
------------------------------------------------------------ */
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const keyPath = path.join(__dirname, "..", "serviceAccountKey.json");

if (fs.existsSync(keyPath)) {
  console.log("Using serviceAccountKey.json for authentication.");
  admin.initializeApp({
    credential: admin.credential.cert(require(keyPath)),
  });
} else {
  console.log(
    "No serviceAccountKey.json found -- falling back to Application " +
    "Default Credentials. If this fails, run:\n" +
    "  gcloud auth application-default login\n" +
    "first. See the comment at the top of this file for full setup."
  );
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: "cpe33-79979",
  });
}

const db = admin.firestore();

// The roster used to live in public/user.js -- but that meant every
// visitor's browser downloaded every student's name/email/Nu ID,
// logged in or not. It's now a private JSON file that never ships
// to the browser; the app looks students up via Firestore instead
// (see api/mint-session.js).
const rosterPath = path.join(__dirname, "roster-data.json");
const USERS = JSON.parse(fs.readFileSync(rosterPath, "utf8"));

async function main() {
  const ids = Object.keys(USERS);
  console.log(`Found ${ids.length} users in scripts/roster-data.json. Writing to Firestore...`);

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
