/* ------------------------------------------------------------
   Admin dashboard: lists every user 1-91, shows paid/unpaid,
   links to the uploaded slip, and lets the admin delete a slip
   (which also resets that user back to unpaid).

   This client-side whitelist decides whether the page renders at
   all -- it is NOT the real security boundary. The delete action
   is re-checked independently on the server (api/admin/delete-slip.js),
   which is the only place that actually matters for security, since
   client-side checks can always be bypassed in devtools.
------------------------------------------------------------ */
const ADMIN_EMAILS = [
  "natthaphatb69@nu.ac.th"
];

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

function isWhitelisted(email) {
  if (!email) return false;
  return ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}

let currentAdminUser = null;

onAuthStateChanged(auth, (user) => {
  if (!user || !isWhitelisted(user.email)) {
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

      rowsContainer.appendChild(
        buildRow({
          index: index + 1,
          nuid,
          name: userData.name || "-",
          email: userData.email || "-",
          paid,
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

function buildRow({ index, nuid, name, email, paid, slipUrl, slipPublicId }) {
  const row = document.createElement("div");
  row.className = "stat-row";
  row.dataset.nuid = nuid;

  const rowIndex = document.createElement("div");
  rowIndex.className = "row-index";
  rowIndex.textContent = index;
  row.appendChild(rowIndex);

  const card = document.createElement("div");
  card.className = "user-card";

  const pill = document.createElement("div");
  pill.className = `status-pill ${paid ? "status-paid" : "status-unpaid"}`;
  pill.textContent = paid ? "จ่ายแล้ว" : "ยังไม่จ่าย";
  card.appendChild(pill);

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
