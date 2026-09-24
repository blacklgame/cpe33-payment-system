/* ------------------------------------------------------------
   Event Detail page (event-detail.html)
   - Reads ?id= from the URL to know which event to load.
   - Shows 3 donut charts for this event's รายรับ/รายจ่าย/คงเหลือ.
   - Lists all transactions below with edit & delete controls.
   - Add / Edit transaction modal with quantity × price preview.
------------------------------------------------------------ */
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { auth } from "./firebase-admin.js";
import { touchActivity, checkIsInactive, clearActivity } from "../auth-session.js";

// ── URL param ─────────────────────────────────────────────────
const eventId = new URLSearchParams(location.search).get("id");
if (!eventId) {
  location.href = "./events.html";
}

// ── DOM refs ─────────────────────────────────────────────────
const welcomeMsg     = document.getElementById("welcomeMsg");
const mainContent    = document.getElementById("mainContent");
const loadingText    = document.getElementById("loadingText");
const donutStrip     = document.getElementById("donutStrip");
const txSectionHeader= document.getElementById("txSectionHeader");
const txContainer    = document.getElementById("txContainer");
const logoutLink     = document.getElementById("logoutLink");
const addTxBtn       = document.getElementById("addTxBtn");

const detailEmoji    = document.getElementById("detailEmoji");
const detailName     = document.getElementById("detailName");
const detailSubtitle = document.getElementById("detailSubtitle");

// Donut refs
const donutFgIncome  = document.getElementById("donutFgIncome");
const donutFgExpense = document.getElementById("donutFgExpense");
const donutFgBalance = document.getElementById("donutFgBalance");
const donutPctIncome = document.getElementById("donutPctIncome");
const donutPctExpense= document.getElementById("donutPctExpense");
const donutPctBalance= document.getElementById("donutPctBalance");
const totalIncomeEl  = document.getElementById("totalIncome");
const totalExpenseEl = document.getElementById("totalExpense");
const totalBalanceEl = document.getElementById("totalBalance");
const incomeCountEl  = document.getElementById("incomeCount");
const expenseCountEl = document.getElementById("expenseCount");
const totalCountEl   = document.getElementById("totalCount");

// Modal refs
const txModal        = document.getElementById("txModal");
const txModalTitle   = document.getElementById("txModalTitle");
const txModalSave    = document.getElementById("txModalSave");
const txModalCancel  = document.getElementById("txModalCancel");
const txModalStatus  = document.getElementById("txModalStatus");
const typeIncome     = document.getElementById("typeIncome");
const typeExpense    = document.getElementById("typeExpense");
const txLabel        = document.getElementById("txLabel");
const txAmount       = document.getElementById("txAmount");
const txQty          = document.getElementById("txQty");
const txNote         = document.getElementById("txNote");
const amountPreview  = document.getElementById("amountPreview");

/// Receipt upload refs
const txReceiptFile          = document.getElementById("txReceiptFile");
const receiptUploadBox       = document.getElementById("receiptUploadBox");
const receiptDropZone        = document.getElementById("receiptDropZone");
const receiptGalleryPreview  = document.getElementById("receiptGalleryPreview");
const receiptThumbsGrid      = document.getElementById("receiptThumbsGrid");
const btnAddMoreReceipts     = document.getElementById("btnAddMoreReceipts");
const btnClearAllReceipts    = document.getElementById("btnClearAllReceipts");

// Receipt viewer lightbox refs
const receiptViewerModal     = document.getElementById("receiptViewerModal");
const receiptViewerTitle     = document.getElementById("receiptViewerTitle");
const receiptViewerSub       = document.getElementById("receiptViewerSub");
const receiptViewerClose     = document.getElementById("receiptViewerClose");
const receiptImgCounter      = document.getElementById("receiptImgCounter");
const lbRotateLeft           = document.getElementById("lbRotateLeft");
const lbRotateRight          = document.getElementById("lbRotateRight");
const lbZoomIn               = document.getElementById("lbZoomIn");
const lbZoomOut              = document.getElementById("lbZoomOut");
const lbZoomReset            = document.getElementById("lbZoomReset");
const lbNavPrev              = document.getElementById("lbNavPrev");
const lbNavNext              = document.getElementById("lbNavNext");
const receiptViewerImg       = document.getElementById("receiptViewerImg");
const receiptViewerOpenTab   = document.getElementById("receiptViewerOpenTab");
const receiptViewerCloseBtn  = document.getElementById("receiptViewerCloseBtn");
const lightboxStripContainer = document.getElementById("lightboxStripContainer");
const lightboxStripThumbs    = document.getElementById("lightboxStripThumbs");

