/* ------------------------------------------------------------
   Admin-only Firebase init.
   Uses browserSessionPersistence so the admin Google session
   lives in sessionStorage (per-tab) and NEVER conflicts with
   the student custom-token session stored in localStorage by
   the shared firebase.js. This means:
     - Admin tab keeps its own Google session regardless of what
       student tabs do.
     - Student tabs are completely unaffected by admin logins.
   This resolves the "switched to student page → admin got logged out"
   bug caused by both pages sharing the same localStorage auth key.
------------------------------------------------------------ */
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  initializeAuth,
  browserSessionPersistence,
  browserPopupRedirectResolver
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCUrDGPZq3gpD7ccee_CCaT89KUeSjmUnQ",
  authDomain: "cpe33-79979.firebaseapp.com",
  projectId: "cpe33-79979",
  storageBucket: "cpe33-79979.firebasestorage.app",
  messagingSenderId: "130126006962",
  appId: "1:130126006962:web:bf07c5b9db7634b16c57ab"
};

// Use a named app "admin" so it doesn't collide with the default
// app used by student pages in the same tab (edge case: someone
// opens admin and student pages in the same tab -- very unlikely
// but safe to handle).
const existingAdmin = getApps().find(a => a.name === "admin");
const adminApp = existingAdmin || initializeApp(firebaseConfig, "admin");

const auth = initializeAuth(adminApp, {
  persistence: browserSessionPersistence,
  popupRedirectResolver: browserPopupRedirectResolver
});

export { adminApp as app, auth };
