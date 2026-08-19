/* ------------------------------------------------------------
   Admin Events page (events.html)
   - Auth-gates: redirects to login if not a valid admin.
   - Loads all events + transaction totals.
   - Renders 3 grand-total donut charts at the top.
   - Shows event cards in a grid below.
   - Create / Edit event via modal.
   - Delete event with confirmation.
   - Clicking an event card navigates to event-detail.html?id=xxx
------------------------------------------------------------ */
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { auth } from "../firebase.js";
import { touchActivity, checkIsInactive, clearActivity } from "../auth-session.js";

// ── DOM refs ─────────────────────────────────────────────────
const welcomeMsg      = document.getElementById("welcomeMsg");
const mainContent     = document.getElementById("mainContent");
const loadingText     = document.getElementById("loadingText");
const donutStrip      = document.getElementById("donutStrip");
const sectionHeader   = document.getElementById("sectionHeader");
const eventsGrid      = document.getElementById("eventsGrid");
const logoutLink      = document.getElementById("logoutLink");
const createEventBtn  = document.getElementById("createEventBtn");

// Donut DOM refs
const grandIncome      = document.getElementById("grandIncome");
const grandExpense     = document.getElementById("grandExpense");
const grandBalance     = document.getElementById("grandBalance");
const grandIncomeCount = document.getElementById("grandIncomeCount");
const grandExpenseCount= document.getElementById("grandExpenseCount");
const grandBalanceCount= document.getElementById("grandBalanceCount");
const donutFgIncome   = document.getElementById("donutFgIncome");
const donutFgExpense  = document.getElementById("donutFgExpense");
const donutFgBalance  = document.getElementById("donutFgBalance");
const donutPctIncome  = document.getElementById("donutPctIncome");
const donutPctExpense = document.getElementById("donutPctExpense");
const donutPctBalance = document.getElementById("donutPctBalance");

// Modal DOM refs
const eventModal      = document.getElementById("eventModal");
const eventModalTitle = document.getElementById("eventModalTitle");
const eventNameInput  = document.getElementById("eventNameInput");
const eventEmojiInput = document.getElementById("eventEmojiInput");
const eventModalSave  = document.getElementById("eventModalSave");
const eventModalCancel= document.getElementById("eventModalCancel");
const eventModalStatus= document.getElementById("eventModalStatus");

// ── State ─────────────────────────────────────────────────────
let currentUser = null;
let idToken     = null;
let eventsData  = [];
let monthlyIncomeTotal = 0;
let monthlyPaidCount = 0;
let editingEventId = null; // null = create mode, string = edit mode

function goToLogin() {
  clearActivity();
  window.location.href = "./login.html";
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

  if (!user || !user.email) {
    goToLogin();
    return;
  }

  currentUser = user;
  touchActivity();
  welcomeMsg.textContent = user.displayName || user.email || "Admin";
  try {
    idToken = await user.getIdToken();
    await loadEvents();
  } catch {
    loadingText.textContent = "เกิดข้อผิดพลาด กรุณาลองใหม่";
  }
});

logoutLink.addEventListener("click", async (e) => {
  e.preventDefault();
  clearActivity();
  await signOut(auth);
  window.location.href = "./login.html";
});

