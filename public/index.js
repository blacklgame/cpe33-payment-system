import { GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { auth } from "./firebase.js";
import { signInWithGoogleToken } from "./auth-session.js";

const signInBtn = document.querySelector(".btn-google");
const btnIconWrapper = signInBtn.querySelector(".google-icon-wrapper");
const btnLabel = signInBtn.querySelector(".btn-label");
const errorText = document.getElementById("errorText");
const originalIconHTML = btnIconWrapper.innerHTML;

function setSigningInState(isSigningIn) {
  signInBtn.disabled = isSigningIn;
  btnLabel.textContent = isSigningIn ? "กำลังเข้าสู่ระบบ..." : "Sign in with NU Account";
  btnIconWrapper.innerHTML = isSigningIn ? '<span class="spinner"></span>' : originalIconHTML;
}

function describeError(err) {
  if (err.status === 403 || err.message?.includes("roster") || err.message?.includes("whitelisted")) {
    return `<strong>อีเมลของคุณไม่มีสิทธิ์เข้าถึงระบบ</strong><br><small>(${err.message})</small>`;
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
      return "เบราว์เซอร์นี้ไม่รองรับการล็อกอิน Google (เช่น เปิดจากแอป LINE/Facebook/Chrome บน iOS) กรุณาเปิดลิงก์นี้ใน Safari หรือเบราว์เซอร์บน PC โดยตรง";
    default:
      return err.message || "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
  }
}

signInBtn.addEventListener("click", async () => {
  errorText.innerHTML = "";
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

