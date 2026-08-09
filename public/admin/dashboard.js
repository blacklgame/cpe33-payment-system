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
import {
  collection,
  getDocs,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { db, auth } from "../firebase.js";

const welcomeMsg = document.getElementById("welcomeMsg");
const loadingText = document.getElementById("loadingText");
const rowsContainer = document.getElementById("rowsContainer");
const logoutLink = document.getElementById("logoutLink");

const adminEmailsPromise = fetch("./admin-emails.json").then((res) => res.json());

async function isWhitelisted(email) {
  if (!email) return false;
  const adminEmails = await adminEmailsPromise;
  return adminEmails.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}

let currentAdminUser = null;

onAuthStateChanged(auth, async (user) => {
  if (!user || !(await isWhitelisted(user.email))) {
    // Not signed in, or signed in but not an approved admin -- bounce
    // back to the login page either way.
    window.location.href = "./login.html";
    return;
  }
  currentAdminUser = user;
  welcomeMsg.textContent = `Welcome ${user.email}`;
  loadDashboard();
});

logoutLink.addEventListener("click", async (e) => {
  e.preventDefault();
  await signOut(auth);
  window.location.href = "./login.html";
});

async function loadDashboard() {
  loadingText.textContent = "กำลังโหลดรายชื่อ...";
  rowsContainer.innerHTML = "";

  try {
    const [usersSnap, paymentsSnap] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "payments"))
    ]);

    const paymentsByNuid = {};
    paymentsSnap.forEach((d) => {
      paymentsByNuid[d.id] = d.data();
    });

    // Sort by Nu ID so the list is stable and easy to scan (1-91 in order).
    const userDocs = usersSnap.docs.sort((a, b) => a.id.localeCompare(b.id));

    if (userDocs.length === 0) {
      loadingText.textContent = "ไม่พบรายชื่อผู้ใช้ (ยังไม่ได้ seed ข้อมูล users)";
      return;
    }

    loadingText.textContent = "";

    userDocs.forEach((userDoc, index) => {
      const nuid = userDoc.id;
      const userData = userDoc.data();
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

      rowsContainer.appendChild(
        buildRow({
          index: index + 1,
          nuid,
          name: userData.name || "-",
          email: userData.email || "-",
          paid,
          studentStatus,
          slipUrl: payment ? payment.slipUrl : null,
          slipPublicId: payment ? payment.slipPublicId : null
        })
      );
    });
  } catch (err) {
    console.error("Failed to load dashboard:", err);
    loadingText.textContent = "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
  }
}

const STATUS_META = {
  normal: { label: "ปกติ", pillClass: "status-normal", cardClass: "card-normal" },
  termination: { label: "พ้นสภาพ", pillClass: "status-termination", cardClass: "card-termination" },
  unpaid: { label: "ยังไม่จ่าย", pillClass: "status-unpaid", cardClass: "card-unpaid" }
};

function buildRow({ index, nuid, name, email, paid, studentStatus, slipUrl, slipPublicId }) {
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

  if (slipUrl) {
    const viewLink = document.createElement("a");
    viewLink.href = slipUrl;
    viewLink.target = "_blank";
    viewLink.rel = "noopener";
    viewLink.className = "action-btn-view";
    viewLink.textContent = "ดูสลิปที่อัพโหลด";
    actions.appendChild(viewLink);

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
  } catch (err) {
    console.error("Status update failed:", err);
    alert("เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    selectEl.value = previousValue;
  } finally {
    selectEl.disabled = false;
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
