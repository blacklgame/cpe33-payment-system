import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { db, auth } from "../firebase.js";
import { ensureSignedInAsNuid, clearActivity } from "../auth-session.js";

const raw = sessionStorage.getItem("cpe33_user");
let user = null;

function renderUserProfileCard(u) {
  if (!u) return;
  const userNameEl = document.getElementById("userName");
  const userEmailEl = document.getElementById("userEmail");
  const nuidBadgeEl = document.getElementById("nuidBadge");
  const avatarEl = document.getElementById("userAvatar") || document.querySelector(".avatar-placeholder");

  if (userNameEl) userNameEl.textContent = u.name || "-";
  if (userEmailEl) userEmailEl.textContent = u.email || "-";
  if (nuidBadgeEl) nuidBadgeEl.textContent = `รหัสนิสิต: ${u.id || "-"}`;

  if (avatarEl) {
    if (u.photoURL) {
      const initial = (u.name || "?").trim()[0].toUpperCase();
      avatarEl.innerHTML = `<img src="${u.photoURL}" class="avatar-img" alt="Google Profile Picture" onerror="this.onerror=null; this.remove(); document.getElementById('userAvatar').textContent='${initial}';">`;
    } else {
      avatarEl.textContent = u.name ? u.name.trim()[0].toUpperCase() : "?";
    }
  }
}

if (!raw) {
  window.location.href = "../index.html";
} else {
  user = JSON.parse(raw);
  renderUserProfileCard(user);
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
   2) Monthly dues list + 3 Payment Options Engine
------------------------------------------------------------ */
const CLOUDINARY_CLOUD_NAME = "egcc6hml";

const monthsHint = document.getElementById("monthsHint");
const monthsList = document.getElementById("monthsList");
const monthSelect = document.getElementById("monthSelect");
const monthSelectGroup = document.getElementById("monthSelectGroup");
const installmentGroup = document.getElementById("installmentGroup");
const installmentAmountInput = document.getElementById("installmentAmount");

const optFull = document.getElementById("optFull");
const optInstallment = document.getElementById("optInstallment");
const optAll = document.getElementById("optAll");
const optFullLabel = document.getElementById("optFullLabel");
const optInstallmentLabel = document.getElementById("optInstallmentLabel");
const optAllLabel = document.getElementById("optAllLabel");

const summaryPayAmount = document.getElementById("summaryPayAmount");
const summaryRemainingAmount = document.getElementById("summaryRemainingAmount");
const summaryRemainingRow = document.getElementById("summaryRemainingRow");

const fileInput = document.getElementById("fileInput");
const fileNameLabel = document.getElementById("fileName");
const previewWrap = document.getElementById("previewWrap");
const previewImg = document.getElementById("previewImg");
const sendBtn = document.getElementById("sendBtn");
const statusText = document.getElementById("statusText");
const chooseBtn = document.querySelector(".btn-choose");

let selectedFile = null;
let terminated = false;
let loadedMonths = [];
let loadedStatusByMonth = {};
let payableMonthsList = [];

const MONTH_PILL_META = {
  paid: { label: "จ่ายแล้ว", cls: "pill-paid" },
  pending: { label: "รอตรวจสอบ", cls: "pill-pending" },
  unpaid: { label: "ยังไม่จ่าย", cls: "pill-unpaid" },
  partial: { label: "ผ่อนจ่าย", cls: "pill-partial" }
};

