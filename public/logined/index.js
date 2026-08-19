/* ------------------------------------------------------------
   1) Sync this page to whichever Nu ID logged in
------------------------------------------------------------ */
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { db, auth } from "../firebase.js";
import { ensureSignedInAsNuid, clearActivity } from "../auth-session.js";

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

document.getElementById("logoutLink").addEventListener("click", async (e) => {
  e.preventDefault();
  sessionStorage.removeItem("cpe33_user");
  clearActivity();
  try {
    await signOut(auth);
  } catch (err) {
    console.error("Sign-out error:", err);
  }
  window.location.href = "../index.html";
});

/* ------------------------------------------------------------
   2) Monthly dues list + month-scoped slip upload

   Slip images still upload straight from the browser to Cloudinary
   (keeps us off Vercel's serverless function body-size limit for
   a multi-MB photo) -- but as a SIGNED upload, not unsigned.
   /api/sign-upload (server-side, using the Cloudinary API secret)
   decides the public_id -- now under slips/{nuid}/{monthId}/... --
   and signs overwrite:false, after checking the caller's Firebase
   ID token actually matches the nuid they're uploading for, that
   the picked month exists, and that this month isn't already paid
   or pending. The browser can only use the exact signature it was
   given, for the exact public_id the server chose.
------------------------------------------------------------ */
const CLOUDINARY_CLOUD_NAME = "egcc6hml";

const monthsHint = document.getElementById("monthsHint");
const monthsList = document.getElementById("monthsList");
const monthSelect = document.getElementById("monthSelect");
const fileInput = document.getElementById("fileInput");
const fileNameLabel = document.getElementById("fileName");
const previewWrap = document.getElementById("previewWrap");
const previewImg = document.getElementById("previewImg");
const sendBtn = document.getElementById("sendBtn");
const statusText = document.getElementById("statusText");
const chooseBtn = document.querySelector(".btn-choose");

let selectedFile = null;
let terminated = false;

const MONTH_PILL_META = {
  paid: { label: "จ่ายแล้ว", cls: "pill-paid" },
  pending: { label: "รอตรวจสอบ", cls: "pill-pending" },
  unpaid: { label: "ยังไม่จ่าย", cls: "pill-unpaid" }
};

function disableUploadUi(message) {
  monthSelect.disabled = true;
  fileInput.disabled = true;
  sendBtn.disabled = true;
  if (chooseBtn) {
    chooseBtn.style.pointerEvents = "none";
    chooseBtn.style.opacity = "0.5";
  }
  if (message) {
    statusText.textContent = message;
    statusText.className = "status-text error";
  }
}

async function loadMonthsAndStatus() {
  if (!user) return;

  try {
    await ensureSignedInAsNuid(user.id);

    const [paymentSnap, monthsSnap, monthlySnap] = await Promise.all([
      getDoc(doc(db, "payments", user.id)),
      getDocs(collection(db, "months")),
      getDocs(collection(db, "payments", user.id, "months"))
    ]);

    if (paymentSnap.exists() && paymentSnap.data().studentStatus === "termination") {
      terminated = true;
    }

    const months = monthsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => b.id.localeCompare(a.id));

    const statusByMonth = {};
    monthlySnap.docs.forEach((d) => {
      statusByMonth[d.id] = d.data();
    });

    renderMonthsList(months, statusByMonth);
    populateMonthPicker(months, statusByMonth);

    if (terminated) {
      disableUploadUi("บัญชีของคุณพ้นสภาพนิสิตแล้ว ไม่สามารถอัปโหลดสลิปได้ กรุณาติดต่อผู้ดูแลระบบ");
    }
  } catch (err) {
    console.error("Failed to load months:", err);
    monthsHint.textContent = "โหลดข้อมูลไม่สำเร็จ กรุณาลองรีเฟรชหน้านี้อีกครั้ง";
  }
}

function statusKeyFor(record) {
  if (!record) return "unpaid";
  if (record.paid) return "paid";
  if (record.reviewStatus === "pending") return "pending";
  return "unpaid";
}

function renderMonthsList(months, statusByMonth) {
  monthsList.innerHTML = "";

  if (months.length === 0) {
    monthsHint.textContent = "ยังไม่มีเดือนที่เปิดให้ชำระเงิน กรุณารอผู้ดูแลระบบเปิดเดือนใหม่";
    return;
  }

  monthsHint.textContent = "รายการเดือนและสถานะการชำระเงินของคุณ";

  months.forEach((m) => {
    const key = statusKeyFor(statusByMonth[m.id]);
    const meta = MONTH_PILL_META[key];

    const row = document.createElement("div");
    row.className = "month-row";

    const left = document.createElement("div");
    left.innerHTML = `<div class="month-row-label">${m.label || m.id}</div>` +
      `<div class="month-row-amount">${Number(m.amount || 0).toLocaleString("th-TH")} บาท</div>`;
    row.appendChild(left);

    const pill = document.createElement("span");
    pill.className = `month-row-pill ${meta.cls}`;
    pill.textContent = meta.label;
    row.appendChild(pill);

    monthsList.appendChild(row);
  });
}

