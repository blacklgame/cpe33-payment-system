/* ------------------------------------------------------------
   1) Sync this page to whichever Nu ID logged in (same session
      key the login page + home page use), e.g. "69360303"
------------------------------------------------------------ */
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from "../firebase.js";

const raw = sessionStorage.getItem("cpe33_user");

if (!raw) {
  // No one is logged in -> send back to the login page
  window.location.href = "../index.html";
} else {
  const user = JSON.parse(raw);

  document.getElementById("userName").textContent = user.name;
  document.getElementById("userEmail").textContent = user.email;

  /* ----------------------------------------------------------
     2) Look up this user's payment record in Firestore.
     The home page (public/logined/index.js) writes this doc,
     at payments/{nuid}, when a user successfully uploads their
     slip to Storage.
  ---------------------------------------------------------- */
  const statusBadge = document.getElementById("statusBadge");
  const slipLink = document.getElementById("slipLink");

  getDoc(doc(db, "payments", user.id))
    .then((paymentSnap) => {
      const isPaid = Boolean(paymentSnap.exists() && paymentSnap.data().paid);

      if (isPaid) {
        statusBadge.textContent = "จ่ายแล้ว";
        statusBadge.className = "status-badge status-paid";

        const slipUrl = paymentSnap.data().slipUrl;
        if (slipUrl) {
          slipLink.href = slipUrl;
          slipLink.textContent = "ดูสลิปที่อัปโหลด";
          slipLink.classList.add("show");
        }
      } else {
        statusBadge.textContent = "ยังไม่จ่าย";
        statusBadge.className = "status-badge status-unpaid";
      }
    })
    .catch((err) => {
      console.error("Failed to load payment status:", err);
      statusBadge.textContent = "โหลดข้อมูลไม่สำเร็จ";
      statusBadge.className = "status-badge status-unpaid";
    });
}

document.getElementById("logoutLink").addEventListener("click", (e) => {
  e.preventDefault();
  sessionStorage.removeItem("cpe33_user");
  window.location.href = "../index.html";
});
