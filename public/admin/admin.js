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
import { auth } from "./firebase-admin.js";

const signInBtn = document.querySelector(".btn-google");
const btnIconWrapper = signInBtn.querySelector(".google-icon-wrapper");
const btnLabel = signInBtn.querySelector(".btn-label");
const errorText = document.getElementById("errorText");
const originalIconHTML = btnIconWrapper.innerHTML;

function detectInAppBrowser() {
  const ua = navigator.userAgent || navigator.vendor || window.opera || "";
  return /Instagram|Line|FBAN|FBAV|FB_IAB|FB4A|Messenger|Twitter|TikTok|musical_ly|BytedanceWebview|MicroMessenger/i.test(ua);
}

function renderInAppWarning() {
  if (!detectInAppBrowser()) return;

  const container = document.createElement("div");
  container.className = "inapp-warning-box";
  container.style.cssText = `
    margin-top: 20px;
    padding: 16px;
    background: rgba(245, 179, 0, 0.12);
    border: 1px solid var(--warn, #f5b300);
    border-radius: var(--radius-md, 14px);
    color: var(--text, #f3f4f8);
    font-size: 0.92rem;
    line-height: 1.6;
    text-align: left;
    max-width: 360px;
    width: 100%;
  `;

  container.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; font-weight:700; color:var(--warn, #f5b300); margin-bottom:6px;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      กรุณาเปิดใน Safari หรือ Chrome
    </div>
    <div style="font-size:0.88rem; color:var(--text-dim, #9aa1b4); margin-bottom:10px;">
      คุณกำลังเปิดผ่านเบราว์เซอร์ในแอป (เช่น Instagram/LINE) ซึ่งไม่อนุญาตให้เข้าสู่ระบบด้วย Google
    </div>
    <div style="font-size:0.86rem; line-height:1.5; margin-bottom:12px;">
      1. กดปุ่มจุดสามจุด <b>(⋯ หรือ ⋮)</b> มุมขวาบน<br>
      2. เลือก <b>"เปิดด้วย Safari"</b> หรือ <b>"เปิดด้วย Chrome"</b>
    </div>
    <button type="button" id="copyUrlBtn" style="width:100%; padding:9px 14px; background:var(--surface-2, #191c27); color:var(--text, #fff); border:1px solid var(--border-strong, rgba(255,255,255,0.2)); border-radius:var(--radius-pill, 999px); font-size:0.85rem; font-weight:600; cursor:pointer;">
      📋 คัดลอกลิงก์เพื่อนำไปเปิดใน Safari/Chrome
    </button>
  `;

  if (errorText && errorText.parentNode) {
    errorText.parentNode.insertBefore(container, errorText);
  }

  const copyBtn = container.querySelector("#copyUrlBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(window.location.href).then(() => {
        copyBtn.textContent = "✅ คัดลอกลิงก์แล้ว! นำไปวางใน Safari/Chrome";
        setTimeout(() => {
          copyBtn.textContent = "📋 คัดลอกลิงก์เพื่อนำไปเปิดใน Safari/Chrome";
        }, 4000);
      }).catch(() => {
        alert("ลิงก์เว็บไซต์: " + window.location.href);
      });
    });
  }
}

// Check on load
renderInAppWarning();

function setSigningInState(isSigningIn) {
  signInBtn.disabled = isSigningIn;
  btnLabel.textContent = isSigningIn ? "กำลังเข้าสู่ระบบ..." : "Sign in with NU Account";
  btnIconWrapper.innerHTML = isSigningIn ? '<span class="spinner"></span>' : originalIconHTML;
}

// On redirect back from dashboard.html with ?error=forbidden, show a
// clear message explaining which email was rejected and how to fix it.
// This happens when the user signs in with a valid Google account but
// that email isn't in the Firestore "admins" collection yet.
(function showForbiddenError() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("error") !== "forbidden") return;
  const email = params.get("email") || "";
  errorText.replaceChildren();

  const title = document.createElement("strong");
  title.textContent = email ? `อีเมล ${email} ไม่มีสิทธิ์เข้าถึงระบบผู้ดูแล` : "บัญชีนี้ไม่มีสิทธิ์เข้าถึงระบบผู้ดูแล";

  const br1 = document.createElement("br");
  const detail = document.createElement("span");
  detail.textContent = "กรุณาเพิ่มอีเมลนี้ใน Firebase → Firestore → คอลเลกชัน ";

  const code = document.createElement("code");
  code.textContent = "admins";

  const detailEnd = document.createTextNode(" แล้วลองใหม่");

  errorText.appendChild(title);
  errorText.appendChild(br1);
  errorText.appendChild(detail);
  errorText.appendChild(code);
  errorText.appendChild(detailEnd);

  if (email) {
    const br2 = document.createElement("br");
    const small = document.createElement("small");
    small.textContent = `(Email "${email}" is not whitelisted. Add it to the Firestore "admins" collection.)`;
    errorText.appendChild(br2);
    errorText.appendChild(small);
  }
})();

function describeError(err) {
  if (detectInAppBrowser()) {
    return `<strong>โปรดเปิดใน Safari หรือ Chrome</strong><br><small>เบราว์เซอร์ในแอป (เช่น Instagram/LINE/FB) ไม่รองรับการล็อกอิน Google<br>กรุณากดเมนู ⋯ มุมขวาบน แล้วเลือก "เปิดใน Safari / Chrome"</small>`;
  }
  if (err.message?.includes("missing initial state") || err.message?.includes("sessionStorage") || err.message?.includes("storage-partitioned")) {
    return `<strong>เบราว์เซอร์ไม่อนุญาตการเชื่อมต่อเซสชันข้ามโดเมน</strong><br><small>กรุณาเปิดใน Safari หรือ Chrome โดยตรง หรือปิดโหมด Private/Incognito แล้วลองอีกครั้ง</small>`;
  }
  switch (err.code) {
    case "auth/popup-blocked":
      return "เบราว์เซอร์บล็อกป๊อปอัพ กรุณาอนุญาตป๊อปอัพสำหรับเว็บไซต์นี้แล้วลองใหม่";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "หน้าต่างเข้าสู่ระบบถูกปิดก่อนเสร็จสิ้น กรุณาลองใหม่อีกครั้ง";
    case "auth/network-request-failed":
      return "การเชื่อมต่อขัดข้อง กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
    case "auth/operation-not-supported-in-this-environment":
      return "เบราว์เซอร์นี้ไม่รองรับการล็อกอิน Google (เช่น เปิดจากแอป LINE/Instagram/Facebook) กรุณาเปิดลิงก์นี้ใน Safari หรือ Chrome โดยตรง";
    default:
      return "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
  }
}

signInBtn.addEventListener("click", async () => {
  errorText.textContent = "";

  if (detectInAppBrowser()) {
    errorText.innerHTML = describeError(new Error("in-app"));
    const warningBox = document.querySelector(".inapp-warning-box");
    if (warningBox) warningBox.scrollIntoView({ behavior: "smooth" });
    return;
  }

  setSigningInState(true);

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
    setSigningInState(false);
  }
});