// The upload picker only offers months that still need a slip --
// no reason to let a student pick a month that's already paid or
// already has a slip pending review (sign-upload.js would reject it
// anyway; filtering here just avoids a confusing round trip).
function populateMonthPicker(months, statusByMonth) {
  const payable = months.filter((m) => statusKeyFor(statusByMonth[m.id]) === "unpaid");

  monthSelect.innerHTML = "";

  if (terminated) return;

  if (payable.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "ไม่มีเดือนที่ต้องชำระ";
    monthSelect.appendChild(opt);
    disableUploadUi();
    return;
  }

  payable.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.label || m.id} (${Number(m.amount || 0).toLocaleString("th-TH")} บาท)`;
    monthSelect.appendChild(opt);
  });

  monthSelect.disabled = false;
  fileInput.disabled = false;
  if (chooseBtn) {
    chooseBtn.style.pointerEvents = "";
    chooseBtn.style.opacity = "";
  }
}

// Wait for Firebase Auth to restore the custom-token session from
// localStorage before reading Firestore. Without this, a page refresh
// would fire loadMonthsAndStatus() before auth.currentUser is set,
// causing every Firestore read (which requires auth.uid == nuid) to
// fail with a permission-denied error and show "โหลดข้อมูลไม่สำเร็จ".
if (user) {
  let loaded = false;
  onAuthStateChanged(auth, (firebaseUser) => {
    if (loaded) return; // only run once
    if (firebaseUser && firebaseUser.uid === user.id) {
      loaded = true;
      loadMonthsAndStatus();
    } else if (!firebaseUser) {
      // Firebase hasn't restored yet — authStateReady inside
      // ensureSignedInAsNuid will handle the wait. Kick it off anyway
      // so the page loads as soon as auth is ready.
      loaded = true;
      loadMonthsAndStatus();
    }
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

  const monthId = monthSelect.value;
  if (!monthId) {
    statusText.textContent = "กรุณาเลือกเดือนที่จะชำระ";
    statusText.className = "status-text error";
    return;
  }

  sendBtn.disabled = true;
  sendBtn.textContent = "กำลังส่ง...";
  statusText.textContent = "";
  statusText.className = "status-text";

  try {
    // Make sure we're signed in as this nuid before asking for a
    // signature or calling submit-slip -- both now check the ID
    // token against the nuid in the request.
    await ensureSignedInAsNuid(user.id);
    let idToken = await auth.currentUser.getIdToken();

    let signRes = await fetch("/api/sign-upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ nuid: user.id, monthId })
    });

    if (signRes.status === 401 || signRes.status === 403) {
      idToken = await auth.currentUser.getIdToken(true);
      signRes = await fetch("/api/sign-upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ nuid: user.id, monthId })
      });
    }

    if (!signRes.ok) {
      const errBody = await signRes.json().catch(() => ({}));
      throw new Error(errBody.error || "Could not start upload");
    }

    const { timestamp, signature, publicId, apiKey, cloudName } = await signRes.json();

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

    let submitRes = await fetch("/api/submit-slip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        nuid: user.id,
        monthId,
        fileName: selectedFile.name,
        slipUrl,
        slipPublicId: result.public_id
      })
    });

    if (submitRes.status === 401 || submitRes.status === 403) {
      idToken = await auth.currentUser.getIdToken(true);
      submitRes = await fetch("/api/submit-slip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          nuid: user.id,
          monthId,
          fileName: selectedFile.name,
          slipUrl,
          slipPublicId: result.public_id
        })
      });
    }

    if (!submitRes.ok) {
      const errBody = await submitRes.json().catch(() => ({}));
      throw new Error(errBody.error || "Submit failed");
    }

    statusText.textContent = `ส่ง "${selectedFile.name}" แล้ว รอผู้ดูแลระบบตรวจสอบ`;
    statusText.className = "status-text success";

    // Reset the file picker and refresh the months list/picker so
    // this month now shows "รอตรวจสอบ" and drops out of the upload
    // dropdown (it's no longer payable until an admin acts on it).
    fileInput.value = "";
    selectedFile = null;
    fileNameLabel.textContent = "ยังไม่ได้เลือกไฟล์";
    previewWrap.classList.remove("show");
    await loadMonthsAndStatus();
  } catch (err) {
    console.error("Upload failed:", err);
    statusText.textContent = err.message && err.message.includes("already")
      ? err.message
      : "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
    statusText.className = "status-text error";
  } finally {
    sendBtn.textContent = "ส่ง (Send)";
    sendBtn.disabled = false;
  }
});

/* ------------------------------------------------------------
   3) Copy Account Number to Clipboard
------------------------------------------------------------ */
const btnCopy = document.getElementById("btnCopyNumber");
const bankAccountNumber = document.getElementById("bankAccountNumber");
const copyTooltip = document.getElementById("copyTooltip");

if (btnCopy && bankAccountNumber && copyTooltip) {
  btnCopy.addEventListener("click", async () => {
    // Extract digits only for easy bank transfer paste
    const cleanNumber = bankAccountNumber.textContent.replace(/-/g, "");
    try {
      await navigator.clipboard.writeText(cleanNumber);
      copyTooltip.textContent = "คัดลอกสำเร็จ!";
      copyTooltip.classList.add("copied");
      btnCopy.style.color = "#10b981";
      btnCopy.style.borderColor = "rgba(16, 185, 129, 0.5)";
      btnCopy.style.backgroundColor = "rgba(16, 185, 129, 0.1)";

      setTimeout(() => {
        copyTooltip.textContent = "คัดลอก";
        copyTooltip.classList.remove("copied");
        btnCopy.style.color = "";
        btnCopy.style.borderColor = "";
        btnCopy.style.backgroundColor = "";
      }, 2000);
    } catch (err) {
      console.error("Failed to copy text:", err);
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = cleanNumber;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
        copyTooltip.textContent = "คัดลอกสำเร็จ!";
        copyTooltip.classList.add("copied");
        setTimeout(() => {
          copyTooltip.textContent = "คัดลอก";
          copyTooltip.classList.remove("copied");
        }, 2000);
      } catch (fallbackErr) {
        copyTooltip.textContent = "คัดลอกไม่สำเร็จ";
      }
      document.body.removeChild(textarea);
    }
  });
}
