(()=>{"use strict";
const BUILD_ID="20260924-6", VERSION_URL=window.PA_VERSION_URL||"version.json", GUARD="pa_update_reload_guard";
let checking=false;
function overlay(){let e=document.getElementById("paUpdatingOverlay");if(!e){e=document.createElement("div");e.id="paUpdatingOverlay";e.style.cssText="position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#fff;color:#10203a;font:700 18px system-ui";e.textContent="Updating…";document.documentElement.appendChild(e)}}
async function check(){if(checking||document.visibilityState==="hidden")return;checking=true;try{const u=new URL(VERSION_URL,document.baseURI);u.searchParams.set("_",Date.now());const r=await fetch(u,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});if(!r.ok)throw Error("version check failed");const v=await r.json(),remote=String(v?.build_id||"");if(!remote||remote===BUILD_ID||sessionStorage.getItem(GUARD)===remote)return;sessionStorage.setItem(GUARD,remote);overlay();if("serviceWorker"in navigator)await Promise.all((await navigator.serviceWorker.getRegistrations()).map(x=>x.update().catch(()=>{})));setTimeout(()=>location.reload(),250)}catch(e){console.warn("Version check:",e)}finally{checking=false}}
async function repair(){overlay();try{if("serviceWorker"in navigator)await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r=>r.unregister().catch(()=>false)));if("caches"in window)await Promise.all((await caches.keys()).map(k=>caches.delete(k)))}finally{location.reload()}}
window.PA_REPAIR_APP=repair;
async function bootRecovery(){
  if(!/\/admin\/?$/.test(location.pathname))return;
  if(new URLSearchParams(location.search).has("emergency"))return;
  const overlay=document.getElementById("adminBootOverlay");
  if(!overlay)return;
  const recovered=sessionStorage.getItem("pa_boot_recovered")==="1";
  if(recovered){
    const sub=overlay.querySelector(".bootSub");
    if(sub)sub.textContent="Startup failed. Use the recovery button below.";
    const btn=document.createElement("button");
    btn.textContent="Repair & Reload";btn.style.cssText="display:block;margin:16px auto 0;padding:11px 16px;border:0;border-radius:10px;background:#0f766e;color:#fff;font-weight:800";
    btn.onclick=repair;overlay.querySelector(".bootCard")?.appendChild(btn);
    return;
  }
  sessionStorage.setItem("pa_boot_recovered","1");
  const sub=overlay.querySelector(".bootSub");
  if(sub)sub.textContent="Recovering app cache…";
  await repair();
}
setTimeout(()=>{if(document.getElementById("adminBootOverlay"))void bootRecovery();else sessionStorage.removeItem("pa_boot_recovered")},18000);
function boot(){const b=document.createElement("button");b.textContent="Repair app";b.hidden=true;b.style.cssText="position:fixed;right:14px;bottom:14px;z-index:2147483646;padding:10px 14px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#10203a;font:700 13px system-ui";b.onclick=repair;document.body.appendChild(b);document.addEventListener("keydown",e=>{if(e.altKey&&e.shiftKey&&e.key.toLowerCase()==="r"){b.hidden=false;clearTimeout(b._t);b._t=setTimeout(()=>b.hidden=true,15000)}});check();document.addEventListener("visibilitychange",()=>document.visibilityState==="visible"&&check());window.addEventListener("focus",check);setInterval(check,300000)}
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",boot,{once:true}):boot();
})();