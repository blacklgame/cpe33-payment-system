/* ------------------------------------------------------------
   Member Events page (read-only view for logged-in CPE33 students)
   - Uses /api/events/list (no admin check, just valid auth token).
   - Shows 3 grand-total donut charts at top.
   - Below: accordion cards per event, expanding to show transactions.
------------------------------------------------------------ */
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { auth } from "../firebase.js";

// ── DOM refs ──────────────────────────────────────────────────
const mainContent    = document.getElementById("mainContent");
const loadingText    = document.getElementById("loadingText");
const donutStrip     = document.getElementById("donutStrip");
const eventsContainer= document.getElementById("eventsContainer");
const logoutLink     = document.getElementById("logoutLink");

const donutFgIncome  = document.getElementById("donutFgIncome");
const donutFgExpense = document.getElementById("donutFgExpense");
const donutFgBalance = document.getElementById("donutFgBalance");
const donutPctIncome = document.getElementById("donutPctIncome");
const donutPctExpense= document.getElementById("donutPctExpense");
const donutPctBalance= document.getElementById("donutPctBalance");
const grandIncomeEl  = document.getElementById("grandIncome");
const grandExpenseEl = document.getElementById("grandExpense");
const grandBalanceEl = document.getElementById("grandBalance");

// Lightbox refs
const receiptViewerModal     = document.getElementById("receiptViewerModal");
const receiptViewerTitle     = document.getElementById("receiptViewerTitle");
const receiptViewerSub       = document.getElementById("receiptViewerSub");
const receiptViewerClose     = document.getElementById("receiptViewerClose");
const receiptImgCounter      = document.getElementById("receiptImgCounter");
const lbRotateLeft           = document.getElementById("lbRotateLeft");
const lbRotateRight          = document.getElementById("lbRotateRight");
const lbZoomIn               = document.getElementById("lbZoomIn");
const lbZoomOut              = document.getElementById("lbZoomOut");
const lbZoomReset            = document.getElementById("lbZoomReset");
const lbNavPrev              = document.getElementById("lbNavPrev");
const lbNavNext              = document.getElementById("lbNavNext");
const receiptViewerImg       = document.getElementById("receiptViewerImg");
const receiptViewerOpenTab   = document.getElementById("receiptViewerOpenTab");
const receiptViewerCloseBtn  = document.getElementById("receiptViewerCloseBtn");
const lightboxStripContainer = document.getElementById("lightboxStripContainer");
const lightboxStripThumbs    = document.getElementById("lightboxStripThumbs");

// Lightbox state
let lbImages       = [];
let lbCurrentIndex = 0;
let lbRotation     = 0;
let lbZoom         = 1;

// ── Auth guard ────────────────────────────────────────────────
let currentUser = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "../index.html"; return; }
  currentUser = user;
  mainContent.style.display = "";
  await loadEvents();
});

logoutLink.addEventListener("click", async (e) => {
  e.preventDefault();
  await signOut(auth);
  location.href = "../index.html";
});

