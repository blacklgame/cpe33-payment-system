/* ------------------------------------------------------------
   Admin dashboard: lists every user 1-91, shows paid/unpaid FOR
   A SELECTED MONTH, links to that month's uploaded slip, and lets
   the admin approve/reject/delete it (which also resets that
   month back to unpaid). Billing months themselves (year, month,
   amount) are managed on the separate "รายเดือน" page (months.js)
   -- this page is scoped to reviewing/approving slips against
   whichever month is picked in the dropdown at the top.

   This client-side whitelist decides whether the page renders at
   all -- it is NOT the real security boundary. The approve/reject
   /delete actions are re-checked independently on the server
   (api/admin/approve-slip.js, api/admin/delete-slip.js), which is
   the only place that actually matters for security, since
   client-side checks can always be bypassed in devtools.

   The admin email list itself lives in Firestore (see
   api/_lib/admins.js) -- every page/function calls the server to
   check it, never reads it directly from the client.
------------------------------------------------------------ */
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { auth } from "./firebase-admin.js";
import { touchActivity, checkIsInactive, clearActivity } from "../auth-session.js";

const welcomeMsg = document.getElementById("welcomeMsg");
const loadingText = document.getElementById("loadingText");
const rowsContainer = document.getElementById("rowsContainer");
const logoutLink = document.getElementById("logoutLink");
const toolbar = document.getElementById("toolbar");
const pagination = document.getElementById("pagination");
const searchInput = document.getElementById("searchInput");
const searchClear = document.getElementById("searchClear");
const searchResultsInfo = document.getElementById("searchResultsInfo");
const filterAllBtn = document.getElementById("filterAllBtn");
const pendingFilterToggle = document.getElementById("pendingFilterToggle");
const paidFilterToggle = document.getElementById("paidFilterToggle");
const partialFilterToggle = document.getElementById("partialFilterToggle");
const unpaidFilterToggle = document.getElementById("unpaidFilterToggle");
const monthPickerRow = document.getElementById("monthPickerRow");
const monthPicker = document.getElementById("monthPicker");
const monthPickerTotal = document.getElementById("monthPickerTotal");

const PAGE_SIZE = 10;

let rawUsers = [];
let rawPayments = [];
let rawMonths = [];
let rawMonthlyPayments = {};

let allUsers = [];
let currentPage = 1;
let currentSearch = "";
let currentStatusFilter = "all"; // "all" | "pending" | "paid" | "unpaid"
let currentMonthId = null;

let currentAdminUser = null;
let everConfirmedAdmin = false;

const ADMIN_SEEN_KEY = "cpe33_admin_seen";

function markAdminSeen() {
  try {
    localStorage.setItem(ADMIN_SEEN_KEY, "1");
  } catch {
    // Storage unavailable
  }
}

function clearAdminSeen() {
  try {
    localStorage.removeItem(ADMIN_SEEN_KEY);
  } catch {
    // no-op
  }
}

function wasAdminSeenBefore() {
  try {
    if (localStorage.getItem(ADMIN_SEEN_KEY) === "1") {
      return true;
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("firebase:authUser:")) {
        const val = localStorage.getItem(key);
        if (val && val.length > 2) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

const mainContent = document.getElementById("mainContent");

async function authorizedFetch(url, body) {
  if (!currentAdminUser && auth.currentUser) {
    currentAdminUser = auth.currentUser;
  }
  if (!currentAdminUser) {
    goToLogin();
    throw new Error("Not signed in");
  }

  if (checkIsInactive()) {
    goToLogin();
    throw new Error("Session expired due to inactivity");
  }

  touchActivity();

  let idToken = await currentAdminUser.getIdToken();
  let res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify(body)
  });

  if (res.status === 401 || res.status === 403) {
    idToken = await currentAdminUser.getIdToken(true);
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify(body)
    });
  }

  return res;
}

function goToLogin() {
  stopAutoRefresh();
  clearAdminSeen();
  clearActivity();
  window.location.href = "./login.html";
}

