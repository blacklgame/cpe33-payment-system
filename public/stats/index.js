/* ------------------------------------------------------------
   1) Sync this page to whichever Nu ID logged in (same session
      key the login page + home page use), e.g. "69360303"
------------------------------------------------------------ */
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from "../firebase.js";

// Same three states + colors the admin dashboard uses, so a
// student sees the exact same label/color an admin set for them.
const STATUS_META = {
  normal: {
    label: "ปกติ",
    pillClass: "status-normal",
    cardClass: "card-normal",
    note: "ตรวจสอบการชำระเงินเรียบร้อยแล้ว สถานะของคุณเป็นปกติ"
  },
  termination: {
    label: "พ้นสภาพ",
    pillClass: "status-termination",
    cardClass: "card-termination",
    note: "สถานะนิสิตของคุณถูกตั้งเป็น \"พ้นสภาพ\" หากคิดว่าไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ"
  },
  unpaid: {
    label: "ยังไม่จ่าย",
    pillClass: "status-unpaid",
    cardClass: "card-unpaid",
    note: "ยังไม่พบการชำระเงินของคุณ กรุณาอัปโหลดสลิปที่หน้าหลัก"
  }
};

const raw = sessionStorage.getItem("cpe33_user");

if (!raw) {
  // No one is logged in -> send back to the login page
  window.location.href = "../index.html";
} else {
  const user = JSON.parse(raw);

  document.getElementById("greeting").textContent = `สวัสดี, ${user.name}`;
  document.getElementById("userName").textContent = user.name;
  document.getElementById("userEmail").textContent = user.email;
  document.getElementById("detailNuid").textContent = user.id;

  const statusCard = document.getElementById("statusCard");
  const statusBadge = document.getElementById("statusBadge");
  const statusNote = document.getElementById("statusNote");
  const slipLink = document.getElementById("slipLink");
  const detailPaid = document.getElementById("detailPaid");
  const detailStudentStatus = document.getElementById("detailStudentStatus");

  /* ----------------------------------------------------------
     2) Look up this user's payment record in Firestore.
     The home page (public/logined/index.js) writes this doc,
     at payments/{nuid}, when a user successfully uploads their
     slip to Storage. An admin can also override studentStatus
     from the admin dashboard -- when present, that takes over
     from the plain paid/unpaid flag (see dashboard.js).
  ---------------------------------------------------------- */
  getDoc(doc(db, "payments", user.id))
    .then((paymentSnap) => {
      const payment = paymentSnap.exists() ? paymentSnap.data() : null;
      const paid = !!(payment && payment.paid);
      const studentStatus = payment && payment.studentStatus
        ? payment.studentStatus
        : (paid ? "normal" : "unpaid");

      const meta = STATUS_META[studentStatus] || STATUS_META.unpaid;

      statusBadge.textContent = meta.label;
      statusBadge.className = `status-pill ${meta.pillClass}`;
      statusCard.className = `status-card ${meta.cardClass}`;
      statusNote.textContent = meta.note;

      detailPaid.textContent = paid ? "จ่ายแล้ว" : "ยังไม่จ่าย";
      detailStudentStatus.textContent = meta.label;

      const slipUrl = payment ? payment.slipUrl : null;
      if (slipUrl) {
        slipLink.href = slipUrl;
        slipLink.classList.add("show");
      }
    })
    .catch((err) => {
      console.error("Failed to load payment status:", err);
      statusBadge.textContent = "โหลดข้อมูลไม่สำเร็จ";
      statusBadge.className = "status-pill status-unpaid";
      statusCard.className = "status-card card-unpaid";
      statusNote.textContent = "ไม่สามารถโหลดสถานะได้ กรุณาลองรีเฟรชหน้านี้อีกครั้ง";
      detailPaid.textContent = "-";
      detailStudentStatus.textContent = "-";
    });
}

document.getElementById("logoutLink").addEventListener("click", (e) => {
  e.preventDefault();
  sessionStorage.removeItem("cpe33_user");
  window.location.href = "../index.html";
});