// ── Helpers ───────────────────────────────────────────────────
function fmt(n) {
  return "฿\u00a0" + Number(n).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function fmtCompact(n) {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000)    return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── API ───────────────────────────────────────────────────────
async function loadEvents() {
  loadingText.style.display = "block";
  loadingText.textContent = "กำลังโหลดข้อมูล...";

  try {
    const tok = await currentUser.getIdToken();
    const res = await fetch("/api/events/list", {
      headers: { Authorization: `Bearer ${tok}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const events = data.events || [];
    const monthlyIncomeTotal = Number(data.monthlyIncomeTotal) || 0;
    const monthlyPaidCount = Number(data.monthlyPaidCount) || 0;

    loadingText.style.display = "none";
    donutStrip.style.display = "";
    eventsContainer.style.display = "flex";

    updateDonutCharts(events, monthlyIncomeTotal);
    renderEvents(events, monthlyIncomeTotal, monthlyPaidCount);
  } catch (err) {
    console.error(err);
    loadingText.textContent = "เกิดข้อผิดพลาดในการโหลดข้อมูล";
  }
}

// ── Donut charts ──────────────────────────────────────────────
function setDonut(fgEl, pctEl, pct) {
  const d = Math.max(0, Math.min(100, pct));
  fgEl.setAttribute("stroke-dasharray", `${d < 1 ? 0 : d} ${100 - (d < 1 ? 0 : d)}`);
  pctEl.textContent = Math.round(d) + "%";
}

function updateDonutCharts(events, monthlyIncomeTotal = 0) {
  let totalIncome  = monthlyIncomeTotal;
  let totalExpense = 0;
  events.forEach((ev) => {
    totalIncome  += ev.totalIncome  || 0;
    totalExpense += ev.totalExpense || 0;
  });
  const balance = totalIncome - totalExpense;
  const grand   = Math.max(totalIncome, totalExpense, 1);

  requestAnimationFrame(() => {
    setDonut(donutFgIncome,  donutPctIncome,  (totalIncome  / grand) * 100);
    setDonut(donutFgExpense, donutPctExpense, (totalExpense / grand) * 100);
    setDonut(donutFgBalance, donutPctBalance, balance < 0 ? 0 : (balance / grand) * 100);
  });

  grandIncomeEl.textContent  = fmt(totalIncome);
  grandExpenseEl.textContent = fmt(totalExpense);
  grandBalanceEl.textContent = fmt(balance);
  grandBalanceEl.style.color = balance < 0 ? "var(--danger)" : "";
}

// ── Event accordion cards ─────────────────────────────────────
function renderEvents(events, monthlyIncomeTotal = 0, monthlyPaidCount = 0) {
  eventsContainer.innerHTML = "";

  if (monthlyIncomeTotal > 0 || monthlyPaidCount > 0) {
    const mAccordion = document.createElement("div");
    mAccordion.className = "event-accordion";
    mAccordion.style.borderLeft = "4px solid var(--primary, #3b82f6)";

    const mHeader = document.createElement("div");
    mHeader.className = "accordion-header";
    mHeader.setAttribute("role", "button");
    mHeader.setAttribute("tabindex", "0");
    mHeader.setAttribute("aria-expanded", "false");
    mHeader.innerHTML = `
      <span class="acc-emoji">💳</span>
      <div class="acc-info">
        <div class="acc-name">ค่าสาขารายเดือน (Monthly Dues)</div>
        <div class="acc-pills">
          <span class="acc-pill acc-pill-income">+${fmtCompact(monthlyIncomeTotal)} ฿</span>
          <span class="acc-pill acc-pill-expense">−0 ฿</span>
          <span class="acc-pill acc-pill-balance">
            ฿ ${fmtCompact(monthlyIncomeTotal)}
          </span>
        </div>
      </div>
      <span class="acc-chevron">▾</span>
    `;

    const mBody = document.createElement("div");
    mBody.className = "accordion-body";
    mBody.innerHTML = `
      <div class="mini-tx mini-income">
        <div class="mini-sign">+</div>
        <div class="mini-label">ยอดเงินค่าสาขารายเดือนรวม (ชำระแล้ว ${monthlyPaidCount} รายการ)</div>
        <div class="mini-meta">รวมทุกเดือน</div>
        <div class="mini-amount">+${fmt(monthlyIncomeTotal)}</div>
      </div>
      <div style="padding:10px 12px; font-size:0.85rem; color:var(--text-muted); display:flex; justify-content:space-between; align-items:center; background:var(--bg-surface, rgba(255,255,255,0.05)); border-radius:8px; margin-top:8px;">
        <span>💡 ดูรายละเอียดและสถานะการชำระของคุณได้ที่หน้าหลัก</span>
        <a href="./index.html" style="color:var(--primary, #3b82f6); text-decoration:none; font-weight:600;">ไปหน้าหลัก →</a>
      </div>
    `;

    function toggleM() {
      const isOpen = mAccordion.classList.toggle("open");
      mHeader.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }

    mHeader.addEventListener("click", toggleM);
    mHeader.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleM(); }
    });

    mAccordion.appendChild(mHeader);
    mAccordion.appendChild(mBody);
    eventsContainer.appendChild(mAccordion);
  }

  if (events.length === 0 && monthlyIncomeTotal === 0) {
    eventsContainer.innerHTML = `
      <div style="text-align:center;padding:48px 20px;color:var(--text-faint);">
        <div style="font-size:2.8rem;margin-bottom:12px;">🗂️</div>
        <p>ยังไม่มีกิจกรรม</p>
      </div>`;
    return;
  }

  events.forEach((ev) => {
    const balance = (ev.totalIncome || 0) - (ev.totalExpense || 0);
    const txs     = ev.transactions || [];

    const accordion = document.createElement("div");
    accordion.className = "event-accordion";

    // Header
    const header = document.createElement("div");
    header.className = "accordion-header";
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    header.setAttribute("aria-expanded", "false");
    header.innerHTML = `
      <span class="acc-emoji">${ev.emoji || "🎉"}</span>
      <div class="acc-info">
        <div class="acc-name">${escapeHtml(ev.name)}</div>
        <div class="acc-pills">
          <span class="acc-pill acc-pill-income">+${fmtCompact(ev.totalIncome || 0)} ฿</span>
          <span class="acc-pill acc-pill-expense">−${fmtCompact(ev.totalExpense || 0)} ฿</span>
          <span class="acc-pill acc-pill-balance"
                style="${balance < 0 ? "background:var(--danger-soft);color:var(--danger);" : ""}">
            ฿ ${fmtCompact(balance)}
          </span>
        </div>
      </div>
      <span class="acc-chevron">▾</span>
    `;

    // Body with transactions
    const body = document.createElement("div");
    body.className = "accordion-body";

    if (txs.length === 0) {
      body.innerHTML = `<div class="mini-empty">ยังไม่มีรายการ</div>`;
    } else {
      txs.forEach((tx) => {
        const isIncome = tx.type === "income";
        const row = document.createElement("div");
        row.className = `mini-tx ${isIncome ? "mini-income" : "mini-expense"}`;

        const dateStr = tx.createdAt
          ? new Date(tx.createdAt).toLocaleDateString("th-TH", { month: "short", day: "numeric" })
          : "";
        const qtyLabel = tx.quantity > 1 ? ` × ${tx.quantity}` : "";

        const txReceipts = Array.isArray(tx.receipts) && tx.receipts.length > 0
          ? tx.receipts
          : (tx.receiptUrl ? [{ url: tx.receiptUrl }] : []);

        const countLabel = txReceipts.length > 1 ? ` (${txReceipts.length})` : "";
        const receiptBtnHtml = txReceipts.length > 0 ? `
          <button class="mini-receipt-btn" data-view-receipt="${tx.id}" title="ดูใบเสร็จ / หลักฐาน">
            🧾 ใบเสร็จ${countLabel}
          </button>` : "";

        row.innerHTML = `
          <div class="mini-sign">${isIncome ? "+" : "−"}</div>
          <div class="mini-label-wrap">
            <span class="mini-label">${escapeHtml(tx.label)}</span>
            ${receiptBtnHtml}
          </div>
          <div class="mini-meta">${dateStr}${qtyLabel}</div>
          <div class="mini-amount">${isIncome ? "+" : "−"}${fmt(tx.totalAmount)}</div>
        `;

        const receiptBtn = row.querySelector("[data-view-receipt]");
        if (receiptBtn) {
          receiptBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const imgs = txReceipts.map((r, idx) => ({
              url: r.url,
              title: tx.label,
              subtitle: `${dateStr}${qtyLabel}${txReceipts.length > 1 ? ` · รูปที่ ${idx + 1}/${txReceipts.length}` : ""}`
            }));
            openReceiptLightbox(imgs, 0);
          });
        }

        body.appendChild(row);
      });
    }

    // Toggle
    function toggle() {
      const isOpen = accordion.classList.toggle("open");
      header.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }

    header.addEventListener("click", toggle);
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });

    accordion.appendChild(header);
    accordion.appendChild(body);
    eventsContainer.appendChild(accordion);
  });
}

// ── Lightbox / Receipt Viewer ─────────────────────────────────
function openReceiptLightbox(images, startIndex = 0) {
  if (!images || images.length === 0 || !receiptViewerModal) return;
  lbImages = Array.isArray(images) ? images : [{ url: images, title: "ใบเสร็จ", subtitle: "" }];
  lbCurrentIndex = Math.max(0, Math.min(startIndex, lbImages.length - 1));
  lbRotation = 0;
  lbZoom = 1;

  showLightboxImage(lbCurrentIndex);
  openModal(receiptViewerModal);
}

function updateLightboxTransform() {
  if (receiptViewerImg) {
    receiptViewerImg.style.transform = `scale(${lbZoom}) rotate(${lbRotation}deg)`;
  }
}

function showLightboxImage(index) {
  if (index < 0 || index >= lbImages.length) return;
  lbCurrentIndex = index;
  lbRotation = 0;
  lbZoom = 1;
  updateLightboxTransform();

  const imgObj = lbImages[index];
  if (receiptViewerImg) receiptViewerImg.src = imgObj.url;
  if (receiptViewerTitle) receiptViewerTitle.textContent = "🧾 " + (imgObj.title || "ใบเสร็จ");
  if (receiptViewerSub) receiptViewerSub.textContent = imgObj.subtitle || "";
  if (receiptViewerOpenTab) receiptViewerOpenTab.href = imgObj.url;
  if (receiptImgCounter) receiptImgCounter.textContent = `${index + 1} / ${lbImages.length}`;

  // Multi-image controls
  if (lbImages.length > 1) {
    if (lbNavPrev) lbNavPrev.style.display = "flex";
    if (lbNavNext) lbNavNext.style.display = "flex";
    if (lightboxStripContainer) lightboxStripContainer.style.display = "block";
    renderLightboxStrip();
  } else {
    if (lbNavPrev) lbNavPrev.style.display = "none";
    if (lbNavNext) lbNavNext.style.display = "none";
    if (lightboxStripContainer) lightboxStripContainer.style.display = "none";
  }
}

function renderLightboxStrip() {
  if (!lightboxStripThumbs) return;
  lightboxStripThumbs.innerHTML = "";
  lbImages.forEach((imgObj, idx) => {
    const thumb = document.createElement("div");
    thumb.className = `lb-strip-thumb ${idx === lbCurrentIndex ? "active" : ""}`;
    thumb.innerHTML = `<img src="${escapeHtml(imgObj.url)}" alt="thumb">`;
    thumb.addEventListener("click", () => showLightboxImage(idx));
    lightboxStripThumbs.appendChild(thumb);
  });
}

// Rotate & Zoom Controls
if (lbRotateLeft) {
  lbRotateLeft.addEventListener("click", () => {
    lbRotation = (lbRotation - 90) % 360;
    updateLightboxTransform();
  });
}

if (lbRotateRight) {
  lbRotateRight.addEventListener("click", () => {
    lbRotation = (lbRotation + 90) % 360;
    updateLightboxTransform();
  });
}

if (lbZoomIn) {
  lbZoomIn.addEventListener("click", () => {
    lbZoom = Math.min(3.0, Number((lbZoom + 0.25).toFixed(2)));
    updateLightboxTransform();
  });
}

if (lbZoomOut) {
  lbZoomOut.addEventListener("click", () => {
    lbZoom = Math.max(0.5, Number((lbZoom - 0.25).toFixed(2)));
    updateLightboxTransform();
  });
}

if (lbZoomReset) {
  lbZoomReset.addEventListener("click", () => {
    lbZoom = 1;
    lbRotation = 0;
    updateLightboxTransform();
  });
}

if (lbNavPrev) {
  lbNavPrev.addEventListener("click", () => {
    if (lbImages.length <= 1) return;
    const nextIdx = (lbCurrentIndex - 1 + lbImages.length) % lbImages.length;
    showLightboxImage(nextIdx);
  });
}

if (lbNavNext) {
  lbNavNext.addEventListener("click", () => {
    if (lbImages.length <= 1) return;
    const nextIdx = (lbCurrentIndex + 1) % lbImages.length;
    showLightboxImage(nextIdx);
  });
}

if (receiptViewerClose) {
  receiptViewerClose.addEventListener("click", () => closeModal(receiptViewerModal));
}
if (receiptViewerCloseBtn) {
  receiptViewerCloseBtn.addEventListener("click", () => closeModal(receiptViewerModal));
}
if (receiptViewerModal) {
  receiptViewerModal.addEventListener("click", (e) => {
    if (e.target === receiptViewerModal) closeModal(receiptViewerModal);
  });
}

// ── Modal helpers ─────────────────────────────────────────────
function openModal(overlay) {
  if (!overlay) return;
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal(overlay) {
  if (!overlay) return;
  overlay.classList.remove("open");
  document.body.style.overflow = "";
}

document.addEventListener("keydown", (e) => {
  if (receiptViewerModal && receiptViewerModal.classList.contains("open")) {
    if (e.key === "Escape") {
      closeModal(receiptViewerModal);
    } else if (e.key === "ArrowLeft") {
      if (lbImages.length > 1) {
        showLightboxImage((lbCurrentIndex - 1 + lbImages.length) % lbImages.length);
      }
    } else if (e.key === "ArrowRight") {
      if (lbImages.length > 1) {
        showLightboxImage((lbCurrentIndex + 1) % lbImages.length);
      }
    } else if (e.key.toLowerCase() === "r") {
      lbRotation = (lbRotation + 90) % 360;
      updateLightboxTransform();
    } else if (e.key === "+" || e.key === "=") {
      lbZoom = Math.min(3.0, Number((lbZoom + 0.25).toFixed(2)));
      updateLightboxTransform();
    } else if (e.key === "-" || e.key === "_") {
      lbZoom = Math.max(0.5, Number((lbZoom - 0.25).toFixed(2)));
      updateLightboxTransform();
    }
  }
});

// Touch swipe gestures for mobile Lightbox
let lbTouchStartX = 0;
let lbTouchStartY = 0;
const lbCanvas = document.querySelector(".receipt-viewer-canvas");
if (lbCanvas) {
  lbCanvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      lbTouchStartX = e.touches[0].clientX;
      lbTouchStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  lbCanvas.addEventListener("touchend", (e) => {
    if (e.changedTouches.length === 1 && lbImages.length > 1) {
      const diffX = e.changedTouches[0].clientX - lbTouchStartX;
      const diffY = e.changedTouches[0].clientY - lbTouchStartY;
      if (Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY) * 1.4) {
        if (diffX < 0) {
          showLightboxImage((lbCurrentIndex + 1) % lbImages.length);
        } else {
          showLightboxImage((lbCurrentIndex - 1 + lbImages.length) % lbImages.length);
        }
      }
    }
  }, { passive: true });
}