function disableUploadUi(message) {
  monthSelect.disabled = true;
  installmentAmountInput.disabled = true;
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

function getLedgerInfo(m, statusRecord) {
  const targetAmount = statusRecord?.targetAmount || statusRecord?.amount || m.amount || 0;
  const paidAmount = statusRecord?.paidAmount || (statusRecord?.paid ? targetAmount : 0);
  const remainingBalance = Math.max(0, targetAmount - paidAmount);
  const paid = !!(statusRecord?.paid || paidAmount >= targetAmount);
  const reviewStatus = statusRecord?.reviewStatus || null;

  return { targetAmount, paidAmount, remainingBalance, paid, reviewStatus };
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

    loadedMonths = monthsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => b.id.localeCompare(a.id));

    loadedStatusByMonth = {};
    monthlySnap.docs.forEach((d) => {
      loadedStatusByMonth[d.id] = d.data();
    });

    renderMonthsList(loadedMonths, loadedStatusByMonth);
    populateMonthPicker(loadedMonths, loadedStatusByMonth);

    if (terminated) {
      disableUploadUi("บัญชีของคุณพ้นสภาพนิสิตแล้ว ไม่สามารถอัปโหลดสลิปได้ กรุณาติดต่อผู้ดูแลระบบ");
    }
  } catch (err) {
    console.error("Failed to load months:", err);
    monthsHint.textContent = "โหลดข้อมูลไม่สำเร็จ กรุณาลองรีเฟรชหน้านี้อีกครั้ง";
  }
}

let selectedYearFilter = null;

function renderMonthsList(months, statusByMonth) {
  monthsList.innerHTML = "";

  if (months.length === 0) {
    monthsHint.textContent = "ยังไม่มีเดือนที่เปิดให้ชำระเงิน กรุณารอผู้ดูแลระบบเปิดเดือนใหม่";
    const oldTabs = document.getElementById("loginedYearTabs");
    if (oldTabs) oldTabs.remove();
    return;
  }

  monthsHint.textContent = "รายการเดือนและสถานะการชำระเงินของคุณ";

  const years = Array.from(new Set(months.map((m) => String(m.year || m.id.split("-")[0])))).sort().reverse();

  if (!selectedYearFilter || (!years.includes(selectedYearFilter) && selectedYearFilter !== "all")) {
    selectedYearFilter = years[0] || "all";
  }

  let tabsBar = document.getElementById("loginedYearTabs");
  if (!tabsBar) {
    tabsBar = document.createElement("div");
    tabsBar.id = "loginedYearTabs";
    tabsBar.className = "year-tabs-container";
    monthsList.parentNode.insertBefore(tabsBar, monthsList);
  }
  tabsBar.innerHTML = "";

  if (years.length > 1) {
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = `year-tab-btn ${selectedYearFilter === "all" ? "active" : ""}`;
    allBtn.textContent = "ทั้งหมด";
    allBtn.addEventListener("click", () => {
      selectedYearFilter = "all";
      renderMonthsList(months, statusByMonth);
    });
    tabsBar.appendChild(allBtn);
  }

  years.forEach((yr) => {
    const yrBtn = document.createElement("button");
    yrBtn.type = "button";
    yrBtn.className = `year-tab-btn ${selectedYearFilter === yr ? "active" : ""}`;
    yrBtn.textContent = `ปี ${yr}`;
    yrBtn.addEventListener("click", () => {
      selectedYearFilter = yr;
      renderMonthsList(months, statusByMonth);
    });
    tabsBar.appendChild(yrBtn);
  });

  const filteredMonths = months.filter((m) => {
    if (selectedYearFilter === "all") return true;
    const mYr = String(m.year || m.id.split("-")[0]);
    return mYr === selectedYearFilter;
  });

  filteredMonths.forEach((m) => {
    const ledger = getLedgerInfo(m, statusByMonth[m.id]);

    let labelText = MONTH_PILL_META.unpaid.label;
    let pillClass = MONTH_PILL_META.unpaid.cls;

    if (ledger.paid) {
      labelText = MONTH_PILL_META.paid.label;
      pillClass = MONTH_PILL_META.paid.cls;
    } else if (ledger.reviewStatus === "pending") {
      labelText = MONTH_PILL_META.pending.label;
      pillClass = MONTH_PILL_META.pending.cls;
    } else if (ledger.paidAmount > 0) {
      labelText = `ผ่อนชำระแล้ว ${ledger.paidAmount.toLocaleString("th-TH")}/${ledger.targetAmount.toLocaleString("th-TH")} บาท`;
      pillClass = MONTH_PILL_META.partial.cls;
    }

    const row = document.createElement("div");
    row.className = "month-row";

    const left = document.createElement("div");
    left.innerHTML = `<div class="month-row-label">${m.label || m.id}</div>` +
      `<div class="month-row-amount">เป้าหมาย: ${ledger.targetAmount.toLocaleString("th-TH")} บาท (คงเหลือ: ${ledger.remainingBalance.toLocaleString("th-TH")} บาท)</div>`;
    row.appendChild(left);

    const pill = document.createElement("span");
    pill.className = `month-row-pill ${pillClass}`;
    pill.textContent = labelText;
    row.appendChild(pill);

    monthsList.appendChild(row);
  });
}

