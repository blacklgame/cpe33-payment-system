/* ------------------------------------------------------------
   Event Detail page (event-detail.html)
   - Reads ?id= from the URL to know which event to load.
   - Shows 3 donut charts for this event's รายรับ/รายจ่าย/คงเหลือ.
   - Lists all transactions below with edit & delete controls.
   - Add / Edit transaction modal with quantity × price preview.
------------------------------------------------------------ */
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { auth } from "../firebase.js";
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

// ── State ─────────────────────────────────────────────────────
let currentUser   = null;
let transactions  = [];
let selectedType  = "income";
let editingTxId   = null;

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

    card.innerHTML = `
      <div class="tx-type-pill">${isIncome ? "+" : "−"}</div>
      <div class="tx-info">
        <div class="tx-label">${escapeHtml(tx.label)}</div>
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

    txContainer.appendChild(card);
  });
}

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
    if (editingTxId) {
      await apiFetch("/api/admin/events-api", {
        method: "PUT",
        body: JSON.stringify({
          action: "update-transaction",
          eventId, txId: editingTxId,
          type: selectedType, label, amount, quantity: qty, note
        })
      });
    } else {
      await apiFetch("/api/admin/events-api", {
        method: "POST",
        body: JSON.stringify({
          action: "add-transaction",
          eventId,
          type: selectedType, label, amount, quantity: qty, note
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
  if (e.key === "Escape" && txModal.classList.contains("open")) closeModal(txModal);
});
