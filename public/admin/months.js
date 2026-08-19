/* ------------------------------------------------------------
   Admin months page: create/update billing months (year, month,
   amount due) and see how much has been collected so far for
   each one. Reviewing/approving individual student slips happens
   on dashboard.html, scoped to whichever month is picked there --
   this page only manages the month DEFINITIONS and shows totals.

   Same admin-auth pattern as dashboard.js: the client-side check
   below only decides whether this page renders at all. The real
   security check happens again, independently, on the server for
   every write (api/admin/create-month.js, api/admin/delete-month.js).
------------------------------------------------------------ */
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { auth } from "./firebase-admin.js";
import { touchActivity, checkIsInactive, clearActivity } from "../auth-session.js";

const welcomeMsg = document.getElementById("welcomeMsg");
const loadingText = document.getElementById("loadingText");
const logoutLink = document.getElementById("logoutLink");
const mainContent = document.getElementById("mainContent");
const monthForm = document.getElementById("monthForm");
const monthSelect = document.getElementById("monthSelect");
const yearInput = document.getElementById("yearInput");
const amountInput = document.getElementById("amountInput");
const monthSubmitBtn = document.getElementById("monthSubmitBtn");
const monthFormStatus = document.getElementById("monthFormStatus");
const totalsCard = document.getElementById("totalsCard");
const grandTotalCollected = document.getElementById("grandTotalCollected");
const grandTotalPending = document.getElementById("grandTotalPending");
const monthsContainer = document.getElementById("monthsContainer");

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

THAI_MONTHS.forEach((name, i) => {
  const opt = document.createElement("option");
  opt.value = String(i + 1);
  opt.textContent = name;
  monthSelect.appendChild(opt);
});

const now = new Date();
yearInput.value = now.getFullYear();
monthSelect.value = String(now.getMonth() + 1);

let currentAdminUser = null;
let everConfirmedAdmin = false;

const ADMIN_SEEN_KEY = "cpe33_admin_seen";

function markAdminSeen() {
  try { localStorage.setItem(ADMIN_SEEN_KEY, "1"); } catch { /* no-op */ }
}
function clearAdminSeen() {
  try { localStorage.removeItem(ADMIN_SEEN_KEY); } catch { /* no-op */ }
}
function wasAdminSeenBefore() {
  try {
    if (localStorage.getItem(ADMIN_SEEN_KEY) === "1") return true;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("firebase:authUser:")) {
        const val = localStorage.getItem(key);
        if (val && val.length > 2) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function goToLogin() {
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
      loadMonths();
    }
    return;
  }

  goToLogin();
}

onAuthStateChanged(auth, handleAuthState);

logoutLink.addEventListener("click", async (e) => {
  e.preventDefault();
  clearAdminSeen();
  clearActivity();
  await signOut(auth);
  window.location.href = "./login.html";
});

async function authorizedFetch(url, body) {
  if (!currentAdminUser && auth.currentUser) {
    currentAdminUser = auth.currentUser;
  }
  if (!currentAdminUser || !currentAdminUser.email) {
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
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body)
  });

  if (res.status === 401 || res.status === 403) {
    idToken = await currentAdminUser.getIdToken(true);
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body)
    });
  }

  return res;
}


let totalStudentCount = 0;

async function loadMonths() {
  loadingText.textContent = "กำลังโหลดข้อมูล...";
  monthForm.style.display = "none";
  totalsCard.style.display = "none";
  monthsContainer.innerHTML = "";

  try {
    const res = await authorizedFetch("/api/admin/list-data", {});

    if (res.status === 401 || res.status === 403) {
      let rejectedEmail = "";
      try {
        const body = await res.json();
        if (body && body.email) rejectedEmail = body.email;
      } catch (_) { /* ignore */ }
      clearAdminSeen();
      const params = new URLSearchParams({ error: "forbidden" });
      if (rejectedEmail) params.set("email", rejectedEmail);
      window.location.href = "./login.html?" + params.toString();
      return;
    }
    if (!res.ok) throw new Error("Failed to load months data");

    everConfirmedAdmin = true;
    markAdminSeen();
    mainContent.style.display = "flex";

    const { users, months, monthlyPayments } = await res.json();
    totalStudentCount = users.length;

    loadingText.textContent = "";
    monthForm.style.display = "flex";

    renderMonths(months || [], monthlyPayments || {});
  } catch (err) {
    console.error("Failed to load months:", err);
    loadingText.textContent = "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
  }
}

