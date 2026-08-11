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
// Checks whether the currently signed-in user is an approved admin.
// Note: We no longer call a separate check-admin endpoint on every
// load. Instead, we call /api/admin/list-data directly. The server
// checks the email whitelist in list-data. If it returns 401 or 403,
// we redirect the user to login. This combines data fetching and
// authorization into a single, reliable step.
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
    // Fallback: check if there is an active Firebase Auth user session in localStorage
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

// Every admin API call goes through here instead of calling fetch()
// directly. The reason: a Firebase ID token is only good for ~1
// hour, and the SDK's own background refresh timer can slip (e.g.
// the tab sat inactive/backgrounded for a while, which browsers
// throttle) -- so `currentAdminUser.getIdToken()` can occasionally
// hand back a token that's already expired by the time the server
// checks it, and the request comes back 401/403 even though the
// admin is genuinely still signed in.
//
// Previously that 401/403 was taken at face value as "really signed
// out" and sent the admin back to login -- annoying and wrong, since
// signing in again gets a brand new (valid) token and the very same
// action then works fine. Instead: on a 401/403, force Firebase to
// mint a *real* fresh token (getIdToken(true) skips the local cache
// and talks to Firebase directly) and retry exactly once before
// treating it as an actual sign-out. Callers only see genuine auth
// failures now.
async function authorizedFetch(url, body) {
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
  window.location.href = "./login.html";
}

// Waits for a spurious onAuthStateChanged(null) to resolve itself.
async function waitForRealSignOut() {
  const delaysMs = [800, 1500, 2500];
  for (const ms of delaysMs) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    if (auth.currentUser) return false; // recovered
  }
  return true;
}

async function handleAuthState(user) {
  if (user) {
    // Always capture the latest user object
    currentAdminUser = user;

    // If this admin is already confirmed in this session, don't
    // trigger a full dashboard reload on silent token updates.
    if (everConfirmedAdmin) return;

    welcomeMsg.textContent = `Welcome ${user.email}`;
    mainContent.style.display = "flex"; // Show main content area so loading text is visible
    loadDashboard();
    return;
  }

  // --- user is null ---
  if (!everConfirmedAdmin && !wasAdminSeenBefore()) {
    goToLogin();
    return;
  }

  const reallySignedOut = await waitForRealSignOut();
  if (!reallySignedOut) {
    return;
  }
  goToLogin();
}

onAuthStateChanged(auth, handleAuthState);

logoutLink.addEventListener("click", async (e) => {
  e.preventDefault();
  stopAutoRefresh();
  clearAdminSeen();
  await signOut(auth);
  window.location.href = "./login.html";
});

// Turns the raw {users, payments} response into the flat, sorted
// array the rest of the file renders from. Pulled out on its own so
// both the initial load and the silent background refresh (below)
// build rows exactly the same way -- one place to keep in sync.
function mapUsersAndPayments(users, payments) {
  const paymentsByNuid = {};
  payments.forEach((p) => {
    paymentsByNuid[p.id] = p;
  });

  // Sort by Nu ID so the list is stable and easy to scan (1-91 in order).
  const userDocs = users.slice().sort((a, b) => a.id.localeCompare(b.id));

  return userDocs.map((userData, index) => {
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
}

async function loadDashboard() {
  loadingText.textContent = "กำลังโหลดรายชื่อ...";
  toolbar.style.display = "none";
  rowsContainer.innerHTML = "";

  try {
    const res = await authorizedFetch("/api/admin/list-data", {});

    if (res.status === 401) {
      // Token expired/invalid after retry -- dead session.
      goToLogin();
      return;
    }

    if (res.status === 403) {
      // Not an approved admin. Try to extract which email was rejected
      // so the login page can show a clear, actionable message.
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

    const { users, payments } = await res.json();

    if (users.length === 0) {
      loadingText.textContent = "ไม่พบรายชื่อผู้ใช้ (ยังไม่ได้ seed ข้อมูล users)";
      return;
    }

    loadingText.textContent = "";
    allUsers = mapUsersAndPayments(users, payments);

    toolbar.style.display = "flex";
    renderPagination();
    // Clamp in case the roster shrank since the last load.
    const pageCount = Math.max(1, Math.ceil(allUsers.length / PAGE_SIZE));
    if (currentPage > pageCount) currentPage = pageCount;
    renderCurrentView();

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
   page number / search / pending filter), so a newly-submitted
   slip shows up in "รอตรวจสอบ" without the admin ever needing to
   reload the page. Reloading is what used to cause the whole
   re-login dance, so removing the need for it fixes both problems
   at once.

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

    const { users, payments } = await res.json();
    if (users.length === 0) return;

    const previousCount = allUsers.length;
    allUsers = mapUsersAndPayments(users, payments);

    // Only rebuild the page buttons if the roster size actually
    // changed (adding/removing a page) -- otherwise leave them alone
    // so the admin's current page selection doesn't visibly flicker.
    if (allUsers.length !== previousCount) {
      renderPagination();
      const pageCount = Math.max(1, Math.ceil(allUsers.length / PAGE_SIZE));
      if (currentPage > pageCount) currentPage = pageCount;
    }

    renderCurrentView();
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
      showPendingOnly = false;
      pendingFilterToggle.classList.remove("active");
      renderCurrentView();
    });
    pagination.appendChild(btn);
  }
}

