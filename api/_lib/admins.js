/* ------------------------------------------------------------
   Loads the admin email whitelist and checks if a given email
   is an authorized admin.

   Preferred source: Firestore "admins" collection, where the document
   ID is the lowercased email address. If the document exists and
   does not have enabled: false, the user is authorized. This allows
   adding/removing admins instantly without changing environment
   variables or redeploying code.

   Fallback 1: ADMIN_EMAILS env var (comma-separated, e.g. "a@nu.ac.th,b@nu.ac.th"),
   set in Vercel -> Project -> Settings -> Environment Variables.

   Fallback 2: config/admin-emails.json if ADMIN_EMAILS isn't set,
   so local dev / a fresh clone still works without extra setup.
------------------------------------------------------------ */
const admin = require("firebase-admin");
const path = require("path");

// Ensure firebase-admin is initialized if credentials are available
if (!admin.apps.length) {
  try {
    const saJson = Buffer.from(
      process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "",
      "base64"
    ).toString("utf8");

    if (saJson) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(saJson))
      });
    }
  } catch (err) {
    console.warn("Could not initialize firebase-admin in admins.js:", err.message);
  }
}

async function checkIsAdmin(email) {
  if (!email || typeof email !== "string") return false;
  const lowerEmail = email.toLowerCase().trim();

  // 1. Try checking Firestore database
  if (admin.apps.length) {
    try {
      const db = admin.firestore();
      // First try direct lookup using lowercased email as document ID
      const adminDoc = await db.collection("admins").doc(lowerEmail).get();
      if (adminDoc.exists) {
        const data = adminDoc.data();
        if (data && data.enabled === false) {
          return false;
        }
        return true;
      }

      // Fallback: list all admins and check case-insensitively (handles manual creation casing / field mistakes)
      const adminsSnap = await db.collection("admins").get();
      for (const doc of adminsSnap.docs) {
        const docIdLower = doc.id.toLowerCase().trim();
        const data = doc.data();
        const emailField = data && typeof data.email === "string" ? data.email.toLowerCase().trim() : null;

        if (docIdLower === lowerEmail || emailField === lowerEmail) {
          if (data && data.enabled === false) {
            return false;
          }
          return true;
        }
      }
    } catch (err) {
      console.warn("Failed to check admin status in Firestore, falling back:", err.message);
    }
  }

  // 2. Fallback to ADMIN_EMAILS env var
  const fromEnv = process.env.ADMIN_EMAILS;
  if (fromEnv && fromEnv.trim().length > 0) {
    const envEmails = fromEnv
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return envEmails.includes(lowerEmail);
  }

  // 3. Fallback to config/admin-emails.json
  try {
    // eslint-disable-next-line global-require
    const fallback = require(path.join(__dirname, "../../config/admin-emails.json"));
    const fallbackEmails = fallback.map((e) => e.toLowerCase());
    return fallbackEmails.includes(lowerEmail);
  } catch {
    return false;
  }
}

module.exports = { checkIsAdmin };
