document.addEventListener("DOMContentLoaded", () => {
  const toggleBtn = document.getElementById("navToggle");
  const navLinks = document.querySelector(".nav-links");

  if (toggleBtn && navLinks) {
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navLinks.classList.toggle("open");
    });

    document.addEventListener("click", (e) => {
      if (!navLinks.contains(e.target) && !toggleBtn.contains(e.target)) {
        navLinks.classList.remove("open");
      }
    });
  }
});
