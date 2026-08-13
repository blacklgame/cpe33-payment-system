/* ------------------------------------------------------------
   1) Sync this page to whichever Nu ID logged in (same session
      key the login page + home page use), e.g. "69360303"
------------------------------------------------------------ */
import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { db } from "../firebase.js";
import { ensureSignedInAsNuid } from "../auth-session.js";

// Same three states + colors the admin dashboard uses, so a
// student sees the exact same label/color an admin set for them.
// "normal"/"unpaid"/"pending" here describe the OVERALL picture
// across every month (see computeOverallStatus below) unless an
// admin has set studentStatus to "termination", which always wins.
const STATUS_META = {
  normal: {
    label: "ปกติ",
    pillClass: "status-normal",
    cardClass: "card-normal",
    note: "ชำระเงินครบทุกเดือนที่เปิดไว้แล้ว"
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
    note: "มีเดือนที่ยังไม่ได้ชำระเงิน กรุณาอัปโหลดสลิปที่หน้าหลัก"
  },
  pending: {
    label: "รอตรวจสอบ",
    pillClass: "status-pending",
    cardClass: "card-pending",
    note: "ได้รับสลิปของคุณแล้ว กำลังรอผู้ดูแลระบบตรวจสอบ"
  }
};

const MONTH_PILL_META = {
  paid: { label: "จ่ายแล้ว", pillClass: "status-normal" },
  pending: { label: "รอตรวจสอบ", pillClass: "status-pending" },
  unpaid: { label: "ยังไม่จ่าย", pillClass: "status-unpaid" }
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

  // Show first initial inside the avatar circle
  const avatarEl = document.querySelector(".avatar-placeholder");
  if (avatarEl) {
    avatarEl.textContent = user.name ? user.name.trim()[0].toUpperCase() : "?";
  }

  const statusCard = document.getElementById("statusCard");
  const statusBadge = document.getElementById("statusBadge");
  const statusNote = document.getElementById("statusNote");
  const slipLink = document.getElementById("slipLink");
  const detailPaid = document.getElementById("detailPaid");
  const detailStudentStatus = document.getElementById("detailStudentStatus");
  const monthsHint = document.getElementById("monthsHint");
  const monthsList = document.getElementById("monthsList");

  function statusKeyFor(record) {
    if (!record) return "unpaid";
    if (record.paid) return "paid";
    if (record.reviewStatus === "pending") return "pending";
    return "unpaid";
  }

  // Overall badge across every month an admin has created: "normal"
  // only if every month is paid, "pending" if at least one is
  // awaiting review (and none are flat-out unpaid), otherwise
  // "unpaid". An empty months list (nothing created yet) counts as
  // "normal" -- there's nothing to owe yet.
  function computeOverallStatus(months, statusByMonth) {
    if (months.length === 0) return "normal";
    const keys = months.map((m) => statusKeyFor(statusByMonth[m.id]));
    if (keys.every((k) => k === "paid")) return "normal";
    if (keys.some((k) => k === "unpaid")) return "unpaid";
    return "pending";
  }

  /* ----------------------------------------------------------
     2) Look up this user's payment records in Firestore.
     The upload page (public/logined/index.js) writes a doc at
     payments/{nuid}/months/{monthId} for each slip. An admin can
     also override studentStatus (top-level payments/{nuid} doc)
     from the admin dashboard -- when it's "termination", that
     always wins over whatever the per-month picture looks like.
  ---------------------------------------------------------- */
  ensureSignedInAsNuid(user.id)
    .then(() =>
      Promise.all([
        getDoc(doc(db, "payments", user.id)),
        getDocs(collection(db, "months")),
        getDocs(collection(db, "payments", user.id, "months"))
      ])
    )
    .then(([paymentSnap, monthsSnap, monthlySnap]) => {
      const payment = paymentSnap.exists() ? paymentSnap.data() : null;
      const override = payment && payment.studentStatus === "termination" ? "termination" : null;

      const months = monthsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => b.id.localeCompare(a.id));

      const statusByMonth = {};
      monthlySnap.docs.forEach((d) => {
        statusByMonth[d.id] = d.data();
      });

      const overall = override || computeOverallStatus(months, statusByMonth);
      const meta = STATUS_META[overall] || STATUS_META.unpaid;

      statusBadge.textContent = meta.label;
      statusBadge.className = `status-pill ${meta.pillClass}`;
      statusCard.className = `status-card ${meta.cardClass}`;
      statusNote.textContent = meta.note;

      const paidCount = months.filter((m) => statusKeyFor(statusByMonth[m.id]) === "paid").length;
      detailPaid.textContent = months.length ? `${paidCount}/${months.length} เดือน` : "-";
      detailStudentStatus.textContent = meta.label;

      // Point the top "view slip" link at the most recently
      // submitted month's slip, if any -- the per-month list below
      // has a link for every individual month too.
      const mostRecentWithSlip = months.find((m) => statusByMonth[m.id] && statusByMonth[m.id].slipUrl);
      const topSlipUrl = mostRecentWithSlip ? statusByMonth[mostRecentWithSlip.id].slipUrl : null;
      if (topSlipUrl && topSlipUrl.startsWith("https://")) {
        slipLink.href = topSlipUrl;
        slipLink.classList.add("show");
      }

      renderMonthsList(months, statusByMonth);
    })
    .catch((err) => {
      console.error("Failed to load payment status:", err);
      statusBadge.textContent = "โหลดข้อมูลไม่สำเร็จ";
      statusBadge.className = "status-pill status-unpaid";
      statusCard.className = "status-card card-unpaid";
      statusNote.textContent = "ไม่สามารถโหลดสถานะได้ กรุณาลองรีเฟรชหน้านี้อีกครั้ง";
      detailPaid.textContent = "-";
      detailStudentStatus.textContent = "-";
      monthsHint.textContent = "โหลดข้อมูลไม่สำเร็จ กรุณาลองรีเฟรชหน้านี้อีกครั้ง";
    });

  function renderMonthsList(months, statusByMonth) {
    monthsList.innerHTML = "";

    if (months.length === 0) {
      monthsHint.textContent = "ยังไม่มีเดือนที่เปิดให้ชำระเงิน";
      return;
    }

    monthsHint.textContent = "";

    months.forEach((m) => {
      const record = statusByMonth[m.id];
      const key = statusKeyFor(record);
      const meta = MONTH_PILL_META[key];

      const row = document.createElement("div");
      row.className = "month-row";

      const left = document.createElement("div");
      left.className = "month-row-left";
      left.innerHTML = `<div class="month-row-label">${m.label || m.id}</div>` +
        `<div class="month-row-amount">${Number(m.amount || 0).toLocaleString("th-TH")} บาท</div>`;
      row.appendChild(left);

      const right = document.createElement("div");
      right.className = "month-row-right";

      const slipUrl = record ? record.slipUrl : null;
      if (slipUrl && slipUrl.startsWith("https://")) {
        const link = document.createElement("a");
        link.href = slipUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "month-row-slip-link";
        link.textContent = "ดูสลิป";
        right.appendChild(link);
      }

      const pill = document.createElement("span");
      pill.className = `status-pill ${meta.pillClass}`;
      pill.textContent = meta.label;
      right.appendChild(pill);

      row.appendChild(right);
      monthsList.appendChild(row);
    });
  }
}

document.getElementById("logoutLink").addEventListener("click", (e) => {
  e.preventDefault();
  sessionStorage.removeItem("cpe33_user");
  window.location.href = "../index.html";
});