function populateMonthPicker(months, statusByMonth) {
  payableMonthsList = months
    .map((m) => ({ m, ledger: getLedgerInfo(m, statusByMonth[m.id]) }))
    .filter(({ ledger }) => !ledger.paid && ledger.reviewStatus !== "pending" && ledger.remainingBalance > 0)
    .map(({ m, ledger }) => ({ ...m, ...ledger }));

  // Sort chronological (oldest unpaid month first)
  payableMonthsList.sort((a, b) => a.id.localeCompare(b.id));

  monthSelect.innerHTML = "";

  if (terminated) return;

  if (payableMonthsList.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "ไม่มีเดือนที่ต้องชำระ";
    monthSelect.appendChild(opt);
    disableUploadUi();
    updatePaymentSummary();
    return;
  }

  payableMonthsList.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.label || m.id} (ค้างชำระ ${m.remainingBalance.toLocaleString("th-TH")} บาท)`;
    monthSelect.appendChild(opt);
  });

  monthSelect.disabled = false;
  installmentAmountInput.disabled = false;
  fileInput.disabled = false;
  if (chooseBtn) {
    chooseBtn.style.pointerEvents = "";
    chooseBtn.style.opacity = "";
  }

  updatePaymentSummary();
}

function getSelectedPaymentMode() {
  if (optInstallment.checked) return "installment";
  if (optAll.checked) return "all";
  return "full";
}

function updatePaymentOptionUi() {
  const mode = getSelectedPaymentMode();

  optFullLabel.classList.toggle("active", mode === "full");
  optInstallmentLabel.classList.toggle("active", mode === "installment");
  optAllLabel.classList.toggle("active", mode === "all");

  if (mode === "full") {
    monthSelectGroup.style.display = "flex";
    installmentGroup.style.display = "none";
  } else if (mode === "installment") {
    monthSelectGroup.style.display = "flex";
    installmentGroup.style.display = "flex";
  } else if (mode === "all") {
    monthSelectGroup.style.display = "none";
    installmentGroup.style.display = "none";
  }

  updatePaymentSummary();
}

function updatePaymentSummary() {
  const mode = getSelectedPaymentMode();
  let payAmount = 0;
  let remainingAmount = 0;

  if (payableMonthsList.length === 0) {
    summaryPayAmount.textContent = "0.00 บาท";
    summaryRemainingAmount.textContent = "0.00 บาท";
    return;
  }

  const selectedMonthId = monthSelect.value;
  const currentMonth = payableMonthsList.find((m) => m.id === selectedMonthId) || payableMonthsList[0];

  if (mode === "full") {
    payAmount = currentMonth ? currentMonth.remainingBalance : 0;
    remainingAmount = 0;
    summaryRemainingRow.style.display = "flex";
  } else if (mode === "installment") {
    const targetRem = currentMonth ? currentMonth.remainingBalance : 0;
    const inputVal = parseFloat(installmentAmountInput.value) || 0;
    payAmount = Math.max(0, Math.min(inputVal, targetRem));
    remainingAmount = Math.max(0, targetRem - payAmount);
    summaryRemainingRow.style.display = "flex";
  } else if (mode === "all") {
    payAmount = payableMonthsList.reduce((sum, m) => sum + m.remainingBalance, 0);
    remainingAmount = 0;
    summaryRemainingRow.style.display = "flex";
  }

  summaryPayAmount.textContent = `${payAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท`;
  summaryRemainingAmount.textContent = `${remainingAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท`;
}

[optFull, optInstallment, optAll].forEach((radio) => {
  radio.addEventListener("change", updatePaymentOptionUi);
});

monthSelect.addEventListener("change", updatePaymentSummary);
installmentAmountInput.addEventListener("input", updatePaymentSummary);

if (user) {
  (async () => {
    if (typeof auth.authStateReady === "function") {
      await auth.authStateReady();
    }
    await loadMonthsAndStatus();
  })();
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

  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    previewWrap.classList.add("show");
  };
  reader.readAsDataURL(file);
});

sendBtn.addEventListener("click", async () => {
  if (!selectedFile || !user) return;

  const mode = getSelectedPaymentMode();

  if (payableMonthsList.length === 0) {
    statusText.textContent = "ไม่มีเดือนที่ต้องชำระ";
    statusText.className = "status-text error";
    return;
  }

  let targetMonthId = monthSelect.value;
  if (mode === "all") {
    targetMonthId = payableMonthsList[0].id;
  }

  if (!targetMonthId) {
    statusText.textContent = "กรุณาเลือกเดือนที่จะชำระ";
    statusText.className = "status-text error";
    return;
  }

  const selectedMonth = payableMonthsList.find((m) => m.id === targetMonthId) || payableMonthsList[0];
  let amountPaid = 0;

  if (mode === "full") {
    amountPaid = selectedMonth.remainingBalance;
  } else if (mode === "installment") {
    amountPaid = parseFloat(installmentAmountInput.value) || 0;
    if (amountPaid <= 0) {
      statusText.textContent = "กรุณาระบุจำนวนเงินผ่อนชำระที่ถูกต้อง (มากกว่า 0 บาท)";
      statusText.className = "status-text error";
      return;
    }
    if (amountPaid > selectedMonth.remainingBalance) {
      statusText.textContent = `จำนวนเงินผ่อนชำระต้องไม่เกินยอดค้างชำระ (${selectedMonth.remainingBalance} บาท)`;
      statusText.className = "status-text error";
      return;
    }
  } else if (mode === "all") {
    amountPaid = payableMonthsList.reduce((sum, m) => sum + m.remainingBalance, 0);
  }

  if (amountPaid <= 0) {
    statusText.textContent = "จำนวนเงินชำระต้องมากกว่า 0 บาท";
    statusText.className = "status-text error";
    return;
  }

  sendBtn.disabled = true;
  sendBtn.textContent = "กำลังส่ง...";
  statusText.textContent = "";
  statusText.className = "status-text";

  try {
    await ensureSignedInAsNuid(user.id);
    let idToken = await auth.currentUser.getIdToken();

    let signRes = await fetch("/api/sign-upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ nuid: user.id, monthId: targetMonthId })
    });

    if (signRes.status === 401 || signRes.status === 403) {
      idToken = await auth.currentUser.getIdToken(true);
      signRes = await fetch("/api/sign-upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ nuid: user.id, monthId: targetMonthId })
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
        monthId: targetMonthId,
        paymentMode: mode,
        amountPaid,
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
          monthId: targetMonthId,
          paymentMode: mode,
          amountPaid,
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

    statusText.textContent = `ส่ง "${selectedFile.name}" (จำนวน ${amountPaid.toLocaleString("th-TH")} บาท) แล้ว รอผู้ดูแลระบบตรวจสอบ`;
    statusText.className = "status-text success";

    fileInput.value = "";
    installmentAmountInput.value = "";
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