async function handleAuthState(user) {
  if (typeof auth.authStateReady === "function") {
    await auth.authStateReady();
  }

  if (checkIsInactive()) {
    goToLogin();
    return;
  }

  if (user && user.email) {
    currentAdminUser = user;
    markAdminSeen();
    touchActivity();

    welcomeMsg.textContent = `Welcome ${user.email}`;
    mainContent.style.display = "flex";
    if (!everConfirmedAdmin) {
      loadDashboard();
    }
    return;
  }

  goToLogin();
}

onAuthStateChanged(auth, handleAuthState);

logoutLink.addEventListener("click", async (e) => {
  e.preventDefault();
  stopAutoRefresh();
  clearAdminSeen();
  clearActivity();
  await signOut(auth);
  window.location.href = "./login.html";
});

// Turns the raw {users, payments, monthlyPayments} response, scoped
// to whichever monthId is currently selected, into the flat, sorted
// array the rest of the file renders from. Pulled out on its own so
// both the initial load, the silent background refresh, and simply
// switching the month dropdown all build rows exactly the same way
// -- one place to keep in sync.
function mapUsersAndPayments(users, payments, monthlyPayments, monthId) {
  const statusByNuid = {};
  payments.forEach((p) => {
    statusByNuid[p.id] = p;
  });

  const userDocs = users.slice().sort((a, b) => a.id.localeCompare(b.id));

  return userDocs.map((userData, index) => {
    const nuid = userData.id;
    const studentMonthlyMap = monthlyPayments[nuid] || {};

    let paid = false;
    let pendingReview = false;
    let slipUrl = null;
    let slipPublicId = null;
    let amount = null;
    let targetAmount = null;
    let paidAmount = null;
    let remainingBalance = null;
    let amountPaid = null;
    let paymentMode = null;

    const monthDocs = Object.values(studentMonthlyMap);
    const pendingDoc = monthDocs.find((m) => m.reviewStatus === "pending");

    if (monthId === "ALL") {
      const sumTarget = rawMonths.reduce((sum, m) => {
        const mSnap = studentMonthlyMap[m.id] || {};
        return sum + (mSnap.targetAmount || mSnap.amount || m.amount || 0);
      }, 0);

      const sumPaid = rawMonths.reduce((sum, m) => {
        const mSnap = studentMonthlyMap[m.id] || {};
        const t = mSnap.targetAmount || mSnap.amount || m.amount || 0;
        return sum + (mSnap.paidAmount || (mSnap.paid ? t : 0));
      }, 0);

      const sumRemaining = Math.max(0, sumTarget - sumPaid);

      paid = sumPaid >= sumTarget && sumTarget > 0;
      pendingReview = !!pendingDoc;
      slipUrl = pendingDoc ? pendingDoc.slipUrl : (monthDocs.find((m) => m.slipUrl)?.slipUrl || null);
      slipPublicId = pendingDoc ? pendingDoc.slipPublicId : (monthDocs.find((m) => m.slipPublicId)?.slipPublicId || null);
      amount = sumTarget;
      targetAmount = sumTarget;
      paidAmount = sumPaid;
      remainingBalance = sumRemaining;
      amountPaid = pendingDoc ? (pendingDoc.amountPaid || sumTarget) : null;
      paymentMode = pendingDoc ? pendingDoc.paymentMode : (monthDocs.find((m) => m.paymentMode)?.paymentMode || "all");

    } else {
      const monthly = studentMonthlyMap[monthId] || null;
      const mDef = rawMonths.find((m) => m.id === monthId) || {};
      const mTarget = monthly?.targetAmount || monthly?.amount || mDef.amount || 0;
      const mPaid = monthly?.paidAmount || (monthly?.paid ? mTarget : 0);

      paid = !!(monthly && (monthly.paid || mPaid >= mTarget));
      pendingReview = !!(monthly && monthly.reviewStatus === "pending");

      // Strictly scope slip to THIS month when monthId is a specific month
      slipUrl = monthly?.slipUrl || null;
      slipPublicId = monthly?.slipPublicId || null;

      amount = mTarget;
      targetAmount = mTarget;
      paidAmount = mPaid;
      remainingBalance = Math.max(0, mTarget - mPaid);
      amountPaid = monthly?.amountPaid || null;
      paymentMode = monthly?.paymentMode || null;
    }

    const override = statusByNuid[nuid] && statusByNuid[nuid].studentStatus;
    if (override === "unpaid") {
      paid = false;
      paidAmount = 0;
      remainingBalance = targetAmount;
    } else if (override === "termination") {
      paid = false;
    }

    let displayStatus = "unpaid";
    if (override === "termination") {
      displayStatus = "termination";
    } else if (pendingReview) {
      displayStatus = "pending";
    } else if (paid) {
      displayStatus = "paid";
    } else if (paidAmount > 0) {
      displayStatus = "partial";
    } else {
      displayStatus = "unpaid";
    }

    const studentStatus = override || (paid ? "normal" : "unpaid");

    return {
      index: index + 1,
      nuid,
      name: userData.name || "-",
      email: userData.email || "-",
      paid,
      pendingReview,
      studentStatus,
      displayStatus,
      slipUrl,
      slipPublicId,
      amount,
      targetAmount,
      paidAmount,
      remainingBalance,
      amountPaid,
      paymentMode
    };
  });
}