// ── State ─────────────────────────────────────────────────────
let currentUser       = null;
let transactions      = [];
let selectedType      = "income";
let editingTxId       = null;

// Multi-receipt state for Add/Edit Modal
let existingReceipts  = []; // [ { url, publicId } ]
let selectedNewFiles  = []; // [ { file, previewUrl } ]
let deletedPublicIds  = [];

// Lightbox state
let lbImages          = []; // [ { url, title, subtitle } ]
let lbCurrentIndex    = 0;
let lbRotation        = 0;
let lbZoom            = 1;

function goToLogin() {
  clearActivity();
  location.href = "./login.html";
}

// ── Auth guard ────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (typeof auth.authStateReady === "function") {
    await auth.authStateReady();
  }

  if (checkIsInactive()) {
    goToLogin();
    return;
  }

  if (!user || !user.email) { goToLogin(); return; }

  currentUser = user;
  touchActivity();
  welcomeMsg.textContent = user.displayName || user.email || "Admin";
  mainContent.style.display = "";
  await loadEventDetail();
});

logoutLink.addEventListener("click", async (e) => {
  e.preventDefault();
  clearActivity();
  await signOut(auth);
  location.href = "./login.html";
});

// ── Helpers ───────────────────────────────────────────────────
function fmt(n) {
  return "฿\u00a0" + Number(n).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

async function getToken(forceRefresh = false) {
  if (!currentUser && auth.currentUser) {
    currentUser = auth.currentUser;
  }
  if (!currentUser) return null;
  return await currentUser.getIdToken(forceRefresh);
}

async function apiFetch(url, opts = {}) {
  if (checkIsInactive()) {
    goToLogin();
    throw new Error("Session expired due to inactivity");
  }

  touchActivity();

  let tok = await getToken();
  let res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tok}`,
      ...(opts.headers || {})
    }
  });

  if (res.status === 401 || res.status === 403) {
    tok = await getToken(true);
    res = await fetch(url, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tok}`,
        ...(opts.headers || {})
      }
    });
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Load event detail ─────────────────────────────────────────
async function loadEventDetail() {
  loadingText.style.display = "block";
  loadingText.textContent = "กำลังโหลดข้อมูล...";
  donutStrip.style.display = "none";
  txSectionHeader.style.display = "none";
  txContainer.innerHTML = "";

  try {
    const data = await apiFetch(`/api/admin/events-api?action=get-transactions&eventId=${encodeURIComponent(eventId)}`);

    if (data.error) { location.href = "./login.html"; return; }

    // Populate header
    const ev = data.event;
    document.title = `${ev.emoji} ${ev.name} — CPE33`;
    detailEmoji.textContent = ev.emoji || "🎉";
    detailName.textContent  = ev.name  || "กิจกรรม";
    detailSubtitle.textContent = `สร้างโดย ${ev.createdBy || "—"} · ${
      ev.createdAt
        ? new Date(ev.createdAt).toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })
        : "—"
    }`;

    transactions = data.transactions || [];
    loadingText.style.display = "none";
    donutStrip.style.display = "";
    txSectionHeader.style.display = "";

    updateDonutCharts();
    renderTransactions();
  } catch (err) {
    console.error(err);
    if (err.message.includes("401") || err.message.includes("403")) {
      location.href = "./login.html";
    } else {
      loadingText.textContent = "เกิดข้อผิดพลาด: " + err.message;
    }
  }
}

// ── Donut chart ───────────────────────────────────────────────
function setDonut(fgEl, pctEl, pct) {
  const d = Math.max(0, Math.min(100, pct));
  fgEl.setAttribute("stroke-dasharray", `${d < 1 ? 0 : d} ${100 - (d < 1 ? 0 : d)}`);
  pctEl.textContent = Math.round(d) + "%";
}

