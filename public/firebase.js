/* ------------------------------------------------------------
   Firebase project init. Shared by every page that talks to
   Firestore/Storage -- they each `import` from this file.
------------------------------------------------------------ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import {
  initializeAuth,
  browserLocalPersistence,
  browserPopupRedirectResolver
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

// Note: Firebase Storage is no longer used -- payment slip images now
// upload straight to Cloudinary from the browser instead (Firebase
// Storage requires the paid Blaze plan even for small usage). See
// public/logined/index.js.

const firebaseConfig = {
  apiKey: "AIzaSyCUrDGPZq3gpD7ccee_CCaT89KUeSjmUnQ",
  authDomain: "cpe33-79979.firebaseapp.com",
  projectId: "cpe33-79979",
  storageBucket: "cpe33-79979.firebasestorage.app",
  messagingSenderId: "130126006962",
  appId: "1:130126006962:web:bf07c5b9db7634b16c57ab"
};

const app = initializeApp(firebaseConfig);

const db = getFirestore(app);

/* ------------------------------------------------------------
   Auth persistence: forced to browserLocalPersistence (plain
   localStorage) instead of letting the SDK pick its default
   (IndexedDB).

   WHY: Safari (desktop and iOS) has a long-standing, still-open bug
   where its IndexedDB implementation intermittently hangs or throws
   an AbortError when the Firebase SDK reads/writes the auth session
   -- see firebase/firebase-js-sdk issues #7888, #8860, #9802. When
   that happens mid-session, the SDK can't confirm the session is
   still there and fires onAuthStateChanged(null) even though the
   admin never signed out and their session is still valid. That's
   what was bouncing the admin dashboard back to login a few seconds
   after an action -- not a real sign-out, just a failed local read.
   It's also implicated in signInWithPopup being unreliable on iOS
   Safari, since the SDK does an IndexedDB read/write as part of
   preparing the popup, before it ever opens the window.

   browserLocalPersistence uses plain localStorage instead, which
   doesn't have this failure mode. Trade-off: auth state no longer
   syncs live across multiple open tabs of this site in the same
   browser (IndexedDB persistence does that via a storage listener;
   localStorage persistence does not). That's a non-issue here --
   nothing in this app depends on multi-tab sync.

   browserPopupRedirectResolver is passed explicitly so the popup
   sign-in flow (admin.js) doesn't fall back to trying to load the
   IndexedDB-based resolver.

   This app has no anonymous fallback sign-in anymore. Two real
   auth flows share this file:
   - Students: signed in via a custom token bound to their nuid,
     minted by /api/mint-session (see public/auth-session.js).
     firestore.rules requires request.auth.uid == nuid to read a
     payments/{nuid} doc, so a student page must call
     signInAsNuid()/ensureSignedInAsNuid() before reading Firestore.
   - Admins: signed in with Google via signInWithPopup (admin.js).

   Neither flow happens automatically on page load anymore -- each
   page is responsible for calling the right one.
------------------------------------------------------------ */
const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
  popupRedirectResolver: browserPopupRedirectResolver
});

export { app, db, auth };