function applyCurrentMonth() {
  allUsers = mapUsersAndPayments(rawUsers, rawPayments, rawMonthlyPayments, currentMonthId);
  updateMonthTotal();

  const pageCount = Math.max(1, Math.ceil(allUsers.length / PAGE_SIZE));
  if (currentPage > pageCount) currentPage = pageCount;
  renderPagination();
  renderCurrentView();
}

function updateMonthTotal() {
  if (!currentMonthId) {
    monthPickerTotal.textContent = "";
    return;
  }
  if (currentMonthId === "ALL") {
    const totalCollected = allUsers.reduce((sum, u) => sum + (u.paidAmount || 0), 0);
    const paidUsers = allUsers.filter((u) => u.paid);
    monthPickerTotal.textContent = `รวมเก็บได้ทั้งหมด ${totalCollected.toLocaleString("th-TH")} บาท (ชำระครบ ${paidUsers.length}/${allUsers.length} คน)`;
  } else {
    const paidUsers = allUsers.filter((u) => u.paid);
    const total = allUsers.reduce((sum, u) => sum + (u.paidAmount || 0), 0);
    monthPickerTotal.textContent = `เก็บได้ ${total.toLocaleString("th-TH")} บาท (${paidUsers.length}/${allUsers.length} คน)`;
  }
}