function renderCurrentView() {
  updatePendingBadge();
  if (currentSearch || showPendingOnly) {
    renderFilteredResults();
  } else {
    renderPageRows();
  }
}

// Keeps a live count on the pending-filter button itself (e.g.
// "รอตรวจสอบ (3)") so a newly-submitted slip is visible at a glance
// the moment the next auto-refresh picks it up -- no need to even
// click into the filter to notice something showed up.
const PENDING_LABEL_BASE = "รอตรวจสอบ (Pending approval)";
function updatePendingBadge() {
  const pendingCount = allUsers.filter((u) => u.pendingReview).length;
  pendingFilterToggle.textContent = pendingCount > 0
    ? `${PENDING_LABEL_BASE} · ${pendingCount}`
    : PENDING_LABEL_BASE;
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

  // Defensive: fall back to "unpaid" if studentStatus is an unknown value
  // (e.g. "rejected" stored directly in Firestore, or any future state not
  // yet added to STATUS_META). Without this, STATUS_META[unknownKey] returns
  // undefined and the very next .pillClass access throws a runtime error that
  // breaks the entire row and stops the rest of the list from rendering.
  const resolvedStatus = STATUS_META[studentStatus] ? studentStatus : "unpaid";

  const card = document.createElement("div");
  card.className = "user-card";
  applyCardStatusClass(card, resolvedStatus);
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
  statusSelect.className = `status-pill ${STATUS_META[resolvedStatus].pillClass}`;
  statusSelect.dataset.previousValue = resolvedStatus;
  Object.entries(STATUS_META).forEach(([value, meta]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = meta.label;
    if (value === resolvedStatus) opt.selected = true;
    statusSelect.appendChild(opt);
  });
  statusSelect.addEventListener("change", () => {
    handleStatusChange(nuid, statusSelect.value, statusSelect, card);
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

      // Reject button: same as delete under the hood (removes the slip
      // from Cloudinary and sets reviewStatus:"rejected"), but shown
      // as a distinct action so the intent is unambiguous -- admin is
      // explicitly rejecting this slip, not just deleting it.
      const rejectLink = document.createElement("a");
      rejectLink.href = "#";
      rejectLink.className = "action-btn-delete";
      rejectLink.textContent = "ปฏิเสธ (Reject)";
      rejectLink.addEventListener("click", (e) => {
        e.preventDefault();
        handleReject(nuid, slipPublicId, rejectLink);
      });
      actions.appendChild(rejectLink);
    } else {
      // Slip exists but is already approved (paid:true) -- only show delete.
      const deleteLink = document.createElement("a");
      deleteLink.href = "#";
      deleteLink.className = "action-btn-delete";
      deleteLink.textContent = "ลบ";
      deleteLink.addEventListener("click", (e) => {
        e.preventDefault();
        handleDelete(nuid, slipPublicId, deleteLink);
      });
      actions.appendChild(deleteLink);
    }
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
  actionInFlight = true;

  try {
    const res = await authorizedFetch("/api/admin/set-status", { nuid, status: newStatus });

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
    actionInFlight = false;
  }
}

async function handleApprove(nuid, triggerEl) {
  const confirmed = window.confirm(
    `ยืนยันอนุมัติสลิปของรหัสนิสิต ${nuid}?\nระบบจะเปลี่ยนสถานะเป็น "จ่ายแล้ว"`
  );
  if (!confirmed) return;

  const originalText = triggerEl.textContent;
  triggerEl.textContent = "กำลังอนุมัติ...";
  actionInFlight = true;

  try {
    const res = await authorizedFetch("/api/admin/approve-slip", { nuid });

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
    `ยืนยันปฏิเสธสลิปของรหัสนิสิต ${nuid}?\nสลิปจะถูกลบและสถานะจะเปลี่ยนเป็น "สลิปถูกปฏิเสธ"\nนิสิตจะสามารถอัปโหลดสลิปใหม่ได้อีกครั้ง`
  );
  if (!confirmed) return;

  const originalText = triggerEl.textContent;
  triggerEl.textContent = "กำลังปฏิเสธ...";
  actionInFlight = true;

  try {
    const res = await authorizedFetch("/api/admin/delete-slip", { nuid, slipPublicId });

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
    `ยืนยันลบสลิปของรหัสนิสิต ${nuid}?\nระบบจะเปลี่ยนสถานะกลับเป็น "ยังไม่จ่าย" ด้วย`
  );
  if (!confirmed) return;

  triggerEl.textContent = "กำลังลบ...";
  actionInFlight = true;

  try {
    const res = await authorizedFetch("/api/admin/delete-slip", { nuid, slipPublicId });

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
