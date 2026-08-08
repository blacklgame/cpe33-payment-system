/* ------------------------------------------------------------
   1) Sync this page to whichever Nu ID logged in (same session
      key the login page + home page use), e.g. "69360303"
------------------------------------------------------------ */
const raw = sessionStorage.getItem("cpe33_user");

if (!raw) {
  // No one is logged in -> send back to the login page
  window.location.href = "../index.html";
} else {
  const user = JSON.parse(raw);

  document.getElementById("userName").textContent = user.name;
  document.getElementById("userEmail").textContent = user.email;

  /* ----------------------------------------------------------
     2) Look up this user's payment record.
     NOTE: There's no real backend yet, so "cpe33_payments" in
     localStorage stands in for a server-side payment table.
     The home page (public/logined/index.js) writes to it when
     a user successfully sends their slip. Swap this lookup for
     a fetch() to your real API once a backend exists.
  ---------------------------------------------------------- */
  const payments = JSON.parse(localStorage.getItem("cpe33_payments") || "{}");
  const record = payments[user.id];
  const isPaid = Boolean(record && record.paid);

  const statusBadge = document.getElementById("statusBadge");

  if (isPaid) {
    statusBadge.textContent = "จ่ายแล้ว";
    statusBadge.className = "status-badge status-paid";
  } else {
    statusBadge.textContent = "ยังไม่จ่าย";
    statusBadge.className = "status-badge status-unpaid";
  }
}

document.getElementById("logoutLink").addEventListener("click", (e) => {
  e.preventDefault();
  sessionStorage.removeItem("cpe33_user");
  window.location.href = "../index.html";
});