function computeMonthStats(monthId, monthlyPayments) {
  let paidCount = 0;
  let totalCollected = 0;
  let pendingCount = 0;
  let totalPending = 0;

  Object.values(monthlyPayments).forEach((byMonth) => {
    const record = byMonth[monthId];
    if (!record) return;
    if (record.paid) {
      paidCount += 1;
      totalCollected += record.amount || 0;
    } else if (record.reviewStatus === "pending") {
      pendingCount += 1;
      totalPending += record.amount || 0;
    }
  });

  return { paidCount, totalCollected, pendingCount, totalPending };
}

let selectedAdminYearFilter = null;

function renderMonths(months, monthlyPayments) {
  if (months.length === 0) {
    totalsCard.style.display = "none";
    monthsContainer.innerHTML = '<p class="empty-months-note">ยังไม่มีเดือนที่สร้างไว้ กรอกฟอร์มด้านบนเพื่อเพิ่มเดือนแรก</p>';
    const oldTabs = document.getElementById("adminMonthsYearTabs");
    if (oldTabs) oldTabs.remove();
    return;
  }

  let grandCollected = 0;
  let grandPending = 0;

  months.forEach((m) => {
    const stats = computeMonthStats(m.id, monthlyPayments);
    grandCollected += stats.totalCollected;
    grandPending += stats.totalPending;
  });

  grandTotalCollected.textContent = `${grandCollected.toLocaleString("th-TH")} บาท`;
  grandTotalPending.textContent = `${grandPending.toLocaleString("th-TH")} บาท`;
  totalsCard.style.display = "block";

  const years = Array.from(new Set(months.map((m) => String(m.year || m.id.split("-")[0])))).sort().reverse();

  if (!selectedAdminYearFilter || (!years.includes(selectedAdminYearFilter) && selectedAdminYearFilter !== "all")) {
    selectedAdminYearFilter = years[0] || "all";
  }

  let tabsBar = document.getElementById("adminMonthsYearTabs");
  if (!tabsBar) {
    tabsBar = document.createElement("div");
    tabsBar.id = "adminMonthsYearTabs";
    tabsBar.className = "year-tabs-container";
    monthsContainer.parentNode.insertBefore(tabsBar, monthsContainer);
  }
  tabsBar.innerHTML = "";

  if (years.length > 1) {
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = `year-tab-btn ${selectedAdminYearFilter === "all" ? "active" : ""}`;
    allBtn.textContent = "ทั้งหมด";
    allBtn.addEventListener("click", () => {
      selectedAdminYearFilter = "all";
      renderMonths(months, monthlyPayments);
    });
    tabsBar.appendChild(allBtn);
  }

  years.forEach((yr) => {
    const yrBtn = document.createElement("button");
    yrBtn.type = "button";
    yrBtn.className = `year-tab-btn ${selectedAdminYearFilter === yr ? "active" : ""}`;
    yrBtn.textContent = `ปี ${yr}`;
    yrBtn.addEventListener("click", () => {
      selectedAdminYearFilter = yr;
      renderMonths(months, monthlyPayments);
    });
    tabsBar.appendChild(yrBtn);
  });

  const filteredMonths = months.filter((m) => {
    if (selectedAdminYearFilter === "all") return true;
    const mYr = String(m.year || m.id.split("-")[0]);
    return mYr === selectedAdminYearFilter;
  });

  monthsContainer.innerHTML = "";
  filteredMonths.forEach((m) => {
    const stats = computeMonthStats(m.id, monthlyPayments);
    monthsContainer.appendChild(buildMonthCard(m, stats));
  });
}

