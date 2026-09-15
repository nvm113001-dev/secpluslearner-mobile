async function boot() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("SW registration failed", err));
  }

  await DB.init();
  Router.buildTabBar();
  await Router.show("dashboard");

  maybeShowInstallHint();
}

function maybeShowInstallHint() {
  const isStandalone = window.navigator.standalone === true
    || window.matchMedia("(display-mode: standalone)").matches;
  if (isStandalone) return;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!isIOS) return;
  if (localStorage.getItem("installHintDismissed") === "1") return;

  const banner = document.createElement("div");
  banner.className = "install-hint";
  banner.innerHTML = `
    <span>Add this to your Home Screen: tap <strong>Share</strong> → <strong>Add to Home Screen</strong> for the full app experience (works offline).</span>
    <button id="install-hint-close">✕</button>
  `;
  document.body.appendChild(banner);
  banner.querySelector("#install-hint-close").addEventListener("click", () => {
    banner.remove();
    localStorage.setItem("installHintDismissed", "1");
  });
}

boot();
