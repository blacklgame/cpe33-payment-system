/* ------------------------------------------------------------
   1) Sync this page to whichever Nu ID logged in
------------------------------------------------------------ */
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { db, auth } from "../firebase.js";
import { ensureSignedInAsNuid } from "../auth-session.js";

const raw = sessionStorage.getItem("cpe33_user");
let user = null;

if (!raw) {
  // No one is logged in -> send back to the login page
  window.location.href = "../index.html";
} else {
  user = JSON.parse(raw);

  document.getElementById("userName").textContent = user.name;
  document.getElementById("userEmail").textContent = user.email;

  // Show first initial inside the avatar circle instead of leaving it empty
  const avatarEl = document.querySelector(".avatar-placeholder");
  if (avatarEl) {
    avatarEl.textContent = user.name ? user.name.trim()[0].toUpperCase() : "?";
  }
}

document.getElementById("logoutLink").addEventListener("click", (e) => {
  e.preventDefault();
  sessionStorage.removeItem("cpe33_user");
  window.location.href = "../index.html";
});

/* ------------------------------------------------------------
   2) Choose File -> preview -> Send (upload payment slip)

   Slip images still upload straight from the browser to Cloudinary
   (keeps us off Vercel's serverless function body-size limit for
   a multi-MB photo) -- but as a SIGNED upload now, not unsigned.

   The old unsigned flow let the browser choose its own public_id,
   which meant anyone could upload to (or overwrite!) any student's
   slip path via devtools, regardless of who was logged in. Now
   /api/sign-upload (server-side, using the Cloudinary API secret)
   decides the public_id and signs overwrite:false, after checking
   the caller's Firebase ID token actually matches the nuid they're
   uploading for. The browser can only use the exact signature it
   was given, for the exact public_id the server chose.
------------------------------------------------------------ */
const CLOUDINARY_CLOUD_NAME = "egcc6hml";

const fileInput = document.getElementById("fileInput");
const fileNameLabel = document.getElementById("fileName");
const previewWrap = document.getElementById("previewWrap");
const previewImg = document.getElementById("previewImg");
const sendBtn = document.getElementById("sendBtn");
const statusText = document.getElementById("statusText");

let selectedFile = null;

if (user) {
  ensureSignedInAsNuid(user.id)
    .then(() => getDoc(doc(db, "payments", user.id)))
    .then((snap) => {
      if (snap.exists()) {
        const paymentData = snap.data();
        if (paymentData.studentStatus === "termination") {
          fileInput.disabled = true;
          sendBtn.disabled = true;
          statusText.textContent = "บัญชีของคุณพ้นสภาพนิสิตแล้ว ไม่สามารถอัปโหลดสลิปได้ กรุณาติดต่อผู้ดูแลระบบ";
          statusText.className = "status-text error";
          const chooseBtn = document.querySelector(".btn-choose");
          if (chooseBtn) {
            chooseBtn.style.pointerEvents = "none";
            chooseBtn.style.opacity = "0.5";
          }
        }
      }
    })
    .catch((err) => {
      console.error("Failed to check user status:", err);
    });
}

fileInput.addEventListener("change", () => {
  statusText.textContent = "";
  statusText.className = "status-text";

  const file = fileInput.files[0];

  if (!file) {
    selectedFile = null;
    fileNameLabel.textContent = "ยังไม่ได้เลือกไฟล์";
    previewWrap.classList.remove("show");
    sendBtn.disabled = true;
    return;
  }

  if (!file.type.startsWith("image/")) {
    statusText.textContent = "กรุณาเลือกไฟล์รูปภาพเท่านั้น";
    statusText.className = "status-text error";
    fileInput.value = "";
    selectedFile = null;
    previewWrap.classList.remove("show");
    sendBtn.disabled = true;
    return;
  }

  const MAX_BYTES = 10 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    statusText.textContent = "ไฟล์ใหญ่เกินไป (สูงสุด 10MB) กรุณาเลือกไฟล์อื่น";
    statusText.className = "status-text error";
    fileInput.value = "";
    selectedFile = null;
    previewWrap.classList.remove("show");
    sendBtn.disabled = true;
    return;
  }

  selectedFile = file;
  fileNameLabel.textContent = file.name;
  sendBtn.disabled = false;

  // Show a preview of the picked image
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    previewWrap.classList.add("show");
  };
  reader.readAsDataURL(file);
});

sendBtn.addEventListener("click", async () => {
  if (!selectedFile || !user) return;

  sendBtn.disabled = true;
  sendBtn.textContent = "กำลังส่ง...";
  statusText.textContent = "";
  statusText.className = "status-text";

  try {
    // Make sure we're signed in as this nuid before asking for a
    // signature or calling submit-slip -- both now check the ID
    // token against the nuid in the request.
    await ensureSignedInAsNuid(user.id);
    const idToken = await auth.currentUser.getIdToken();

    // 1) Ask our server for a signed-upload ticket: it decides the
    //    public_id (always under slips/{this user's own id}/...)
    //    and signs overwrite:false, so the browser can't pick or
    //    clobber any other path.
    const signRes = await fetch("/api/sign-upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ nuid: user.id })
    });

    if (!signRes.ok) {
      const errBody = await signRes.json().catch(() => ({}));
      throw new Error(errBody.error || "Could not start upload");
    }

    const { timestamp, signature, publicId, apiKey, cloudName } = await signRes.json();

    // 2) Upload straight to Cloudinary using that signature. Every
    //    signed param here must match exactly what the server
    //    signed, or Cloudinary rejects the upload.
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("api_key", apiKey);
    formData.append("timestamp", timestamp);
    formData.append("signature", signature);
    formData.append("public_id", publicId);
    formData.append("overwrite", "false");

    const uploadRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName || CLOUDINARY_CLOUD_NAME}/image/upload`,
      { method: "POST", body: formData }
    );

    if (!uploadRes.ok) {
      const errBody = await uploadRes.json().catch(() => ({}));
      throw new Error(errBody.error?.message || "Upload failed");
    }

    const result = await uploadRes.json();
    const slipUrl = result.secure_url;

    // 3) Tell our server the slip was uploaded, so it can record it
    //    as PENDING review. Note this does NOT mark the student as
    //    paid -- only an admin approving it from the dashboard does
    //    that (see api/submit-slip.js for why: a direct client write
    //    here used to be exactly how a fake slip could self-approve).
    const submitRes = await fetch("/api/submit-slip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        nuid: user.id,
        fileName: selectedFile.name,
        slipUrl,
        slipPublicId: result.public_id
      })
    });

    if (!submitRes.ok) {
      const errBody = await submitRes.json().catch(() => ({}));
      throw new Error(errBody.error || "Submit failed");
    }

    statusText.textContent = `ส่ง "${selectedFile.name}" แล้ว รอผู้ดูแลระบบตรวจสอบ`;
    statusText.className = "status-text success";
  } catch (err) {
    console.error("Upload failed:", err);
    statusText.textContent = "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
    statusText.className = "status-text error";
  } finally {
    sendBtn.textContent = "ส่ง (Send)";
    sendBtn.disabled = false;
  }
});