function buildMonthCard(m, stats) {
  const card = document.createElement("div");
  card.className = "month-card";

  const top = document.createElement("div");
  top.className = "month-card-top";

  const label = document.createElement("div");
  label.className = "month-card-label";
  label.textContent = m.label || m.id;
  top.appendChild(label);

  const amount = document.createElement("div");
  amount.className = "month-card-amount";
  amount.textContent = `${Number(m.amount || 0).toLocaleString("th-TH")} บาท / คน`;
  top.appendChild(amount);

  card.appendChild(top);

  const statsRow = document.createElement("div");
  statsRow.className = "month-card-stats";
  statsRow.innerHTML = `
    <span>เก็บได้ <strong>${stats.totalCollected.toLocaleString("th-TH")}</strong> บาท (<strong>${stats.paidCount}</strong>/${totalStudentCount} คน)</span>
    <span>รอตรวจสอบ <strong>${stats.pendingCount}</strong> คน (${stats.totalPending.toLocaleString("th-TH")} บาท)</span>
  `;
  card.appendChild(statsRow);

  const actions = document.createElement("div");
  actions.className = "month-card-actions";
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "month-delete-btn";
  deleteBtn.textContent = "ลบเดือนนี้";
  deleteBtn.addEventListener("click", () => handleDeleteMonth(m, deleteBtn));
  actions.appendChild(deleteBtn);
  card.appendChild(actions);

  return card;
}

async function handleDeleteMonth(m, triggerEl) {
  const confirmed = window.confirm(
    `ยืนยันลบเดือน "${m.label || m.id}"?\nสลิปที่นิสิตส่งไว้แล้วจะยังอยู่ในระบบ แต่เดือนนี้จะหายไปจากตัวเลือก`
  );
  if (!confirmed) return;

  deleteBtn_setBusy(triggerEl, true);
  try {
    const res = await authorizedFetch("/api/admin/create-month", { action: "delete", monthId: m.id });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || "Delete failed");
    }
    await loadMonths();
  } catch (err) {
    console.error("Delete month failed:", err);
    alert("ลบเดือนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    deleteBtn_setBusy(triggerEl, false);
  }
}

function deleteBtn_setBusy(btn, busy) {
  btn.disabled = busy;
  btn.textContent = busy ? "กำลังลบ..." : "ลบเดือนนี้";
}

monthForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const year = Number(yearInput.value);
  const month = Number(monthSelect.value);
  const amount = Number(amountInput.value);

  monthFormStatus.textContent = "";
  monthFormStatus.className = "status-text";

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    monthFormStatus.textContent = "กรุณากรอกปี ค.ศ. ให้ถูกต้อง";
    monthFormStatus.className = "status-text error";
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    monthFormStatus.textContent = "กรุณากรอกจำนวนเงินให้ถูกต้อง";
    monthFormStatus.className = "status-text error";
    return;
  }

  monthSubmitBtn.disabled = true;
  monthSubmitBtn.textContent = "กำลังบันทึก...";

  try {
    const res = await authorizedFetch("/api/admin/create-month", { year, month, amount });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || "Save failed");
    }

    monthFormStatus.textContent = "บันทึกเดือนสำเร็จ";
    monthFormStatus.className = "status-text success";
    amountInput.value = "";
    await loadMonths();
  } catch (err) {
    console.error("Save month failed:", err);
    monthFormStatus.textContent = "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
    monthFormStatus.className = "status-text error";
  } finally {
    monthSubmitBtn.disabled = false;
    monthSubmitBtn.textContent = "บันทึกเดือนนี้";
  }
});