function updateDonutCharts() {
  let totalIncome  = 0;
  let totalExpense = 0;
  let iCount = 0;
  let eCount = 0;

  transactions.forEach((t) => {
    if (t.type === "income")  { totalIncome  += t.totalAmount || 0; iCount++; }
    if (t.type === "expense") { totalExpense += t.totalAmount || 0; eCount++; }
  });

  const balance = totalIncome - totalExpense;
  const grand   = Math.max(totalIncome, totalExpense, 1);

  requestAnimationFrame(() => {
    setDonut(donutFgIncome,  donutPctIncome,  (totalIncome  / grand) * 100);
    setDonut(donutFgExpense, donutPctExpense, (totalExpense / grand) * 100);
    setDonut(donutFgBalance, donutPctBalance, balance < 0 ? 0 : (balance / grand) * 100);
  });

  totalIncomeEl.textContent  = fmt(totalIncome);
  totalExpenseEl.textContent = fmt(totalExpense);
  totalBalanceEl.textContent = fmt(balance);
  totalBalanceEl.style.color = balance < 0 ? "var(--danger)" : "";
  incomeCountEl.textContent  = `${iCount} รายการ`;
  expenseCountEl.textContent = `${eCount} รายการ`;
  totalCountEl.textContent   = `${transactions.length} รายการรวม`;
}

// ── Render transactions ───────────────────────────────────────
function renderTransactions() {
  txContainer.innerHTML = "";

  if (transactions.length === 0) {
    txContainer.innerHTML = `
      <div class="tx-empty">
        <div class="empty-icon">📋</div>
        <p>ยังไม่มีรายการ</p>
        <p style="margin-top:6px;font-size:0.85rem;">กดปุ่ม "เพิ่มรายการ" เพื่อบันทึกรายรับหรือรายจ่ายแรก</p>
      </div>`;
    return;
  }

  transactions.forEach((tx) => {
    const isIncome = tx.type === "income";
    const card = document.createElement("div");
    card.className = `tx-card ${isIncome ? "tx-income" : "tx-expense"}`;
    card.dataset.txId = tx.id;

    const dateStr = tx.createdAt
      ? new Date(tx.createdAt).toLocaleDateString("th-TH", { month: "short", day: "numeric" })
      : "";
    const timeStr = tx.createdAt
      ? new Date(tx.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
      : "";
    const qtyLabel = tx.quantity > 1 ? ` × ${tx.quantity} ชิ้น` : "";
    const noteHtml = tx.note ? `<span style="opacity:0.65;"> · ${escapeHtml(tx.note)}</span>` : "";

    const txReceipts = Array.isArray(tx.receipts) && tx.receipts.length > 0
      ? tx.receipts
      : (tx.receiptUrl ? [{ url: tx.receiptUrl }] : []);

    const countLabel = txReceipts.length > 1 ? ` (${txReceipts.length})` : "";
    const receiptBadgeHtml = txReceipts.length > 0 ? `
      <button class="receipt-badge-btn" data-view-receipt="${tx.id}" title="ดูรูปภาพใบเสร็จ / หลักฐาน">
        🧾 ดูใบเสร็จ${countLabel}
      </button>` : "";

    card.innerHTML = `
      <div class="tx-type-pill">${isIncome ? "+" : "−"}</div>
      <div class="tx-info">
        <div class="tx-label-row">
          <span class="tx-label">${escapeHtml(tx.label)}</span>
          ${receiptBadgeHtml}
        </div>
        <div class="tx-meta">${fmt(tx.amount)} ต่อหน่วย${qtyLabel} · ${dateStr} ${timeStr}${noteHtml}</div>
      </div>
      <div class="tx-amount-col">
        <div class="tx-amount">${isIncome ? "+" : "−"}${fmt(tx.totalAmount)}</div>
        ${tx.quantity > 1 ? `<div class="tx-unit-price">${fmt(tx.amount)} × ${tx.quantity}</div>` : ""}
      </div>
      <div class="tx-actions">
        <button class="icon-btn" data-edit="${tx.id}" title="แก้ไข">✏️</button>
        <button class="icon-btn icon-btn-danger" data-del="${tx.id}" data-label="${escapeHtml(tx.label)}" title="ลบ">🗑️</button>
      </div>
    `;

    card.querySelector("[data-edit]").addEventListener("click", () => openEditTx(tx.id));
    card.querySelector("[data-del]").addEventListener("click", () => confirmDeleteTx(tx.id, tx.label));

    const receiptBtn = card.querySelector("[data-view-receipt]");
    if (receiptBtn) {
      receiptBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const imgs = txReceipts.map((r, idx) => ({
          url: r.url,
          title: tx.label,
          subtitle: `${dateStr} ${timeStr}${qtyLabel}${txReceipts.length > 1 ? ` · รูปที่ ${idx + 1}/${txReceipts.length}` : ""}`
        }));
        openReceiptLightbox(imgs, 0);
      });
    }

    txContainer.appendChild(card);
  });
}

