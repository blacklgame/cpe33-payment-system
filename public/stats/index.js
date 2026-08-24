/* ------------------------------------------------------------
   1) Sync this page to whichever Nu ID logged in (same session
      key the login page + home page use), e.g. "69360303"
------------------------------------------------------------ */
import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { db, auth } from "../firebase.js";
import { ensureSignedInAsNuid, clearActivity } from "../auth-session.js";

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
  partial: {
    label: "ผ่อนจ่าย",
    pillClass: "status-partial",
    cardClass: "card-partial",
    note: "คุณมียอดผ่อนชำระค้างอยู่ กรุณาอัปโหลดสลิปชำระส่วนที่เหลือที่หน้าหลัก"
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
  partial: { label: "ผ่อนจ่าย", pillClass: "status-partial" },
  unpaid: { label: "ยังไม่จ่าย", pillClass: "status-unpaid" }
};

const raw = sessionStorage.getItem("cpe33_user");

if (!raw) {
  window.location.href = "../index.html";
} else {
  const user = JSON.parse(raw);

  document.getElementById("greeting").textContent = `สวัสดี, ${user.name}`;
  document.getElementById("userName").textContent = user.name;
  document.getElementById("userEmail").textContent = user.email;
  document.getElementById("detailNuid").textContent = user.id;

  const avatarEl = document.querySelector(".avatar-placeholder");
  if (avatarEl) {
    const initial = user.name ? user.name.trim()[0].toUpperCase() : "?";
    if (user.photoURL) {
      avatarEl.innerHTML = "";
      const img = document.createElement("img");
      img.className = "avatar-img";
      img.src = user.photoURL;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;";
      img.onerror = () => {
        avatarEl.innerHTML = "";
        avatarEl.textContent = initial;
      };
      avatarEl.appendChild(img);
    } else {
      avatarEl.innerHTML = "";
      avatarEl.textContent = initial;
    }
  }

  const statusCard = document.getElementById("statusCard");
  const statusBadge = document.getElementById("statusBadge");
  const statusNote = document.getElementById("statusNote");
  const slipLink = document.getElementById("slipLink");
  const detailPaid = document.getElementById("detailPaid");
  const detailStudentStatus = document.getElementById("detailStudentStatus");
  const monthsHint = document.getElementById("monthsHint");
  const monthsList = document.getElementById("monthsList");

  function getLedgerInfo(m, record) {
    const targetAmount = record?.targetAmount || record?.amount || m.amount || 0;
    const paidAmount = record?.paidAmount || (record?.paid ? targetAmount : 0);
    const remainingBalance = Math.max(0, targetAmount - paidAmount);
    const paid = !!(record?.paid || paidAmount >= targetAmount);
    const reviewStatus = record?.reviewStatus || null;

    return { targetAmount, paidAmount, remainingBalance, paid, reviewStatus };
  }

  function computeOverallStatus(months, statusByMonth) {
    if (months.length === 0) return "normal";
    const ledgers = months.map((m) => getLedgerInfo(m, statusByMonth[m.id]));
    if (ledgers.every((l) => l.paid)) return "normal";
    if (ledgers.some((l) => l.reviewStatus === "pending")) return "pending";
    if (ledgers.some((l) => l.paidAmount > 0)) return "partial";
    return "unpaid";
  }

  function loadStatsData() {
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

        const paidCount = months.filter((m) => getLedgerInfo(m, statusByMonth[m.id]).paid).length;
        detailPaid.textContent = months.length ? `${paidCount}/${months.length} เดือน` : "-";
        detailStudentStatus.textContent = meta.label;

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
  }

  (async () => {
    if (typeof auth.authStateReady === "function") {
      await auth.authStateReady();
    }
    loadStatsData();
  })();

  let selectedStatsYear = null;

  function renderMonthsList(months, statusByMonth) {
    monthsList.innerHTML = "";

    if (months.length === 0) {
      monthsHint.textContent = "ยังไม่มีเดือนที่เปิดให้ชำระเงิน";
      const oldTabs = document.getElementById("statsYearTabs");
      if (oldTabs) oldTabs.remove();
      return;
    }

    monthsHint.textContent = "";

    const years = Array.from(new Set(months.map((m) => String(m.year || m.id.split("-")[0])))).sort().reverse();

    if (!selectedStatsYear || (!years.includes(selectedStatsYear) && selectedStatsYear !== "all")) {
      selectedStatsYear = years[0] || "all";
    }

    let tabsBar = document.getElementById("statsYearTabs");
    if (!tabsBar) {
      tabsBar = document.createElement("div");
      tabsBar.id = "statsYearTabs";
      tabsBar.className = "year-tabs-container";
      monthsList.parentNode.insertBefore(tabsBar, monthsList);
    }
    tabsBar.innerHTML = "";

    if (years.length > 1) {
      const allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.className = `year-tab-btn ${selectedStatsYear === "all" ? "active" : ""}`;
      allBtn.textContent = "ทั้งหมด";
      allBtn.addEventListener("click", () => {
        selectedStatsYear = "all";
        renderMonthsList(months, statusByMonth);
      });
      tabsBar.appendChild(allBtn);
    }

    years.forEach((yr) => {
      const yrBtn = document.createElement("button");
      yrBtn.type = "button";
      yrBtn.className = `year-tab-btn ${selectedStatsYear === yr ? "active" : ""}`;
      yrBtn.textContent = `ปี ${yr}`;
      yrBtn.addEventListener("click", () => {
        selectedStatsYear = yr;
        renderMonthsList(months, statusByMonth);
      });
      tabsBar.appendChild(yrBtn);
    });

    const filteredMonths = months.filter((m) => {
      if (selectedStatsYear === "all") return true;
      const mYr = String(m.year || m.id.split("-")[0]);
      return mYr === selectedStatsYear;
    });

    filteredMonths.forEach((m) => {
      const record = statusByMonth[m.id];
      const ledger = getLedgerInfo(m, record);

      let pillLabel = MONTH_PILL_META.unpaid.label;
      let pillClass = MONTH_PILL_META.unpaid.pillClass;
      let amountSubtext = `${ledger.targetAmount.toLocaleString("th-TH")} บาท`;

      if (ledger.paid) {
        pillLabel = MONTH_PILL_META.paid.label;
        pillClass = MONTH_PILL_META.paid.pillClass;
        amountSubtext = `ชำระแล้ว ${ledger.targetAmount.toLocaleString("th-TH")} บาท`;
      } else if (ledger.reviewStatus === "pending") {
        pillLabel = MONTH_PILL_META.pending.label;
        pillClass = MONTH_PILL_META.pending.pillClass;
        amountSubtext = `รอตรวจสอบสลิป (${ledger.targetAmount.toLocaleString("th-TH")} บาท)`;
      } else if (ledger.paidAmount > 0) {
        pillLabel = `ผ่อนจ่าย (${ledger.paidAmount.toLocaleString("th-TH")}/${ledger.targetAmount.toLocaleString("th-TH")} บาท)`;
        pillClass = MONTH_PILL_META.partial.pillClass;
        amountSubtext = `ชำระแล้ว ${ledger.paidAmount.toLocaleString("th-TH")}/${ledger.targetAmount.toLocaleString("th-TH")} บาท (คงเหลือ ${ledger.remainingBalance.toLocaleString("th-TH")} บาท)`;
      }

      const row = document.createElement("div");
      row.className = "month-row";

      const left = document.createElement("div");
      left.className = "month-row-left";
      left.innerHTML = `<div class="month-row-label">${m.label || m.id}</div>` +
        `<div class="month-row-amount">${amountSubtext}</div>`;
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
      pill.className = `status-pill ${pillClass}`;
      pill.textContent = pillLabel;
      right.appendChild(pill);

      row.appendChild(right);
      monthsList.appendChild(row);
    });
  }
}

document.getElementById("logoutLink").addEventListener("click", async (e) => {
  e.preventDefault();
  sessionStorage.removeItem("cpe33_user");
  clearActivity();
  try {
    await signOut(auth);
  } catch (err) {
    console.error("Sign-out error:", err);
  }
  window.location.href = "../index.html";
});
