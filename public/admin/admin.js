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
------------------------------------------------------------ */
import {
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth } from "../firebase.js";

const signInBtn = document.querySelector(".btn-google");
const errorText = document.getElementById("errorText");

// Note: We no longer fetch admin-emails.json here -- the file has
// been moved out of the public folder and is no longer accessible
// from the browser. The real whitelist check happens server-side
// (api/admin/check-admin.js). The dashboard.js auth gate (which runs
// immediately on load) will redirect non-admins back to this login
// page before any data is shown.

function describeError(err) {
  switch (err.code) {
    case "auth/popup-blocked":
      return "เบราว์เซอร์บล็อกป๊อปอัพ กรุณาอนุญาตป๊อปอัพสำหรับเว็บไซต์นี้แล้วลองใหม่";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "หน้าต่างเข้าสู่ระบบถูกปิดก่อนเสร็จสิ้น กรุณาลองใหม่อีกครั้ง";
    case "auth/network-request-failed":
      return "การเชื่อมต่อขัดข้อง กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
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
    provider.setCustomParameters({ hd: "nu.ac.th" });

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