// ── Helpers ───────────────────────────────────────────────────
function fmt(n) {
  return "฿\u00a0" + Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCompact(n) {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000)    return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

async function getToken(forceRefresh = false) {
  if (!currentUser && auth.currentUser) {
    currentUser = auth.currentUser;
  }
  if (!currentUser) return null;
  idToken = await currentUser.getIdToken(forceRefresh);
  return idToken;
}

// ── API calls ─────────────────────────────────────────────────
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


// ── Load & render ─────────────────────────────────────────────
async function loadEvents() {
  try {
    loadingText.style.display = "block";
    loadingText.textContent = "กำลังโหลดข้อมูล...";
    donutStrip.style.display = "none";
    sectionHeader.style.display = "none";

    const data = await apiFetch("/api/admin/events-api?action=list");

    // Redirect to login on auth failure
    if (data.error) {
      window.location.href = "./login.html";
      return;
    }

    eventsData = data.events || [];
    monthlyIncomeTotal = Number(data.monthlyIncomeTotal) || 0;
    monthlyPaidCount = Number(data.monthlyPaidCount) || 0;

    mainContent.style.display = "";
    loadingText.style.display = "none";
    donutStrip.style.display = "";
    sectionHeader.style.display = "";

    updateDonutCharts();
    renderEventCards();
  } catch (err) {
    console.error(err);
    if (err.message && (err.message.includes("401") || err.message.includes("403"))) {
      window.location.href = "./login.html";
    } else {
      loadingText.textContent = "เกิดข้อผิดพลาดในการโหลดข้อมูล: " + err.message;
    }
  }
}

// ── Donut chart logic ─────────────────────────────────────────
const CIRCUMFERENCE = 100; // we use stroke-dasharray out of 100

function setDonut(fgEl, pctEl, pct) {
  const clamped = Math.max(0, Math.min(100, pct));
  // Small gap so a full circle still has a visible end
  const dash = clamped < 1 ? 0 : clamped;
  const gap  = 100 - dash;
  fgEl.setAttribute("stroke-dasharray", `${dash} ${gap}`);
  pctEl.textContent = Math.round(clamped) + "%";
}

function updateDonutCharts() {
  let totalIncome  = monthlyIncomeTotal;
  let totalExpense = 0;

  eventsData.forEach((ev) => {
    totalIncome  += ev.totalIncome  || 0;
    totalExpense += ev.totalExpense || 0;
  });

  const balance    = totalIncome - totalExpense;
  const grand      = Math.max(totalIncome, totalExpense, 1); // avoid /0

  const incomePct  = (totalIncome  / grand) * 100;
  const expensePct = (totalExpense / grand) * 100;
  const balancePct = (balance < 0 ? 0 : balance / grand) * 100;

  // Animate after a tick so transition fires
  requestAnimationFrame(() => {
    setDonut(donutFgIncome,  donutPctIncome,  incomePct);
    setDonut(donutFgExpense, donutPctExpense, expensePct);
    setDonut(donutFgBalance, donutPctBalance, balancePct);
  });

  grandIncome.textContent       = fmt(totalIncome);
  grandExpense.textContent      = fmt(totalExpense);
  grandBalance.textContent      = fmt(balance);
  grandBalance.style.color      = balance < 0 ? "var(--danger)" : "";

  const incomeTxCount = eventsData.reduce((s, e) => s + (e.transactions_income_count || 0), 0) + monthlyPaidCount;
  grandIncomeCount.textContent  = `${incomeTxCount} รายการ (รวมค่าสาขา)`;
  grandExpenseCount.textContent = `${eventsData.reduce((s, e) => s + (e.transactions_expense_count || 0), 0)} รายการ`;
  grandBalanceCount.textContent = `${eventsData.length} กิจกรรม + ค่าสาขา`;
}

// ── Event card rendering ──────────────────────────────────────
function renderEventCards() {
  eventsGrid.innerHTML = "";

  if (monthlyIncomeTotal > 0 || monthlyPaidCount > 0) {
    const monthlyCard = document.createElement("a");
    monthlyCard.className = "event-card";
    monthlyCard.style.borderColor = "rgba(59, 130, 246, 0.4)";
    monthlyCard.href = "./months.html";
    monthlyCard.innerHTML = `
      <div class="event-card-top">
        <div class="event-emoji-name">
          <span class="event-emoji">💳</span>
          <span class="event-name">ค่าสาขารายเดือน (Monthly Dues)</span>
        </div>
        <span class="pill pill-income" style="font-size:0.75rem;">ระบบค่าสาขา</span>
      </div>
      <div class="event-card-pills">
        <span class="pill pill-income"><span class="pill-dot"></span>รับ ${fmtCompact(monthlyIncomeTotal)} ฿</span>
        <span class="pill pill-expense"><span class="pill-dot"></span>จ่าย 0 ฿</span>
        <span class="pill pill-balance">
          <span class="pill-dot"></span>
          คงเหลือ ${fmtCompact(monthlyIncomeTotal)} ฿
        </span>
      </div>
      <div class="event-card-footer">
        ชำระแล้ว ${monthlyPaidCount} รายการ · จัดการค่าสาขา →
      </div>
    `;
    eventsGrid.appendChild(monthlyCard);
  }

  if (eventsData.length === 0 && monthlyIncomeTotal === 0) {
    eventsGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🗂️</div>
        <p>ยังไม่มีกิจกรรม</p>
        <p style="margin-top:6px;font-size:0.85rem;">กดปุ่ม "สร้างกิจกรรมใหม่" เพื่อเริ่มต้น</p>
      </div>`;
    return;
  }

  eventsData.forEach((ev) => {
    const balance = (ev.totalIncome || 0) - (ev.totalExpense || 0);
    const createdDate = ev.createdAt
      ? new Date(ev.createdAt).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })
      : "";

    const card = document.createElement("a");
    card.className = "event-card";
    card.href = `./event-detail.html?id=${encodeURIComponent(ev.id)}`;
    card.innerHTML = `
      <div class="event-card-top">
        <div class="event-emoji-name">
          <span class="event-emoji">${ev.emoji || "🎉"}</span>
          <span class="event-name">${escapeHtml(ev.name)}</span>
        </div>
        <div class="event-card-actions">
          <button class="icon-btn" data-edit="${ev.id}" title="แก้ไขชื่อ/emoji">✏️</button>
          <button class="icon-btn icon-btn-danger" data-delete="${ev.id}" data-name="${escapeHtml(ev.name)}" title="ลบกิจกรรม">🗑️</button>
        </div>
      </div>
      <div class="event-card-pills">
        <span class="pill pill-income"><span class="pill-dot"></span>รับ ${fmtCompact(ev.totalIncome || 0)} ฿</span>
        <span class="pill pill-expense"><span class="pill-dot"></span>จ่าย ${fmtCompact(ev.totalExpense || 0)} ฿</span>
        <span class="pill pill-balance" style="${balance < 0 ? "background:var(--danger-soft);color:var(--danger);" : ""}">
          <span class="pill-dot" style="${balance < 0 ? "background:var(--danger);" : ""}"></span>
          คงเหลือ ${fmtCompact(balance)} ฿
        </span>
      </div>
      <div class="event-card-footer">
        ${ev.transactionCount} รายการ · สร้างเมื่อ ${createdDate}
      </div>
    `;

    // Intercept edit/delete button clicks so they don't navigate
    card.querySelectorAll(".icon-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.dataset.edit)   openEditModal(btn.dataset.edit);
        if (btn.dataset.delete) confirmDeleteEvent(btn.dataset.delete, btn.dataset.name);
      });
    });

    eventsGrid.appendChild(card);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Create / Edit event modal ─────────────────────────────────
createEventBtn.addEventListener("click", () => openCreateModal());

function openCreateModal() {
  editingEventId       = null;
  eventModalTitle.textContent = "สร้างกิจกรรมใหม่";
  eventNameInput.value  = "";
  eventEmojiInput.value = "";
  eventModalStatus.textContent = "";
  openModal(eventModal);
}

function openEditModal(eventId) {
  const ev = eventsData.find((e) => e.id === eventId);
  if (!ev) return;
  editingEventId        = eventId;
  eventModalTitle.textContent = "แก้ไขกิจกรรม";
  eventNameInput.value   = ev.name  || "";
  eventEmojiInput.value  = ev.emoji || "";
  eventModalStatus.textContent = "";
  openModal(eventModal);
}

eventModalCancel.addEventListener("click", () => closeModal(eventModal));
eventModal.addEventListener("click", (e) => {
  if (e.target === eventModal) closeModal(eventModal);
});

eventModalSave.addEventListener("click", async () => {
  const name  = eventNameInput.value.trim();
  const emoji = eventEmojiInput.value.trim() || "🎉";

  if (!name) {
    eventModalStatus.textContent = "กรุณากรอกชื่อกิจกรรม";
    return;
  }

  eventModalSave.disabled = true;
  eventModalStatus.textContent = "";

  try {
    if (editingEventId) {
      await apiFetch("/api/admin/events-api", {
        method: "PUT",
        body: JSON.stringify({ action: "update", eventId: editingEventId, name, emoji })
      });
    } else {
      await apiFetch("/api/admin/events-api", {
        method: "POST",
        body: JSON.stringify({ action: "create", name, emoji })
      });
    }
    closeModal(eventModal);
    await loadEvents();
  } catch (err) {
    eventModalStatus.textContent = "เกิดข้อผิดพลาด: " + err.message;
  } finally {
    eventModalSave.disabled = false;
  }
});

// ── Delete event ──────────────────────────────────────────────
async function confirmDeleteEvent(eventId, name) {
  if (!confirm(`ลบกิจกรรม "${name}" และรายการทั้งหมดในนั้น?\n\nการลบไม่สามารถย้อนกลับได้`)) return;
  try {
    await apiFetch("/api/admin/events-api", {
      method: "DELETE",
      body: JSON.stringify({ action: "delete", eventId })
    });
    await loadEvents();
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

// Keyboard: Escape closes modals
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (eventModal.classList.contains("open")) closeModal(eventModal);
  }
});
