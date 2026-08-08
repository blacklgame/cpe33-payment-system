const form = document.getElementById("loginForm");
const input = document.getElementById("nuid");
const errorText = document.getElementById("errorText");
const enterBtn = document.getElementById("enterBtn");

// Only allow digits while typing
input.addEventListener("input", () => {
  input.value = input.value.replace(/\D/g, "");
  errorText.textContent = "";
});

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const nuid = input.value.trim();

  if (nuid.length === 0) {
    errorText.textContent = "กรุณากรอกรหัสนิสิต (Nu ID)";
    return;
  }

  const user = USERS[nuid];

  if (!user) {
    errorText.textContent = "ไม่พบรหัสนิสิตนี้ในระบบ กรุณาตรวจสอบอีกครั้ง";
    return;
  }

  // Save the logged-in user so the next page can sync to it
  sessionStorage.setItem("cpe33_user", JSON.stringify(user));

  enterBtn.disabled = true;
  enterBtn.textContent = "กำลังเข้าสู่ระบบ...";

  // Go to the logged-in page
  window.location.href = "./logined/index.html";
});
