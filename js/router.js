const SCREENS = {
  dashboard: { module: () => Dashboard, label: "Dashboard", icon: "\u{1F3E0}" },
  learn: { module: () => Learn, label: "Learn", icon: "\u{1F4DA}" },
  bank: { module: () => Bank, label: "Bank", icon: "\u{1F4C7}" },
  stats: { module: () => Stats, label: "Stats", icon: "\u{1F4CA}" },
  test: { module: () => TestMode, label: "Test", icon: "⏱️" },
};

let _current = null;
let _pendingLearnMode = null; // set by Dashboard "Quick Start" buttons

function setLearnStartMode(mode) {
  _pendingLearnMode = mode;
}
function consumeLearnStartMode() {
  const m = _pendingLearnMode;
  _pendingLearnMode = null;
  return m;
}

async function show(name) {
  _current = name;
  const container = document.getElementById("screen-container");
  container.innerHTML = "";
  document.querySelectorAll("#tab-bar button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.screen === name);
  });
  const mod = SCREENS[name].module();
  await mod.render(container);
}

function buildTabBar() {
  const nav = document.getElementById("tab-bar");
  nav.innerHTML = "";
  for (const [key, def] of Object.entries(SCREENS)) {
    const btn = document.createElement("button");
    btn.dataset.screen = key;
    btn.innerHTML = `<span class="tab-icon">${def.icon}</span><span class="tab-label">${def.label}</span>`;
    btn.addEventListener("click", () => show(key));
    nav.appendChild(btn);
  }
}

window.Router = { show, buildTabBar, setLearnStartMode, consumeLearnStartMode, get current() { return _current; } };
