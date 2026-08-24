const admin = require("firebase-admin");
const { rateLimit, clientIp } = require("./_lib/rate-limit");

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
      const googlePhotoUrl = decodedToken.picture || null;

      if (googlePhotoUrl && userData.photoURL !== googlePhotoUrl) {
        try {
          await db.collection("users").doc(nuid).set({
            photoURL: googlePhotoUrl,
            lastGoogleSync: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } catch (syncErr) {
          console.warn("Failed to sync Google photoURL to users collection:", syncErr);
        }
      }

      const token = await admin.auth().createCustomToken(nuid);
      response.status(200).json({
        token,
        nuid,
        name: userData.name || decodedToken.name || "",
        email: userData.email || googleEmail,
        photoURL: googlePhotoUrl || userData.photoURL || null
      });
      return;
    }

    // No Bearer token provided — reject. The only supported login
    // flow is Google OAuth: the client must send a valid Google ID
    // token via Authorization: Bearer <idToken> (see index.js).
    response.status(400).json({ error: "Missing authorization token" });
    return;
  } catch (err) {
    console.error("mint-session failed:", err);
    response.status(500).json({ error: "Internal server error" });
  }
};

