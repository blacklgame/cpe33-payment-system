/* ------------------------------------------------------------
   Admin login via Google Sign-In.

   This whitelist is the UI gate only -- it decides who gets past
   this login screen. The REAL security check happens again,
   independently, on the server in api/admin/delete-slip.js and
   api/admin/set-status.js (never trust a check that only runs in
   the user's own browser).

   The admin email list itself lives in ONE place --
   admin-emails.json, next to this file -- and every page/function
   reads from it, so adding or removing an admin only ever means
   editing that one JSON file.

   Uses signInWithPopup instead of signInWithRedirect. This project's
   authDomain (cpe33-79979.firebaseapp.com) is a different domain
   than the app itself (the Vercel deployment) -- the redirect flow
   needs to read its result back through that other domain's
   storage, which modern browsers increasingly block by default as
   third-party storage. That's what was breaking sign-in: the
   redirect would silently fail every time, bounce back to this
   page with no error, and firebase.js's "nobody's signed in" fallback
   would immediately create a fresh anonymous user (visible as an
   ever-growing pile of anonymous rows in the Firebase console with
   no Google-linked user ever appearing).

   signInWithPopup keeps this page open and gets its result back over
   a live postMessage channel between the popup and this window
   instead, so it isn't affected by that storage restriction. The
   trade-off is that some strict in-app browsers/webviews block
   popups outright -- if that happens here, the catch block below
   shows a clear error instead of failing silently.

   iOS Safari specifically: signInWithPopup was unreliable there
   because, before it can open the popup, the SDK also needs to
   read/write its local auth-session storage -- and Safari's
   IndexedDB (the SDK's default storage) has a known intermittent
   hang/abort bug (firebase/firebase-js-sdk #7888, #8860). Any delay
   there breaks Safari's "popup must open in direct response to the
   click" rule and the popup gets silently blocked or closed. Fixed
   in ../firebase.js by forcing plain localStorage
   (browserLocalPersistence) instead of IndexedDB for auth storage,
   so there's nothing left that can hang before the popup opens.

   If a phone browser is a LINE/Facebook/Instagram in-app browser
   rather than actual Safari, no code change here can fix that --
   Google blocks Google Sign-In entirely inside those embedded
   webviews (error: disallowed_useragent) as an anti-phishing
   measure. The only fix is opening this page in real Safari/Chrome
   (the in-app browser's own "Open in Safari/Chrome" menu option).
------------------------------------------------------------ */
import {
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { auth } from "../firebase.js";

const signInBtn = document.querySelector(".btn-google");
const errorText = document.getElementById("errorText");

// On redirect back from dashboard.html with ?error=forbidden, show a
// clear message explaining which email was rejected and how to fix it.
// This happens when the user signs in with a valid Google account but
// that email isn't in the Firestore "admins" collection yet.
(function showForbiddenError() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("error") !== "forbidden") return;
  const email = params.get("email") || "";
  if (email) {
    errorText.innerHTML =
      `<strong>อีเมล ${email} ไม่มีสิทธิ์เข้าถึงระบบผู้ดูแล</strong><br>` +
      `กรุณาเพิ่มอีเมลนี้ใน Firebase → Firestore → คอลเลกชัน <code>admins</code> แล้วลองใหม่<br>` +
      `<small>(Email "${email}" is not whitelisted. Add it to the Firestore "admins" collection.)</small>`;
  } else {
    errorText.innerHTML =
      `<strong>บัญชีนี้ไม่มีสิทธิ์เข้าถึงระบบผู้ดูแล</strong><br>` +
      `กรุณาใช้อีเมลที่ได้รับอนุญาต หรือเพิ่มอีเมลของคุณใน Firebase → Firestore → คอลเลกชัน <code>admins</code>`;
  }
})();

function describeError(err) {
  switch (err.code) {
    case "auth/popup-blocked":
      return "เบราว์เซอร์บล็อกป๊อปอัพ กรุณาอนุญาตป๊อปอัพสำหรับเว็บไซต์นี้แล้วลองใหม่";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "หน้าต่างเข้าสู่ระบบถูกปิดก่อนเสร็จสิ้น กรุณาลองใหม่อีกครั้ง";
    case "auth/network-request-failed":
      return "การเชื่อมต่อขัดข้อง กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
    case "auth/operation-not-supported-in-this-environment":
      return "เบราว์เซอร์นี้ไม่รองรับการล็อกอิน Google (เช่น เปิดจากแอป LINE/Facebook/Chrome บน iOS) กรุณาเปิดลิงก์นี้ใน Safari หรือเบราว์เซอร์บน PC โดยตรง";
    default:
      return "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
  }
}

signInBtn.addEventListener("click", async () => {
  errorText.textContent = "";
  signInBtn.disabled = true;

  try {
    const provider = new GoogleAuthProvider();
    // Nudges Google's account picker to show nu.ac.th accounts first.
    // This is a UX hint only, not a security boundary -- the real
    // check is isWhitelisted() below, plus the server-side check.
    provider.setCustomParameters({ hd: "nu.ac.th", prompt: "select_account" });

    const result = await signInWithPopup(auth, provider);

    // The real admin whitelist check happens on the server (dashboard.js
    // calls /api/admin/check-admin before rendering anything). We just
    // redirect to the dashboard after a successful Google sign-in; the
    // dashboard will immediately bounce non-admins back here.
    window.location.href = "./dashboard.html";
  } catch (err) {
    console.error("Admin sign-in failed:", err);
    errorText.textContent = describeError(err);
    signInBtn.disabled = false;
  }
});
