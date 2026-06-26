(function () {
  const portalUrl = "https://tsy3991.github.io/TSY.Microglow-Website/";

  document.querySelectorAll("[data-portal-return]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.assign(link.getAttribute("href") || portalUrl);
    });
  });
})();
