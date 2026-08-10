/* ------------------------------------------------------------
   Admin-side management script for Firestore admins collection.
   Run this from your own computer with Node.js installed.
   It does NOT run in the browser and bypasses firestore.rules.

   Supports the same authentication methods as seed-users.js:
   1. serviceAccountKey.json in the project root
   2. process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 env var
   3. Google Application Default Credentials (gcloud auth application-default login)

   Usage:
     node scripts/manage-admin.js add <email>
     node scripts/manage-admin.js remove <email>
     node scripts/manage-admin.js list
 ------------------------------------------------------------ */
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

// Initialize Firebase Admin SDK
const keyPath = path.join(__dirname, "..", "serviceAccountKey.json");

if (fs.existsSync(keyPath)) {
  admin.initializeApp({
    credential: admin.credential.cert(require(keyPath)),
  });
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  const saJson = Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
    "base64"
  ).toString("utf8");
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(saJson))
  });
} else {
  console.log(
    "No serviceAccountKey.json or FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable found.\n" +
    "Falling back to Application Default Credentials..."
  );
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: "cpe33-79979", // default fallback project ID from seed-users.js
  });
}

const db = admin.firestore();

function printUsage() {
  console.log(`
Usage:
  node scripts/manage-admin.js add <email>    - Add or re-enable an admin email
  node scripts/manage-admin.js remove <email> - Disable/remove an admin email
  node scripts/manage-admin.js list           - List all admin documents in Firestore
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printUsage();
    return;
  }

  const action = args[0].toLowerCase();

  if (action === "list") {
    const snap = await db.collection("admins").get();
    if (snap.empty) {
      console.log("No admins found in Firestore collection 'admins'.");
      return;
    }
    console.log("Registered Admins in Firestore:");
    console.log("----------------------------------------");
    snap.forEach((doc) => {
      const data = doc.data();
      const status = data.enabled === false ? "DISABLED" : "ACTIVE";
      const addedAt = data.addedAt ? data.addedAt.toDate().toLocaleString() : "Unknown";
      console.log(`- ${doc.id} [${status}] (Added: ${addedAt})`);
    });
    console.log("----------------------------------------");
    return;
  }

  if (action === "add" || action === "remove") {
    const email = args[1];
    if (!email || !email.includes("@")) {
      console.error("Error: Please provide a valid email address.");
      printUsage();
      process.exit(1);
    }
    const lowerEmail = email.toLowerCase().trim();

    if (action === "add") {
      await db.collection("admins").doc(lowerEmail).set({
        enabled: true,
        addedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      console.log(`Success: Added/Enabled admin '${lowerEmail}' in Firestore.`);
    } else {
      // We can either set enabled: false or delete the document.
      // Setting enabled: false is safer because it keeps audit/history, but delete is cleaner.
      // Let's delete it so there's no dangling disabled accounts unless they want to keep them.
      // Actually, let's delete it so it's completely removed, but we can also set enabled: false if requested.
      // Deleting is cleanest and simplest for the whitelist fallback to take over.
      await db.collection("admins").doc(lowerEmail).delete();
      console.log(`Success: Removed admin '${lowerEmail}' from Firestore.`);
    }
    return;
  }

  console.error(`Error: Unknown action '${action}'`);
  printUsage();
  process.exit(1);
}

main()
  .catch((err) => {
    console.error("Execution failed:", err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
