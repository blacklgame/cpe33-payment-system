/* ------------------------------------------------------------
   Admin dashboard: lists every user 1-91, shows paid/unpaid,
   links to the uploaded slip, and lets the admin delete a slip
   (which also resets that user back to unpaid).

   This client-side whitelist decides whether the page renders at
   all -- it is NOT the real security boundary. The delete/status
   actions are re-checked independently on the server
   (api/admin/delete-slip.js, api/admin/set-status.js), which is the
   only place that actually matters for security, since client-side
   checks can always be bypassed in devtools.

   The admin email list itself lives in ONE place --
   admin-emails.json, next to this file -- and every page/function
   reads from it, so adding or removing an admin only ever means
   editing that one JSON file.
------------------------------------------------------------ */
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { auth } from "../firebase.js";

const welcomeMsg = document.getElementById("welcomeMsg");
const loadingText = document.getElementById("loadingText");
const rowsContainer = document.getElementById("rowsContainer");
const logoutLink = document.getElementById("logoutLink");
const toolbar = document.getElementById("toolbar");
const pagination = document.getElementById("pagination");
const searchInput = document.getElementById("searchInput");
const searchClear = document.getElementById("searchClear");
const searchResultsInfo = document.getElementById("searchResultsInfo");
const pendingFilterToggle = document.getElementById("pendingFilterToggle");

// How many users each page shows. Pagination labels (below) are built
// from whatever's actually loaded, so this is the only number to
// touch if the page size should ever change.
const PAGE_SIZE = 10;

// All loaded users, in the same order as rendered (index 0 = row #1).
// Rebuilt on every loadDashboard() call; renderPage()/renderSearch()
// read from this instead of hitting Firestore again.
let allUsers = [];
let currentPage = 1;
let currentSearch = "";
let showPendingOnly = false;

// Checks whether the currently signed-in user is an approved admin by
// asking the server (which reads admin-emails.json server-side, where
// it is no longer publicly accessible). Uses the Firebase ID token so
// the check can't be spoofed from the browser.
//
// Returns "admin", "not-admin", or "error" -- kept as three distinct
// outcomes on purpose. A real "not-admin" (the server verified the
// token and the email just isn't on the whitelist) should bounce the
// user out. A network hiccup / cold-start timeout / transient 5xx
// should NOT be treated the same way -- see the caller below for why
// collapsing these together was causing admins to get kicked to the
// login page for reasons that had nothing to do with their login.
async function isAdminOnServer(user) {
  try {
    const idToken = await user.getIdToken();
    const res = await fetch("/api/admin/check-admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      }
    });
    if (res.status === 401 || res.status === 403) return "not-admin";
    if (!res.ok) return "error";
    const body = await res.json();
    return body.isAdmin === true ? "admin" : "not-admin";
  } catch {
    return "error";
  }
}

let currentAdminUser = null;
// Set once we've successfully shown the dashboard to a confirmed
// admin in this page load. Used below to tell "never logged in" (bounce
// immediately) apart from "was logged in a second ago, now Firebase
// says null" (worth a brief second look before trusting it).
let everConfirmedAdmin = false;

const mainContent = document.getElementById("mainContent");

function goToLogin() {
  window.location.href = "./login.html";
}

async function handleAuthState(user) {
  if (!user) {
    if (!everConfirmedAdmin) {
      // Normal case: nobody's signed in yet.
      goToLogin();
      return;
    }
    // We had a confirmed admin session moments ago and Firebase Auth
    // just reported null. Real sign-outs (the logout link, a revoked
    // token) are legitimate and should still bounce to login -- but
    // some browsers (notably Safari, due to an intermittent IndexedDB
    // bug in the auth SDK's local session storage) can misreport this
    // for a session that's actually still fine. Give it one grace
    // check instead of trusting the very first null immediately.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    if (auth.currentUser) {
      // Recovered -- the null was spurious. Nothing to do; the next
      // real onAuthStateChanged/getIdToken call will keep working.
      return;
    }
    goToLogin();
    return;
  }

  const status = await isAdminOnServer(user);
  if (status === "not-admin") {
    goToLogin();
    return;
  }
  if (status === "error") {
    // Couldn't confirm either way (network blip, cold start, etc).
    // Retry once before giving up, instead of immediately bouncing a
    // real admin out over a transient failure.
    const retryStatus = await isAdminOnServer(user);
    if (retryStatus !== "admin") {
      loadingText.textContent = "ตรวจสอบสิทธิ์ไม่สำเร็จ กรุณาลองรีเฟรชหน้านี้อีกครั้ง";
      return;
    }
  }

  everConfirmedAdmin = true;
  currentAdminUser = user;
  welcomeMsg.textContent = `Welcome ${user.email}`;
  // Only reveal the page content after we've confirmed this is a real admin.
  mainContent.style.display = "flex";
  loadDashboard();
}

onAuthStateChanged(auth, handleAuthState);