// ── Multi-Receipt File Handling in Modal ──────────────────────
function resetReceiptState() {
  existingReceipts = [];
  selectedNewFiles = [];
  deletedPublicIds = [];
  txReceiptFile.value = "";
  renderReceiptThumbs();
}

function renderReceiptThumbs() {
  receiptThumbsGrid.innerHTML = "";
  const totalCount = existingReceipts.length + selectedNewFiles.length;

  if (totalCount === 0) {
    receiptGalleryPreview.style.display = "none";
    receiptDropZone.style.display = "flex";
    return;
  }

  receiptDropZone.style.display = "none";
  receiptGalleryPreview.style.display = "flex";

  // 1. Render existing uploaded receipts
  existingReceipts.forEach((r, idx) => {
    const item = document.createElement("div");
    item.className = "receipt-thumb-item";
    item.innerHTML = `
      <img src="${escapeHtml(r.url)}" alt="ใบเสร็จ">
      <button type="button" class="receipt-thumb-remove" title="ลบรูปนี้">✕</button>
    `;

    item.querySelector(".receipt-thumb-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      if (r.publicId) deletedPublicIds.push(r.publicId);
      existingReceipts.splice(idx, 1);
      renderReceiptThumbs();
    });

    item.addEventListener("click", () => {
      const allImgs = [
        ...existingReceipts.map((er) => ({ url: er.url, title: txLabel.value.trim() || "ใบเสร็จ", subtitle: "แนบไว้แล้ว" })),
        ...selectedNewFiles.map((nf) => ({ url: nf.previewUrl, title: txLabel.value.trim() || "ใบเสร็จ", subtitle: "พรีวิวก่อนบันทึก" }))
      ];
      openReceiptLightbox(allImgs, idx);
    });

    receiptThumbsGrid.appendChild(item);
  });

  // 2. Render newly selected local files
  selectedNewFiles.forEach((nf, idx) => {
    const item = document.createElement("div");
    item.className = "receipt-thumb-item";
    item.innerHTML = `
      <img src="${nf.previewUrl}" alt="ใบเสร็จใหม่">
      <button type="button" class="receipt-thumb-remove" title="ลบรูปนี้">✕</button>
    `;

    item.querySelector(".receipt-thumb-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      selectedNewFiles.splice(idx, 1);
      renderReceiptThumbs();
    });

    item.addEventListener("click", () => {
      const allImgs = [
        ...existingReceipts.map((er) => ({ url: er.url, title: txLabel.value.trim() || "ใบเสร็จ", subtitle: "แนบไว้แล้ว" })),
        ...selectedNewFiles.map((f) => ({ url: f.previewUrl, title: txLabel.value.trim() || "ใบเสร็จ", subtitle: "พรีวิวก่อนบันทึก" }))
      ];
      openReceiptLightbox(allImgs, existingReceipts.length + idx);
    });

    receiptThumbsGrid.appendChild(item);
  });
}

function handleIncomingFiles(fileList) {
  if (!fileList || fileList.length === 0) return;

  const validTypes = ["image/jpeg", "image/png", "image/webp"];
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    if (!validTypes.includes(file.type)) {
      txModalStatus.textContent = `ไฟล์ ${file.name} ไม่ใช่รูปภาพ JPG, PNG หรือ WEBP`;
      continue;
    }
    if (file.size > 10 * 1024 * 1024) {
      txModalStatus.textContent = `ไฟล์ ${file.name} ขนาดเกิน 10MB`;
      continue;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      selectedNewFiles.push({ file, previewUrl: e.target.result });
      renderReceiptThumbs();
    };
    reader.readAsDataURL(file);
  }
}

// Click trigger
receiptDropZone.addEventListener("click", () => txReceiptFile.click());
btnAddMoreReceipts.addEventListener("click", () => txReceiptFile.click());

txReceiptFile.addEventListener("change", (e) => {
  if (e.target.files) handleIncomingFiles(e.target.files);
  txReceiptFile.value = "";
});

