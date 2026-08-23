import { GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { auth } from "./firebase.js";
import { signInWithGoogleToken } from "./auth-session.js";

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

function describeError(err) {
  if (detectInAppBrowser()) {
    return `<strong>โปรดเปิดใน Safari หรือ Chrome</strong><br><small>เบราว์เซอร์ในแอป (เช่น Instagram/LINE/FB) ไม่รองรับการล็อกอิน Google<br>กรุณากดเมนู ⋯ มุมขวาบน แล้วเลือก "เปิดใน Safari / Chrome"</small>`;
  }
  if (err.status === 403 || err.message?.includes("roster") || err.message?.includes("whitelisted")) {
    return `<strong>อีเมลของคุณไม่มีสิทธิ์เข้าถึงระบบ</strong><br><small>(${err.message})</small>`;
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
      return err.message || "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
  }
}

signInBtn.addEventListener("click", async () => {
  errorText.innerHTML = "";

  if (detectInAppBrowser()) {
    errorText.innerHTML = describeError(new Error("in-app"));
    const warningBox = document.querySelector(".inapp-warning-box");
    if (warningBox) warningBox.scrollIntoView({ behavior: "smooth" });
    return;
  }

  setSigningInState(true);

  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ hd: "nu.ac.th", prompt: "select_account" });

    const result = await signInWithPopup(auth, provider);
    const idToken = await result.user.getIdToken();

    const { nuid, name, email } = await signInWithGoogleToken(idToken);

    // Save user details for session persistence across pages
    sessionStorage.setItem("cpe33_user", JSON.stringify({ id: nuid, name, email }));

    window.location.href = "./logined/index.html";
  } catch (err) {
    console.error("Sign-in failed:", err);
    errorText.innerHTML = describeError(err);
    setSigningInState(false);
  }
});