logoutLink.addEventListener("click", async (e) => {
  e.preventDefault();
  await signOut(auth);
  window.location.href = "./login.html";
});

async function loadDashboard() {
  loadingText.textContent = "กำลังโหลดรายชื่อ...";
  toolbar.style.display = "none";
  rowsContainer.innerHTML = "";

  try {
    const idToken = await currentAdminUser.getIdToken();
    const res = await fetch("/api/admin/list-data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      }
    });

    if (!res.ok) {
      throw new Error("Failed to load dashboard data");
    }

    const { users, payments } = await res.json();

    const paymentsByNuid = {};
    payments.forEach((p) => {
      paymentsByNuid[p.id] = p;
    });

    // Sort by Nu ID so the list is stable and easy to scan (1-91 in order).
    const userDocs = users.slice().sort((a, b) => a.id.localeCompare(b.id));

    if (userDocs.length === 0) {
      loadingText.textContent = "ไม่พบรายชื่อผู้ใช้ (ยังไม่ได้ seed ข้อมูล users)";
      return;
    }

    loadingText.textContent = "";

    allUsers = userDocs.map((userData, index) => {
      const nuid = userData.id;
      const payment = paymentsByNuid[nuid] || null;
      const paid = !!(payment && payment.paid);

      // studentStatus is a manual admin override. Older records that
      // predate this feature won't have it yet, so fall back to the
      // paid flag: paid -> "normal", not paid -> "unpaid". Once an
      // admin picks a status from the dropdown it's stored explicitly
      // and takes over from here on, including "termination" which
      // paid/unpaid alone can't represent.
      const studentStatus = payment && payment.studentStatus
        ? payment.studentStatus
        : (paid ? "normal" : "unpaid");

      return {
        index: index + 1,
        nuid,
        name: userData.name || "-",
        email: userData.email || "-",
        paid,
        // A slip that's been submitted (via api/submit-slip.js) but
        // not yet approved by an admin (via api/admin/approve-slip.js)
        // -- see firestore.rules for why paid can no longer flip to
        // true on its own just because a slip was uploaded.
        pendingReview: !!(payment && payment.slipUrl && !paid),
        studentStatus,
        slipUrl: payment ? payment.slipUrl : null,
        slipPublicId: payment ? payment.slipPublicId : null
      };
    });

    toolbar.style.display = "flex";
    renderPagination();
    // Clamp in case the roster shrank since the last load.
    const pageCount = Math.max(1, Math.ceil(allUsers.length / PAGE_SIZE));
    if (currentPage > pageCount) currentPage = pageCount;
    renderCurrentView();
  } catch (err) {
    console.error("Failed to load dashboard:", err);
    loadingText.textContent = "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
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
      showPendingOnly = false;
      pendingFilterToggle.classList.remove("active");
      renderCurrentView();
    });
    pagination.appendChild(btn);
  }
}

