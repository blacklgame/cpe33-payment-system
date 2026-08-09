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

   Uses signInWithRedirect (full-page navigation to Google and back)
   instead of signInWithPopup. Safari's tracking prevention (and
   many in-app browsers/webviews) blocks the third-party storage a
   popup-based sign-in needs, which is why the popup would open,
   flash, and fail on iOS Safari specifically -- the redirect flow
   doesn't rely on that, so it works everywhere.
------------------------------------------------------------ */
import {
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth } from "../firebase.js";

const signInBtn = document.querySelector(".btn-google");
const errorText = document.getElementById("errorText");

const adminEmailsPromise = fetch("./admin-emails.json").then((res) => res.json());

async function isWhitelisted(email) {
  if (!email) return false;
  const adminEmails = await adminEmailsPromise;
  return adminEmails.map((e) => e.toLowerCase()).includes(email.toLowerCase());
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

    // This navigates the whole page away to Google -- execution
    // stops here. The rest of the flow picks back up in the
    // getRedirectResult() call below once Google sends the user
    // back to this same page.
    await signInWithRedirect(auth, provider);
  } catch (err) {
    console.error("Admin sign-in failed:", err);
    errorText.textContent = "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
    signInBtn.disabled = false;
  }
});

// Runs on every load of this page, including the one right after
// Google redirects back here. getRedirectResult() resolves with the
// signed-in user on that return trip, and with null on a normal,
// unrelated page load (so this is a no-op most of the time).
(async () => {
  try {
    const result = await getRedirectResult(auth);
    if (!result) return;

    const email = result.user.email;

    if (!(await isWhitelisted(email))) {
      await signOut(auth);
      errorText.textContent = `บัญชี ${email} ไม่มีสิทธิ์เข้าถึงหน้าแอดมิน`;
      return;
    }

    window.location.href = "./dashboard.html";
  } catch (err) {
    console.error("Admin sign-in redirect failed:", err);
    errorText.textContent = "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
  }
})();
