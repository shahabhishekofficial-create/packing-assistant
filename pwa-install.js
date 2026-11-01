/* Install affordance shared by every installable module.
   Android/Chrome: uses the native install prompt when the browser offers it.
   iOS/Safari: no programmatic prompt exists, so a short instruction sheet is shown.
   Hidden automatically when the page is already running as an installed app. */
(() => {
  "use strict";
  if (window.__paInstallLoaded) return;
  window.__paInstallLoaded = true;

  const DISMISS_KEY = "pa_install_hint_v1";

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

  function dismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch (_) { return false; }
  }
  function rememberDismissed() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch (_) {}
  }

  if (isStandalone() || dismissed()) return;

  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isIOSSafari = isIOS && !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo/.test(ua);

  let deferredPrompt = null;
  let pill = null;
  let hideTimer = 0;

  const css = document.createElement("style");
  css.textContent = [
    ".paInstallPill{position:fixed;left:calc(12px + env(safe-area-inset-left,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:2147482000;display:flex;align-items:center;gap:6px;padding:6px 6px 6px 12px;border-radius:999px;background:#10203a;color:#fff;box-shadow:0 10px 24px rgba(15,23,42,.28);max-width:calc(100vw - 24px);font:600 13px/1.2 system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif}",
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
    if (document.querySelector(".paInstallSheet")) return;
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
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    wrap.querySelector(".paInstallClose").addEventListener("click", close);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(wrap);
    wrap.querySelector(".paInstallClose").focus();
  }

  function mount() {
    if (pill || isStandalone() || dismissed()) return;
    pill = document.createElement("div");
    pill.className = "paInstallPill";
    pill.innerHTML =
      '<button type="button" class="paInstallGo">Install app</button>' +
      '<button type="button" class="paInstallX" aria-label="Not now">&#10005;</button>';
    pill.querySelector(".paInstallX").addEventListener("click", () => {
      rememberDismissed();
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
          if (choice && choice.outcome === "accepted") rememberDismissed();
        } catch (_) {
          showSheet();
        }
        return;
      }
      showSheet();
    });
    document.body.appendChild(pill);
    hideTimer = setTimeout(clearPill, 15000);
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    mount();
  });

  window.addEventListener("appinstalled", () => {
    rememberDismissed();
    clearPill();
  });

  if (isIOSSafari) {
    const start = () => setTimeout(mount, 2500);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
})();