function renderCurrentView() {
  if (currentSearch || showPendingOnly) {
    renderFilteredResults();
  } else {
    renderPageRows();
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

// Combines the search box and the "pending approval only" toggle --
// either or both can be active at once. Shown as a flat list across
// the whole roster (like search always was), not one page at a time.
function renderFilteredResults() {
  pagination.classList.add("hidden");

  const term = currentSearch.trim().toLowerCase();
  const matches = allUsers.filter((u) => {
    const matchesTerm = !term || (
      u.nuid.toLowerCase().includes(term) ||
      u.name.toLowerCase().includes(term) ||
      u.email.toLowerCase().includes(term)
    );
    const matchesPending = !showPendingOnly || u.pendingReview;
    return matchesTerm && matchesPending;
  });

  searchResultsInfo.style.display = "block";
  searchResultsInfo.textContent = matches.length
    ? `พบ ${matches.length} รายการ`
    : showPendingOnly
      ? "ไม่มีรายการที่รอตรวจสอบ"
      : "ไม่พบผู้ใช้ที่ตรงกับคำค้นหา";

  rowsContainer.innerHTML = "";
  matches.forEach((u) => rowsContainer.appendChild(buildRow(u)));
}

pendingFilterToggle.addEventListener("click", () => {
  showPendingOnly = !showPendingOnly;
  pendingFilterToggle.classList.toggle("active", showPendingOnly);
  renderCurrentView();
});

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
  normal: { label: "ปกติ", pillClass: "status-normal", cardClass: "card-normal" },
  termination: { label: "พ้นสภาพ", pillClass: "status-termination", cardClass: "card-termination" },
  unpaid: { label: "ยังไม่จ่าย", pillClass: "status-unpaid", cardClass: "card-unpaid" }
};

function buildRow({ index, nuid, name, email, paid, pendingReview, studentStatus, slipUrl, slipPublicId }) {
  const row = document.createElement("div");
  row.className = "stat-row";
  row.dataset.nuid = nuid;

  const rowIndex = document.createElement("div");
  rowIndex.className = "row-index";
  rowIndex.textContent = index;
  row.appendChild(rowIndex);

  const card = document.createElement("div");
  card.className = "user-card";
  applyCardStatusClass(card, studentStatus);
  // Amber border overrides the normal status color while a slip is
  // awaiting approval, so it stands out in the list regardless of
  // studentStatus (usually still "unpaid" at this point, since paid
  // only flips once approved).
  if (pendingReview) {
    card.classList.add("pending-review");
  }

  // Status control: a <select> styled as a colored pill. Admins click
  // it and choose one of the three states -- picking a new value
  // saves it via the server (see handleStatusChange).
  const statusSelect = document.createElement("select");
  statusSelect.className = `status-pill ${STATUS_META[studentStatus].pillClass}`;
  statusSelect.dataset.previousValue = studentStatus;
  Object.entries(STATUS_META).forEach(([value, meta]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = meta.label;
    if (value === studentStatus) opt.selected = true;
    statusSelect.appendChild(opt);
  });
  statusSelect.addEventListener("change", () => {
    handleStatusChange(nuid, statusSelect.value, statusSelect, card);
  });
  card.appendChild(statusSelect);

  const avatar = document.createElement("div");
  avatar.className = "avatar-placeholder";
  card.appendChild(avatar);

  const nameEl = document.createElement("div");
  nameEl.className = "user-name";
  nameEl.textContent = `${nuid} - ${name}`;
  card.appendChild(nameEl);

  const emailEl = document.createElement("div");
  emailEl.className = "user-email";
  emailEl.textContent = email;
  card.appendChild(emailEl);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  // Security: only render the slip link if the URL is a valid https:// link.
  // This prevents stored XSS via javascript: or data: URIs.
  if (slipUrl && slipUrl.startsWith("https://")) {
    const viewLink = document.createElement("a");
    viewLink.href = slipUrl;
    viewLink.target = "_blank";
    viewLink.rel = "noopener noreferrer";
    viewLink.className = "action-btn-view";
    viewLink.textContent = "ดูสลิปที่อัพโหลด";
    actions.appendChild(viewLink);

    if (pendingReview) {
      const approveLink = document.createElement("a");
      approveLink.href = "#";
      approveLink.className = "action-btn-view";
      approveLink.textContent = "อนุมัติ (Approve)";
      approveLink.addEventListener("click", (e) => {
        e.preventDefault();
        handleApprove(nuid, approveLink);
      });
      actions.appendChild(approveLink);
    }

    const deleteLink = document.createElement("a");
    deleteLink.href = "#";
    deleteLink.className = "action-btn-delete";
    deleteLink.textContent = "ลบ";
    deleteLink.addEventListener("click", (e) => {
      e.preventDefault();
      handleDelete(nuid, slipPublicId, deleteLink);
    });
    actions.appendChild(deleteLink);
  } else {
    const noSlip = document.createElement("span");
    noSlip.className = "action-btn-view";
    noSlip.style.opacity = "0.5";
    noSlip.textContent = "ยังไม่มีสลิป";
    actions.appendChild(noSlip);
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

  try {
    const idToken = await currentAdminUser.getIdToken();

    const res = await fetch("/api/admin/set-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ nuid, status: newStatus })
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || "Status update failed");
    }

    selectEl.className = `status-pill ${STATUS_META[newStatus].pillClass}`;
    selectEl.dataset.previousValue = newStatus;
    applyCardStatusClass(card, newStatus);

    // Keep the in-memory list in sync too, so the new status is still
    // correct if the admin switches page or searches without a reload.
    const cached = allUsers.find((u) => u.nuid === nuid);
    if (cached) cached.studentStatus = newStatus;
  } catch (err) {
    console.error("Status update failed:", err);
    alert("เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    selectEl.value = previousValue;
  } finally {
    selectEl.disabled = false;
  }
}

async function handleApprove(nuid, triggerEl) {
  const confirmed = window.confirm(
    `ยืนยันอนุมัติสลิปของรหัสนิสิต ${nuid}?\nระบบจะเปลี่ยนสถานะเป็น "จ่ายแล้ว"`
  );
  if (!confirmed) return;

  const originalText = triggerEl.textContent;
  triggerEl.textContent = "กำลังอนุมัติ...";

  try {
    const idToken = await currentAdminUser.getIdToken();

    const res = await fetch("/api/admin/approve-slip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ nuid })
    });

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
  }
}

async function handleDelete(nuid, slipPublicId, triggerEl) {
  const confirmed = window.confirm(
    `ยืนยันลบสลิปของรหัสนิสิต ${nuid}?\nระบบจะเปลี่ยนสถานะกลับเป็น "ยังไม่จ่าย" ด้วย`
  );
  if (!confirmed) return;

  triggerEl.textContent = "กำลังลบ...";

  try {
    const idToken = await currentAdminUser.getIdToken();

    const res = await fetch("/api/admin/delete-slip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ nuid, slipPublicId })
    });

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
  }
}