function renderMonthPicker() {
  monthPicker.innerHTML = "";

  if (rawMonths.length === 0) {
    monthPickerRow.style.display = "none";
    currentMonthId = null;
    return;
  }

  monthPickerRow.style.display = "flex";

  const allOpt = document.createElement("option");
  allOpt.value = "ALL";
  allOpt.textContent = "จ่ายทุกเดือน (รวมทุกเดือน)";
  monthPicker.appendChild(allOpt);

  rawMonths.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.label || m.id} (${Number(m.amount || 0).toLocaleString("th-TH")} บาท)`;
    monthPicker.appendChild(opt);
  });

  if (!currentMonthId || (currentMonthId !== "ALL" && !rawMonths.some((m) => m.id === currentMonthId))) {
    currentMonthId = rawMonths[0] ? rawMonths[0].id : "ALL";
  }
  monthPicker.value = currentMonthId;
}

monthPicker.addEventListener("change", () => {
  currentMonthId = monthPicker.value;
  currentPage = 1;
  applyCurrentMonth();
});

async function loadDashboard() {
  loadingText.textContent = "กำลังโหลดรายชื่อ...";
  toolbar.style.display = "none";
  monthPickerRow.style.display = "none";
  rowsContainer.innerHTML = "";

  try {
    const res = await authorizedFetch("/api/admin/list-data", {});

    if (res.status === 401 || res.status === 403) {
      let rejectedEmail = "";
      try {
        const body = await res.json();
        if (body && body.email) rejectedEmail = body.email;
      } catch (_) { /* ignore parse errors */ }
      stopAutoRefresh();
      clearAdminSeen();
      const params = new URLSearchParams({ error: "forbidden" });
      if (rejectedEmail) params.set("email", rejectedEmail);
      window.location.href = "./login.html?" + params.toString();
      return;
    }

    if (!res.ok) {
      throw new Error("Failed to load dashboard data");
    }

    // Now that the data loaded successfully, we confirm they are an admin
    everConfirmedAdmin = true;
    markAdminSeen();
    mainContent.style.display = "flex";

    const { users, payments, months, monthlyPayments } = await res.json();

    if (users.length === 0) {
      loadingText.textContent = "ไม่พบรายชื่อผู้ใช้ (ยังไม่ได้ seed ข้อมูล users)";
      return;
    }

    if (!months || months.length === 0) {
      loadingText.textContent = "ยังไม่มีเดือนที่เปิดให้ชำระเงิน กรุณาไปที่หน้า \"รายเดือน\" เพื่อสร้างเดือนแรกก่อน";
      return;
    }

    loadingText.textContent = "";
    rawUsers = users;
    rawPayments = payments;
    rawMonths = months;
    rawMonthlyPayments = monthlyPayments || {};

    renderMonthPicker();

    toolbar.style.display = "flex";
    applyCurrentMonth();

    // Data's in and rendered -- start (or keep) the background poll
    // that keeps it fresh from here on, so admins never need to hit
    // refresh again (see startAutoRefresh below).
    startAutoRefresh();
  } catch (err) {
    console.error("Failed to load dashboard:", err);
    loadingText.textContent = "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
  }
}

/* ------------------------------------------------------------
   Background auto-refresh: polls list-data every few seconds and
   quietly re-renders whatever view is currently on screen (same
   page number / search / pending filter / selected month), so a
   newly-submitted slip shows up in "รอตรวจสอบ" without the admin
   ever needing to reload the page. Reloading is what used to cause
   the whole re-login dance, so removing the need for it fixes both
   problems at once.

   Deliberately silent: a failed poll (flaky network, brief 401
   while a token refreshes, etc.) just gets skipped and retried on
   the next tick -- it must never redirect to login or show an
   error, since a background tick failing is not the same thing as
   the admin actually being signed out.

   Paused while an admin action (status change / approve / delete)
   is in flight, so a poll can't land mid-action and re-render the
   row out from under a click.
------------------------------------------------------------ */
const AUTO_REFRESH_MS = 12000;
let autoRefreshTimer = null;
let actionInFlight = false;

function startAutoRefresh() {
  if (autoRefreshTimer) return; // already running
  autoRefreshTimer = setInterval(refreshDashboardSilently, AUTO_REFRESH_MS);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

async function refreshDashboardSilently() {
  if (!everConfirmedAdmin || !currentAdminUser || actionInFlight) return;

  try {
    const res = await authorizedFetch("/api/admin/list-data", {});

    // Don't bounce to login from a background tick -- a transient
    // token/network blip here doesn't mean the admin actually got
    // signed out. Just skip this cycle and try again next tick.
    if (!res.ok) return;

    const { users, payments, months, monthlyPayments } = await res.json();
    if (users.length === 0 || !months || months.length === 0) return;

    rawUsers = users;
    rawPayments = payments;
    rawMonths = months;
    rawMonthlyPayments = monthlyPayments || {};

    // Only rebuild the month <select> if the set of months actually
    // changed, so the admin's open dropdown doesn't flicker.
    const currentOptionIds = Array.from(monthPicker.options).map((o) => o.value).sort().join(",");
    const freshIds = months.map((m) => m.id).sort().join(",");
    if (currentOptionIds !== freshIds) {
      renderMonthPicker();
    }

    applyCurrentMonth();
  } catch (err) {
    // Silent by design -- see comment above.
    console.warn("Background refresh skipped:", err);
  }
}

/* ------------------------------------------------------------
   Pagination + search
   Users are chunked into pages of PAGE_SIZE. Each page button is
   labelled with the last 3 digits of its first and last Nu ID
   (e.g. "013-105"), computed from whatever's actually loaded --
   so it never drifts from reality even if the roster changes.
   Typing in the search box switches to showing every match across
   the whole roster instead of one page at a time.
------------------------------------------------------------ */
function renderPagination() {
  pagination.innerHTML = "";
  const pageCount = Math.max(1, Math.ceil(allUsers.length / PAGE_SIZE));

  for (let p = 1; p <= pageCount; p++) {
    const start = (p - 1) * PAGE_SIZE;
    const pageUsers = allUsers.slice(start, start + PAGE_SIZE);
    const firstLast3 = pageUsers[0].nuid.slice(-3);
    const lastLast3 = pageUsers[pageUsers.length - 1].nuid.slice(-3);
    const rangeLabel = firstLast3 === lastLast3 ? firstLast3 : `${firstLast3}-${lastLast3}`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "page-btn";
    if (p === currentPage) btn.classList.add("active");
    btn.innerHTML = `<span class="page-num">หน้า ${p}</span><span class="page-range">(${rangeLabel})</span>`;
    btn.addEventListener("click", () => {
      currentPage = p;
      searchInput.value = "";
      currentSearch = "";
      searchClear.classList.remove("show");
      currentStatusFilter = "all";
      renderCurrentView();
    });
    pagination.appendChild(btn);
  }
}

function renderCurrentView() {
  updateFilterBadges();
  updateMonthTotal();
  if (currentSearch || currentStatusFilter !== "all") {
    renderFilteredResults();
  } else {
    renderPageRows();
  }
}

function updateFilterBadges() {
  const pendingCount = allUsers.filter((u) => u.displayStatus === "pending").length;
  const paidCount = allUsers.filter((u) => u.displayStatus === "paid").length;
  const partialCount = allUsers.filter((u) => u.displayStatus === "partial").length;
  const unpaidCount = allUsers.filter((u) => u.displayStatus === "unpaid").length;

  if (filterAllBtn) {
    filterAllBtn.classList.toggle("active", currentStatusFilter === "all");
    filterAllBtn.textContent = `ทั้งหมด (${allUsers.length})`;
  }
  if (pendingFilterToggle) {
    pendingFilterToggle.textContent = `รอตรวจสอบ${pendingCount > 0 ? ` (${pendingCount})` : ""}`;
    pendingFilterToggle.classList.toggle("active", currentStatusFilter === "pending");
  }
  if (paidFilterToggle) {
    paidFilterToggle.textContent = `จ่ายแล้ว${paidCount > 0 ? ` (${paidCount})` : ""}`;
    paidFilterToggle.classList.toggle("active", currentStatusFilter === "paid");
  }
  if (partialFilterToggle) {
    partialFilterToggle.textContent = `ผ่อนจ่าย${partialCount > 0 ? ` (${partialCount})` : ""}`;
    partialFilterToggle.classList.toggle("active", currentStatusFilter === "partial");
  }
  if (unpaidFilterToggle) {
    unpaidFilterToggle.textContent = `ยังไม่จ่าย${unpaidCount > 0 ? ` (${unpaidCount})` : ""}`;
    unpaidFilterToggle.classList.toggle("active", currentStatusFilter === "unpaid");
  }
}

function renderPageRows() {
  pagination.classList.remove("hidden");
  searchResultsInfo.style.display = "none";
  Array.from(pagination.children).forEach((btn, i) => {
    btn.classList.toggle("active", i + 1 === currentPage);
  });

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageUsers = allUsers.slice(start, start + PAGE_SIZE);

  rowsContainer.innerHTML = "";
  pageUsers.forEach((u) => rowsContainer.appendChild(buildRow(u)));
}

function renderFilteredResults() {
  pagination.classList.add("hidden");

  const term = currentSearch.trim().toLowerCase();
  const matches = allUsers.filter((u) => {
    const matchesTerm = !term || (
      u.nuid.toLowerCase().includes(term) ||
      u.name.toLowerCase().includes(term) ||
      u.email.toLowerCase().includes(term)
    );
    let matchesStatus = true;
    if (currentStatusFilter === "pending") {
      matchesStatus = u.displayStatus === "pending";
    } else if (currentStatusFilter === "paid") {
      matchesStatus = u.displayStatus === "paid";
    } else if (currentStatusFilter === "partial") {
      matchesStatus = u.displayStatus === "partial";
    } else if (currentStatusFilter === "unpaid") {
      matchesStatus = u.displayStatus === "unpaid";
    }
    return matchesTerm && matchesStatus;
  });

  searchResultsInfo.style.display = "block";
  searchResultsInfo.textContent = matches.length
    ? `พบ ${matches.length} รายการ`
    : "ไม่พบรายการที่ตรงกับเงื่อนไข";

  rowsContainer.innerHTML = "";
  matches.forEach((u) => rowsContainer.appendChild(buildRow(u)));
}

if (filterAllBtn) {
  filterAllBtn.addEventListener("click", () => {
    currentStatusFilter = "all";
    renderCurrentView();
  });
}

if (pendingFilterToggle) {
  pendingFilterToggle.addEventListener("click", () => {
    currentStatusFilter = currentStatusFilter === "pending" ? "all" : "pending";
    renderCurrentView();
  });
}

if (paidFilterToggle) {
  paidFilterToggle.addEventListener("click", () => {
    currentStatusFilter = currentStatusFilter === "paid" ? "all" : "paid";
    renderCurrentView();
  });
}

if (partialFilterToggle) {
  partialFilterToggle.addEventListener("click", () => {
    currentStatusFilter = currentStatusFilter === "partial" ? "all" : "partial";
    renderCurrentView();
  });
}

if (unpaidFilterToggle) {
  unpaidFilterToggle.addEventListener("click", () => {
    currentStatusFilter = currentStatusFilter === "unpaid" ? "all" : "unpaid";
    renderCurrentView();
  });
}

searchInput.addEventListener("input", () => {
  currentSearch = searchInput.value;
  searchClear.classList.toggle("show", currentSearch.length > 0);
  renderCurrentView();
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  currentSearch = "";
  searchClear.classList.remove("show");
  renderCurrentView();
  searchInput.focus();
});

const STATUS_META = {
  paid: { label: "จ่ายแล้ว", pillClass: "status-normal", cardClass: "card-normal" },
  normal: { label: "ปกติ / จ่ายแล้ว", pillClass: "status-normal", cardClass: "card-normal" },
  pending: { label: "รอตรวจสอบ", pillClass: "status-pending", cardClass: "card-pending" },
  partial: { label: "ผ่อนจ่าย", pillClass: "status-partial", cardClass: "card-partial" },
  unpaid: { label: "ยังไม่จ่าย", pillClass: "status-unpaid", cardClass: "card-unpaid" },
  termination: { label: "พ้นสภาพ", pillClass: "status-termination", cardClass: "card-termination" }
};

function buildRow({ index, nuid, name, email, paid, pendingReview, studentStatus, displayStatus, slipUrl, slipPublicId, amount, targetAmount, paidAmount, remainingBalance, amountPaid, paymentMode }) {
  const row = document.createElement("div");
  row.className = "stat-row";
  row.dataset.nuid = nuid;

  const rowIndex = document.createElement("div");
  rowIndex.className = "row-index";
  rowIndex.textContent = index;
  row.appendChild(rowIndex);

  const cardStatus = displayStatus || "unpaid";
  const meta = STATUS_META[cardStatus] || STATUS_META.unpaid;

  const card = document.createElement("div");
  card.className = "user-card";
  applyCardStatusClass(card, cardStatus);
  if (pendingReview) {
    card.classList.add("pending-review");
  }

  // Status control select pill: shows current displayStatus (pending, partial, paid, unpaid, termination)
  // and allows changing student status override (normal, termination, unpaid)
  const statusSelect = document.createElement("select");
  statusSelect.className = `status-pill ${meta.pillClass}`;
  statusSelect.dataset.previousValue = cardStatus;

  const selectOptions = [
    { value: "normal", label: "ปกติ / จ่ายแล้ว" },
    { value: "termination", label: "พ้นสภาพ" },
    { value: "unpaid", label: "ยังไม่จ่าย (รีเซ็ต)" }
  ];

  if (cardStatus === "pending") {
    selectOptions.unshift({ value: "pending", label: "รอตรวจสอบ" });
  } else if (cardStatus === "partial") {
    selectOptions.unshift({ value: "partial", label: "ผ่อนจ่าย" });
  }

  selectOptions.forEach((optData) => {
    const opt = document.createElement("option");
    opt.value = optData.value;
    opt.textContent = optData.label;
    if (optData.value === cardStatus || (cardStatus === "paid" && optData.value === "normal")) {
      opt.selected = true;
    }
    statusSelect.appendChild(opt);
  });

  statusSelect.addEventListener("change", () => {
    const chosen = statusSelect.value;
    if (chosen === "normal" || chosen === "termination" || chosen === "unpaid") {
      handleStatusChange(nuid, chosen, statusSelect, card);
    }
  });
  card.appendChild(statusSelect);

  const avatar = document.createElement("div");
  avatar.className = "avatar-placeholder";
  // Show first initial so it's not just an empty grey circle
  avatar.textContent = name && name.trim() ? name.trim()[0].toUpperCase() : "?";
  card.appendChild(avatar);

  const nameEl = document.createElement("div");
  nameEl.className = "user-name";
  nameEl.textContent = `${nuid} - ${name}`;
  card.appendChild(nameEl);

  const emailEl = document.createElement("div");
  emailEl.className = "user-email";
  emailEl.textContent = email;
  card.appendChild(emailEl);

  if (pendingReview && (amountPaid != null || amount != null)) {
    const pendingInfo = document.createElement("div");
    pendingInfo.className = "user-amount";
    pendingInfo.style.color = "#fbbf24";
    const modeLabel = paymentMode === "installment" ? "ผ่อนจ่าย" : (paymentMode === "all" ? "จ่ายเหมาทุกเดือน" : "จ่ายเต็ม");
    const pAmt = amountPaid != null ? amountPaid : (amount || 0);
    pendingInfo.textContent = `รออนุมัติสลิป ${Number(pAmt).toLocaleString("th-TH")} บาท (${modeLabel})`;
    card.appendChild(pendingInfo);
  } else if (paidAmount != null && targetAmount != null && paidAmount > 0) {
    const amountEl = document.createElement("div");
    amountEl.className = "user-amount";
    if (paid) {
      amountEl.textContent = `จ่ายแล้ว ${Number(paidAmount).toLocaleString("th-TH")}/${Number(targetAmount).toLocaleString("th-TH")} บาท`;
    } else {
      amountEl.textContent = `ผ่อนชำระแล้ว ${Number(paidAmount).toLocaleString("th-TH")}/${Number(targetAmount).toLocaleString("th-TH")} บาท (คงเหลือ ${Number(remainingBalance || 0).toLocaleString("th-TH")} บาท)`;
    }
    card.appendChild(amountEl);
  } else if (paid && amount != null) {
    const amountEl = document.createElement("div");
    amountEl.className = "user-amount";
    amountEl.textContent = `จ่ายแล้ว ${Number(amount).toLocaleString("th-TH")} บาท`;
    card.appendChild(amountEl);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";

  if (slipUrl && slipUrl.startsWith("https://")) {
    const viewLink = document.createElement("a");
    viewLink.href = slipUrl;
    viewLink.target = "_blank";
    viewLink.rel = "noopener noreferrer";
    viewLink.className = "action-btn-view";
    viewLink.textContent = "🖼 ดูสลิป";
    actions.appendChild(viewLink);

    if (pendingReview) {
      const approveLink = document.createElement("a");
      approveLink.href = "#";
      approveLink.className = "action-btn-approve";
      approveLink.textContent = "✅ อนุมัติ";
      approveLink.addEventListener("click", (e) => {
        e.preventDefault();
        handleApprove(nuid, approveLink);
      });
      actions.appendChild(approveLink);

      const rejectLink = document.createElement("a");
      rejectLink.href = "#";
      rejectLink.className = "action-btn-delete";
      rejectLink.textContent = "❌ ปฏิเสธ";
      rejectLink.addEventListener("click", (e) => {
        e.preventDefault();
        handleReject(nuid, slipPublicId, rejectLink);
      });
      actions.appendChild(rejectLink);
    } else {
      const deleteLink = document.createElement("a");
      deleteLink.href = "#";
      deleteLink.className = "action-btn-delete";
      deleteLink.textContent = "🗑 รีเซ็ต";
      deleteLink.addEventListener("click", (e) => {
        e.preventDefault();
        handleDelete(nuid, slipPublicId, deleteLink);
      });
      actions.appendChild(deleteLink);
    }
  } else {
    if (paid || (paidAmount != null && paidAmount > 0)) {
      const resetLink = document.createElement("a");
      resetLink.href = "#";
      resetLink.className = "action-btn-delete";
      resetLink.textContent = "🔄 รีเซ็ตเป็นยังไม่จ่าย";
      resetLink.addEventListener("click", (e) => {
        e.preventDefault();
        handleStatusChange(nuid, "unpaid", statusSelect, card);
      });
      actions.appendChild(resetLink);
    } else {
      const noSlip = document.createElement("span");
      noSlip.className = "action-no-slip";
      noSlip.textContent = "ยังไม่มีสลิป";
      actions.appendChild(noSlip);
    }
  }

  card.appendChild(actions);
  row.appendChild(card);
  return row;
}

function applyCardStatusClass(card, studentStatus) {
  Object.values(STATUS_META).forEach((meta) => card.classList.remove(meta.cardClass));
  card.classList.add(STATUS_META[studentStatus].cardClass);
}

async function handleStatusChange(nuid, newStatus, selectEl, card) {
  const previousValue = selectEl.dataset.previousValue;
  selectEl.disabled = true;
  actionInFlight = true;

  try {
    const res = await authorizedFetch("/api/admin/set-status", { nuid, status: newStatus, confirm: true });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || "Status update failed");
    }

    selectEl.className = `status-pill ${STATUS_META[newStatus].pillClass}`;
    selectEl.dataset.previousValue = newStatus;
    applyCardStatusClass(card, newStatus);

    await loadDashboard();
  } catch (err) {
    console.error("Status update failed:", err);
    alert("เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    selectEl.value = previousValue;
  } finally {
    selectEl.disabled = false;
    actionInFlight = false;
  }
}

async function handleApprove(nuid, triggerEl) {
  const confirmed = window.confirm(
    `ยืนยันอนุมัติสลิปของรหัสนิสิต ${nuid}?\nระบบจะเปลี่ยนสถานะเป็น "จ่ายแล้ว" สำหรับเดือนนี้`
  );
  if (!confirmed) return;

  const originalText = triggerEl.textContent;
  triggerEl.textContent = "กำลังอนุมัติ...";
  actionInFlight = true;

  try {
    const res = await authorizedFetch("/api/admin/approve-slip", { nuid, monthId: currentMonthId });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || "Approve failed");
    }

    // Reload this row's data from Firestore rather than guessing the
    // new state locally, so the UI always reflects what's really saved.
    await loadDashboard();
  } catch (err) {
    console.error("Approve failed:", err);
    alert("อนุมัติไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    triggerEl.textContent = originalText;
  } finally {
    actionInFlight = false;
  }
}

async function handleReject(nuid, slipPublicId, triggerEl) {
  const confirmed = window.confirm(
    `ยืนยันปฏิเสธสลิปของรหัสนิสิต ${nuid}?\nสลิปจะถูกลบและสถานะจะเปลี่ยนเป็น "สลิปถูกปฏิเสธ" สำหรับเดือนนี้\nนิสิตจะสามารถอัปโหลดสลิปใหม่สำหรับเดือนนี้ได้อีกครั้ง`
  );
  if (!confirmed) return;

  const originalText = triggerEl.textContent;
  triggerEl.textContent = "กำลังปฏิเสธ...";
  actionInFlight = true;

  try {
    const res = await authorizedFetch("/api/admin/delete-slip", { nuid, monthId: currentMonthId, slipPublicId, confirm: true });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || "Reject failed");
    }

    // Reload so the row reflects the new rejected state immediately.
    await loadDashboard();
  } catch (err) {
    console.error("Reject failed:", err);
    alert("ปฏิเสธไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    triggerEl.textContent = originalText;
  } finally {
    actionInFlight = false;
  }
}

async function handleDelete(nuid, slipPublicId, triggerEl) {
  const confirmed = window.confirm(
    `ยืนยันลบสลิปของรหัสนิสิต ${nuid}?\nระบบจะเปลี่ยนสถานะกลับเป็น "ยังไม่จ่าย" สำหรับเดือนนี้ด้วย`
  );
  if (!confirmed) return;

  triggerEl.textContent = "กำลังลบ...";
  actionInFlight = true;

  try {
    const res = await authorizedFetch("/api/admin/delete-slip", { nuid, monthId: currentMonthId, slipPublicId, confirm: true });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || "Delete failed");
    }

    // Reload this row's data from Firestore rather than guessing the
    // new state locally, so the UI always reflects what's really saved.
    await loadDashboard();
  } catch (err) {
    console.error("Delete failed:", err);
    alert("ลบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    triggerEl.textContent = "ลบ";
  } finally {
    actionInFlight = false;
  }
}
