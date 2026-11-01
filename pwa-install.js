/* Install affordance shared by every installable module.
   Android/Chrome: uses the native install prompt when the browser offers it.
   iOS/Safari: no programmatic prompt exists, so a short instruction sheet is shown.
   Never rendered on a sign-in or boot screen, and never while the app already runs installed. */
(() => {
  "use strict";
  if (window.__paInstallLoaded) return;
  window.__paInstallLoaded = true;

  const DISMISS_KEY = "pa_install_hint_v1";   // "Not now" - permanent for this browser
  const SNOOZE_KEY = "pa_install_snooze_v1";  // auto-hidden once - quiet until next session
  const IOS_DELAY_MS = 2500;
  const AUTO_HIDE_MS = 20000;
  const TICK_MS = 1500;

  /* Screens that must never carry the install chip: sign-in cards and boot overlays.
     Anything matched here blocks the chip until it is gone. */
  const GATES = ["#adminAuthOverlay", "#adminBootOverlay", "#driverLogin", "#loginScreen", "#authOverlay"];

  function isStandalone() {
    try {
      if (window.matchMedia) {
        if (matchMedia("(display-mode: standalone)").matches) return true;
        if (matchMedia("(display-mode: fullscreen)").matches) return true;
        if (matchMedia("(display-mode: minimal-ui)").matches) return true;
        if (matchMedia("(display-mode: window-controls-overlay)").matches) return true;
      }
    } catch (_) {}
    return navigator.standalone === true;
  }

  function readFlag(store, key) {
    try {
      const s = window[store];
      return !!s && s.getItem(key) === "1";
    } catch (_) {
      return false;
    }
  }
  function writeFlag(store, key) {
    try {
      const s = window[store];
      if (s) s.setItem(key, "1");
    } catch (_) {}
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.classList && el.classList.contains("hidden")) return false;
    if (typeof el.hasAttribute === "function" && el.hasAttribute("hidden") && el.getAttribute("hidden") !== "false") return false;
    try {
      const st = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (st && (st.display === "none" || st.visibility === "hidden")) return false;
      if (st && st.opacity === "0") return false;
    } catch (_) {}
    return true;
  }

  function gated() {
    for (let i = 0; i < GATES.length; i++) {
      let el = null;
      try { el = document.querySelector(GATES[i]); } catch (_) { el = null; }
      if (el && isVisible(el)) return true;
    }
    return false;
  }

  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isIOSSafari = isIOS && !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo/.test(ua);
  const iosReadyAt = Date.now() + IOS_DELAY_MS;

  let deferredPrompt = null;
  let pill = null;
  let hideTimer = 0;
  let ticker = 0;
  let sheetOpen = false;

  const css = document.createElement("style");
  css.textContent = [
    /* sits above the bottom toast and above fixed action bars, so it never covers them */
    ".paInstallPill{position:fixed;left:calc(12px + env(safe-area-inset-left,0px));bottom:calc(80px + env(safe-area-inset-bottom,0px));z-index:2147482000;display:flex;align-items:center;gap:6px;padding:6px 6px 6px 12px;border-radius:999px;background:#10203a;color:#fff;box-shadow:0 10px 24px rgba(15,23,42,.28);max-width:calc(100vw - 24px);font:600 13px/1.2 system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif}",
    ".paInstallPill .paInstallGo{border:0;background:#fff;color:#10203a;border-radius:999px;padding:8px 13px;font:inherit;font-weight:700;cursor:pointer}",
    ".paInstallPill .paInstallX{border:0;background:transparent;color:#cbd5e1;padding:8px 10px;font:600 16px/1 system-ui,sans-serif;cursor:pointer;border-radius:999px}",
    ".paInstallSheet{position:fixed;inset:0;z-index:2147482100;display:flex;align-items:flex-end;justify-content:center;background:rgba(15,23,42,.45);padding:16px}",
    ".paInstallCard{width:100%;max-width:430px;background:#fff;color:#0f172a;border-radius:18px;padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px));box-shadow:0 -10px 30px rgba(15,23,42,.22);font:14px/1.5 system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif}",
    ".paInstallCard h2{margin:0 0 8px;font-size:16px;font-weight:800}",
    ".paInstallCard ol{margin:0 0 14px;padding-left:20px}",
    ".paInstallCard li{margin:0 0 6px}",
    ".paInstallCard .paInstallClose{width:100%;border:0;border-radius:12px;padding:12px;background:#10203a;color:#fff;font:inherit;font-weight:700;cursor:pointer}",
    ".paInstallCard .paInstallIco{display:inline-block;transform:translateY(2px)}"
  ].join("");
  document.head.appendChild(css);

  function clearPill() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
    if (pill && pill.parentNode) pill.parentNode.removeChild(pill);
    pill = null;
  }

  function showSheet() {
    if (sheetOpen) return;
    sheetOpen = true;
    const wrap = document.createElement("div");
    wrap.className = "paInstallSheet";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-label", "Install this app");
    wrap.innerHTML =
      '<div class="paInstallCard">' +
      "<h2>Install this app</h2>" +
      "<ol>" +
      '<li>Tap the <b>Share</b> button <span class="paInstallIco" aria-hidden="true">&#8679;</span> in Safari.</li>' +
      '<li>Scroll down and tap <b>Add to Home Screen</b>.</li>' +
      '<li>Tap <b>Add</b>. The app then opens full screen like a normal app.</li>' +
      "</ol>" +
      '<button type="button" class="paInstallClose">Got it</button>' +
      "</div>";
    const close = () => {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      document.removeEventListener("keydown", onKey);
      sheetOpen = false;
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    wrap.querySelector(".paInstallClose").addEventListener("click", close);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(wrap);
    wrap.querySelector(".paInstallClose").focus();
  }

  function mount() {
    if (pill || gated() || isStandalone() || readFlag("localStorage", DISMISS_KEY)) return;
    pill = document.createElement("div");
    pill.className = "paInstallPill";
    pill.setAttribute("role", "region");
    pill.setAttribute("aria-label", "Install this app");
    pill.innerHTML =
      '<button type="button" class="paInstallGo">Install app</button>' +
      '<button type="button" class="paInstallX" aria-label="Not now">&#10005;</button>';
    pill.querySelector(".paInstallX").addEventListener("click", () => {
      writeFlag("localStorage", DISMISS_KEY);
      clearPill();
    });
    pill.querySelector(".paInstallGo").addEventListener("click", async () => {
      if (deferredPrompt) {
        const evt = deferredPrompt;
        deferredPrompt = null;
        clearPill();
        try {
          evt.prompt();
          const choice = await evt.userChoice;
          if (choice && choice.outcome === "accepted") writeFlag("localStorage", DISMISS_KEY);
        } catch (_) {
          showSheet();
        }
        return;
      }
      showSheet();
    });
    document.body.appendChild(pill);
    /* Never leave the chip parked on screen: it hides itself once, then stays quiet
       until the next session. Tapping the close button is the permanent opt-out. */
    hideTimer = setTimeout(() => {
      writeFlag("sessionStorage", SNOOZE_KEY);
      clearPill();
    }, AUTO_HIDE_MS);
  }

  /* Re-evaluated on a timer and on every visibility change, so the chip appears only
     after a sign-in or boot overlay is gone and disappears again if one comes back. */
  function refresh() {
    try {
      if (isStandalone() || readFlag("localStorage", DISMISS_KEY)) { clearPill(); return; }
      if (gated()) { clearPill(); return; }
      if (readFlag("sessionStorage", SNOOZE_KEY)) { clearPill(); return; }
      if (pill) return;
      if (deferredPrompt) { mount(); return; }
      if (isIOSSafari && Date.now() >= iosReadyAt) mount();
    } catch (_) {}
  }

  function startTicker() {
    if (ticker) return;
    ticker = setInterval(() => {
      if (document.hidden) return;
      refresh();
    }, TICK_MS);
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    refresh();
  });

  window.addEventListener("appinstalled", () => {
    writeFlag("localStorage", DISMISS_KEY);
    clearPill();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });

  if (!isStandalone() && !readFlag("localStorage", DISMISS_KEY)) {
    if (isIOSSafari) setTimeout(refresh, IOS_DELAY_MS);
    startTicker();
    setTimeout(refresh, 0);
  }
})();
