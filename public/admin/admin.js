/* ------------------------------------------------------------
   Admin login via Google Sign-In.

   This whitelist is the UI gate only -- it decides who gets past
   this login screen. The REAL security check happens again,
   independently, on the server in api/admin/delete-slip.js (never
   trust a check that only runs in the user's own browser). Keep
   both lists in sync when you add/remove an admin.

   Add every admin's exact @nu.ac.th email below.
------------------------------------------------------------ */
const ADMIN_EMAILS = [
  "natthaphatb69@nu.ac.th",
  "saranphatk69@nu.ac.th"
];

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth } from "../firebase.js";

const signInBtn = document.querySelector(".btn-google");
const errorText = document.getElementById("errorText");

function isWhitelisted(email) {
  if (!email) return false;
  return ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email.toLowerCase());
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
    const email = result.user.email;

    if (!isWhitelisted(email)) {
      await signOut(auth);
      errorText.textContent = `บัญชี ${email} ไม่มีสิทธิ์เข้าถึงหน้าแอดมิน`;
      signInBtn.disabled = false;
      return;
    }

    window.location.href = "./dashboard.html";
  } catch (err) {
    console.error("Admin sign-in failed:", err);
    errorText.textContent = "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
    signInBtn.disabled = false;
  }
});
