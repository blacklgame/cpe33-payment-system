const admin = require("firebase-admin");
const { rateLimit, clientIp } = require("./_lib/rate-limit");
const { isValidNuid } = require("./_lib/validate");

/* ------------------------------------------------------------
   Mints a Firebase Auth custom token with uid == nuid.
   
   Supports Google OAuth authentication:
   - Verifies caller's Google ID token via Authorization: Bearer <idToken>
   - Checks that email ends with @nu.ac.th
   - Looks up user document in Firestore "users" collection where email == googleEmail
   - Obtains the student's Nu ID (the document ID)
   - Mints a custom token with uid == nuid for owner-based Firestore rules & API validation
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
    if (rateLimit(`mint-session:${clientIp(request)}`, { limit: 20, windowMs: 60_000 }).limited) {
      response.status(429).json({ error: "Too many requests, please slow down" });
      return;
    }

    const authHeader = request.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const db = admin.firestore();

    // 1. Google OAuth Flow (Primary authentication mechanism)
    if (idToken) {
      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
      } catch (authErr) {
        console.error("Invalid Google ID token:", authErr);
        response.status(401).json({ error: "Invalid or expired Google authentication token" });
        return;
      }

      const googleEmail = (decodedToken.email || "").toLowerCase().trim();
      if (!googleEmail) {
        response.status(400).json({ error: "Google account does not provide an email address" });
        return;
      }

      if (!googleEmail.endsWith("@nu.ac.th")) {
        response.status(403).json({ error: "Only @nu.ac.th email accounts are allowed" });
        return;
      }

      // Find user document in Firestore 'users' collection where email matches
      const querySnap = await db.collection("users").where("email", "==", googleEmail).limit(1).get();
      if (querySnap.empty) {
        response.status(403).json({ error: `Email ${googleEmail} is not whitelisted in the student roster` });
        return;
      }

      const userDoc = querySnap.docs[0];
      const nuid = userDoc.id;
      const userData = userDoc.data() || {};

      const token = await admin.auth().createCustomToken(nuid);
      response.status(200).json({
        token,
        nuid,
        name: userData.name || "",
        email: userData.email || googleEmail
      });
      return;
    }

    // 2. Legacy fallback via nuid in request body
    const { nuid } = request.body || {};
    if (!nuid || typeof nuid !== "string") {
      response.status(400).json({ error: "Missing authorization token or nuid" });
      return;
    }

    if (!isValidNuid(nuid)) {
      response.status(400).json({ error: "Invalid Nu ID format" });
      return;
    }

    const userSnap = await db.collection("users").doc(nuid).get();
    if (!userSnap.exists) {
      response.status(404).json({ error: "Student ID does not exist in the roster" });
      return;
    }

    const userData = userSnap.data() || {};
    const token = await admin.auth().createCustomToken(nuid);
    response.status(200).json({
      token,
      nuid,
      name: userData.name || "",
      email: userData.email || ""
    });
  } catch (err) {
    console.error("mint-session failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};