// Drag and drop
receiptUploadBox.addEventListener("dragover", (e) => {
  e.preventDefault();
  receiptUploadBox.classList.add("dragover");
});

receiptUploadBox.addEventListener("dragleave", () => {
  receiptUploadBox.classList.remove("dragover");
});

receiptUploadBox.addEventListener("drop", (e) => {
  e.preventDefault();
  receiptUploadBox.classList.remove("dragover");
  if (e.dataTransfer && e.dataTransfer.files) {
    handleIncomingFiles(e.dataTransfer.files);
  }
});

// Clear all
btnClearAllReceipts.addEventListener("click", () => {
  existingReceipts.forEach((r) => { if (r.publicId) deletedPublicIds.push(r.publicId); });
  existingReceipts = [];
  selectedNewFiles = [];
  renderReceiptThumbs();
});

// ── Add transaction modal ─────────────────────────────────────
addTxBtn.addEventListener("click", () => openAddTxModal());

function openAddTxModal() {
  editingTxId = null;
  txModalTitle.textContent = "เพิ่มรายการ";
  txLabel.value  = "";
  txAmount.value = "";
  txQty.value    = "1";
  txNote.value   = "";
  amountPreview.textContent = "";
  txModalStatus.textContent = "";
  resetReceiptState();
  setTxType("income");
  openModal(txModal);
  txLabel.focus();
}

function openEditTx(txId) {
  const tx = transactions.find((t) => t.id === txId);
  if (!tx) return;
  editingTxId = txId;
  txModalTitle.textContent = "แก้ไขรายการ";
  txLabel.value  = tx.label  || "";
  txAmount.value = tx.amount || "";
  txQty.value    = tx.quantity || 1;
  txNote.value   = tx.note   || "";
  txModalStatus.textContent = "";
  resetReceiptState();

  if (Array.isArray(tx.receipts) && tx.receipts.length > 0) {
    existingReceipts = tx.receipts.map((r) => ({ url: r.url, publicId: r.publicId || null }));
  } else if (tx.receiptUrl) {
    existingReceipts = [{ url: tx.receiptUrl, publicId: tx.receiptPublicId || null }];
  }
  renderReceiptThumbs();

  setTxType(tx.type || "income");
  updateAmountPreview();
  openModal(txModal);
  txLabel.focus();
}

// Type toggle
function setTxType(type) {
  selectedType = type;
  typeIncome.className  = "type-btn" + (type === "income"  ? " active-income"  : "");
  typeExpense.className = "type-btn" + (type === "expense" ? " active-expense" : "");
}

typeIncome.addEventListener("click",  () => setTxType("income"));
typeExpense.addEventListener("click", () => setTxType("expense"));

// Live amount preview
function updateAmountPreview() {
  const a = parseFloat(txAmount.value);
  const q = parseInt(txQty.value, 10);
  if (a > 0 && q > 0) {
    const total = a * q;
    amountPreview.textContent = `รวม: ${total.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท`;
  } else {
    amountPreview.textContent = "";
  }
}

txAmount.addEventListener("input", updateAmountPreview);
txQty.addEventListener("input",    updateAmountPreview);

