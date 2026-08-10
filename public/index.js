import { signInAsNuid } from "./auth-session.js";

const form = document.getElementById("loginForm");
const input = document.getElementById("nuid");
const errorText = document.getElementById("errorText");
const enterBtn = document.getElementById("enterBtn");

// Only allow digits while typing
input.addEventListener("input", () => {
  input.value = input.value.replace(/\D/g, "");
  errorText.textContent = "";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const nuid = input.value.trim();

  if (nuid.length === 0) {
    errorText.textContent = "กรุณากรอกรหัสนิสิต (Nu ID)";
    return;
  }

  enterBtn.disabled = true;
  enterBtn.textContent = "กำลังเข้าสู่ระบบ...";

  let name, email;
  try {
    // Binds this browser's Firebase Auth session to this nuid (so
    // Firestore rules and our API routes can check ownership on
    // later pages), and confirms the nuid is on the roster -- there's
    // no local copy of the roster in the browser to check against
    // anymore (public/user.js used to leak every student's name/
    // email/Nu ID to anyone who loaded this page, logged in or not).
    ({ name, email } = await signInAsNuid(nuid));
  } catch (err) {
    console.error("Sign-in failed:", err);
    errorText.textContent = err.message === "Student ID does not exist in the roster"
      ? "ไม่พบรหัสนิสิตนี้ในระบบ กรุณาตรวจสอบอีกครั้ง"
      : "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
    enterBtn.disabled = false;
    enterBtn.textContent = "Enter";
    return;
  }

  // Save the logged-in user so the next page can sync to it
  sessionStorage.setItem("cpe33_user", JSON.stringify({ id: nuid, name, email }));

  // Go to the logged-in page
  window.location.href = "./logined/index.html";
});