// Save
txModalSave.addEventListener("click", async () => {
  const label  = txLabel.value.trim();
  const amount = parseFloat(txAmount.value);
  const qty    = parseInt(txQty.value, 10) || 1;
  const note   = txNote.value.trim();

  if (!label)              { txModalStatus.textContent = "กรุณากรอกชื่อรายการ";     return; }
  if (!amount || amount <= 0) { txModalStatus.textContent = "กรุณากรอกราคาที่ถูกต้อง"; return; }

  txModalSave.disabled = true;
  txModalStatus.textContent = "";

  try {
    const finalReceipts = [...existingReceipts];

    // Upload newly attached files if any
    if (selectedNewFiles.length > 0) {
      for (let i = 0; i < selectedNewFiles.length; i++) {
        const nf = selectedNewFiles[i];
        txModalStatus.textContent = `กำลังอัปโหลดรูปภาพ (${i + 1}/${selectedNewFiles.length})...`;

        const signTicket = await apiFetch("/api/admin/events-api", {
          method: "POST",
          body: JSON.stringify({ action: "sign-receipt-upload", eventId })
        });

        const formData = new FormData();
        formData.append("file", nf.file);
        formData.append("api_key", signTicket.apiKey);
        formData.append("timestamp", signTicket.timestamp);
        formData.append("signature", signTicket.signature);
        formData.append("public_id", signTicket.publicId);
        formData.append("overwrite", "false");

        const uploadRes = await fetch(
          `https://api.cloudinary.com/v1_1/${signTicket.cloudName || "egcc6hml"}/image/upload`,
          { method: "POST", body: formData }
        );

        if (!uploadRes.ok) {
          const errJson = await uploadRes.json().catch(() => ({}));
          throw new Error(errJson.error?.message || "Upload to Cloudinary failed");
        }

        const uploadData = await uploadRes.json();
        finalReceipts.push({
          url: uploadData.secure_url,
          publicId: uploadData.public_id
        });
      }
    }

    txModalStatus.textContent = "กำลังบันทึกข้อมูล...";

    if (editingTxId) {
      await apiFetch("/api/admin/events-api", {
        method: "PUT",
        body: JSON.stringify({
          action: "update-transaction",
          eventId,
          txId: editingTxId,
          type: selectedType,
          label,
          amount,
          quantity: qty,
          note,
          receipts: finalReceipts,
          deletedPublicIds,
          removeReceipt: finalReceipts.length === 0
        })
      });
    } else {
      await apiFetch("/api/admin/events-api", {
        method: "POST",
        body: JSON.stringify({
          action: "add-transaction",
          eventId,
          type: selectedType,
          label,
          amount,
          quantity: qty,
          note,
          receipts: finalReceipts
        })
      });
    }

    closeModal(txModal);
    await loadEventDetail();
  } catch (err) {
    txModalStatus.textContent = "เกิดข้อผิดพลาด: " + err.message;
  } finally {
    txModalSave.disabled = false;
  }
});

// Cancel / backdrop close
txModalCancel.addEventListener("click", () => closeModal(txModal));
txModal.addEventListener("click", (e) => {
  if (e.target === txModal) closeModal(txModal);
});

// ── Delete transaction ────────────────────────────────────────
async function confirmDeleteTx(txId, label) {
  if (!confirm(`ลบรายการ "${label}" ?\n\nการลบไม่สามารถย้อนกลับได้`)) return;
  try {
    await apiFetch("/api/admin/events-api", {
      method: "DELETE",
      body: JSON.stringify({ action: "delete-transaction", eventId, txId })
    });
    await loadEventDetail();
  } catch (err) {
    alert("ลบไม่สำเร็จ: " + err.message);
  }
}

// ── Lightbox Viewer with Rotate & Zoom & Navigation ───────────
function openReceiptLightbox(images, startIndex = 0) {
  if (!images || images.length === 0) return;
  lbImages = Array.isArray(images) ? images : [{ url: images, title: "ใบเสร็จ", subtitle: "" }];
  lbCurrentIndex = Math.max(0, Math.min(startIndex, lbImages.length - 1));
  lbRotation = 0;
  lbZoom = 1;

  showLightboxImage(lbCurrentIndex);
  openModal(receiptViewerModal);
}

function updateLightboxTransform() {
  receiptViewerImg.style.transform = `scale(${lbZoom}) rotate(${lbRotation}deg)`;
}

function showLightboxImage(index) {
  if (index < 0 || index >= lbImages.length) return;
  lbCurrentIndex = index;
  lbRotation = 0;
  lbZoom = 1;
  updateLightboxTransform();

  const imgObj = lbImages[index];
  receiptViewerImg.src = imgObj.url;
  receiptViewerTitle.textContent = "🧾 " + (imgObj.title || "ใบเสร็จ");
  receiptViewerSub.textContent   = imgObj.subtitle || "";
  receiptViewerOpenTab.href      = imgObj.url;
  receiptImgCounter.textContent  = `${index + 1} / ${lbImages.length}`;

  // Multi-image controls
  if (lbImages.length > 1) {
    lbNavPrev.style.display = "flex";
    lbNavNext.style.display = "flex";
    lightboxStripContainer.style.display = "block";
    renderLightboxStrip();
  } else {
    lbNavPrev.style.display = "none";
    lbNavNext.style.display = "none";
    lightboxStripContainer.style.display = "none";
  }
}

function renderLightboxStrip() {
  lightboxStripThumbs.innerHTML = "";
  lbImages.forEach((imgObj, idx) => {
    const thumb = document.createElement("div");
    thumb.className = `lb-strip-thumb ${idx === lbCurrentIndex ? "active" : ""}`;
    thumb.innerHTML = `<img src="${escapeHtml(imgObj.url)}" alt="thumb">`;
    thumb.addEventListener("click", () => showLightboxImage(idx));
    lightboxStripThumbs.appendChild(thumb);
  });
}

// Rotate & Zoom Controls
lbRotateLeft.addEventListener("click", () => {
  lbRotation = (lbRotation - 90) % 360;
  updateLightboxTransform();
});

lbRotateRight.addEventListener("click", () => {
  lbRotation = (lbRotation + 90) % 360;
  updateLightboxTransform();
});

lbZoomIn.addEventListener("click", () => {
  lbZoom = Math.min(3.0, Number((lbZoom + 0.25).toFixed(2)));
  updateLightboxTransform();
});

lbZoomOut.addEventListener("click", () => {
  lbZoom = Math.max(0.5, Number((lbZoom - 0.25).toFixed(2)));
  updateLightboxTransform();
});

lbZoomReset.addEventListener("click", () => {
  lbZoom = 1;
  lbRotation = 0;
  updateLightboxTransform();
});

lbNavPrev.addEventListener("click", () => {
  if (lbImages.length <= 1) return;
  const nextIdx = (lbCurrentIndex - 1 + lbImages.length) % lbImages.length;
  showLightboxImage(nextIdx);
});

lbNavNext.addEventListener("click", () => {
  if (lbImages.length <= 1) return;
  const nextIdx = (lbCurrentIndex + 1) % lbImages.length;
  showLightboxImage(nextIdx);
});

receiptViewerClose.addEventListener("click", () => closeModal(receiptViewerModal));
receiptViewerCloseBtn.addEventListener("click", () => closeModal(receiptViewerModal));
receiptViewerModal.addEventListener("click", (e) => {
  if (e.target === receiptViewerModal) closeModal(receiptViewerModal);
});

// ── Modal helpers ─────────────────────────────────────────────
function openModal(overlay) {
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal(overlay) {
  overlay.classList.remove("open");
  document.body.style.overflow = "";
}

document.addEventListener("keydown", (e) => {
  if (receiptViewerModal && receiptViewerModal.classList.contains("open")) {
    if (e.key === "Escape") {
      closeModal(receiptViewerModal);
    } else if (e.key === "ArrowLeft") {
      if (lbImages.length > 1) {
        showLightboxImage((lbCurrentIndex - 1 + lbImages.length) % lbImages.length);
      }
    } else if (e.key === "ArrowRight") {
      if (lbImages.length > 1) {
        showLightboxImage((lbCurrentIndex + 1) % lbImages.length);
      }
    } else if (e.key.toLowerCase() === "r") {
      lbRotation = (lbRotation + 90) % 360;
      updateLightboxTransform();
    } else if (e.key === "+" || e.key === "=") {
      lbZoom = Math.min(3.0, Number((lbZoom + 0.25).toFixed(2)));
      updateLightboxTransform();
    } else if (e.key === "-" || e.key === "_") {
      lbZoom = Math.max(0.5, Number((lbZoom - 0.25).toFixed(2)));
      updateLightboxTransform();
    }
  } else if (e.key === "Escape" && txModal.classList.contains("open")) {
    closeModal(txModal);
  }
});

// Touch swipe gestures for mobile Lightbox
let lbTouchStartX = 0;
let lbTouchStartY = 0;
const lbCanvas = document.querySelector(".receipt-viewer-canvas");
if (lbCanvas) {
  lbCanvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      lbTouchStartX = e.touches[0].clientX;
      lbTouchStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  lbCanvas.addEventListener("touchend", (e) => {
    if (e.changedTouches.length === 1 && lbImages.length > 1) {
      const diffX = e.changedTouches[0].clientX - lbTouchStartX;
      const diffY = e.changedTouches[0].clientY - lbTouchStartY;
      if (Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY) * 1.4) {
        if (diffX < 0) {
          showLightboxImage((lbCurrentIndex + 1) % lbImages.length);
        } else {
          showLightboxImage((lbCurrentIndex - 1 + lbImages.length) % lbImages.length);
        }
      }
    }
  }, { passive: true });
}

