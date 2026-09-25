(()=>{"use strict";
const BUILD_ID="20260925-11",VERSION_URL=window.PA_VERSION_URL||"version.json";
let checking=false,pendingBuild="";
function removeNotice(){document.getElementById("paUpdateNotice")?.remove()}
function showNotice(remote){
  pendingBuild=remote;
  let e=document.getElementById("paUpdateNotice");
  if(e)return;
  e=document.createElement("div");e.id="paUpdateNotice";
  e.style.cssText="position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483646;display:flex;align-items:center;gap:10px;justify-content:space-between;padding:12px 14px;border:1px solid #cbd5e1;border-radius:14px;background:#fff;color:#10203a;box-shadow:0 12px 35px rgba(15,23,42,.18);font:600 14px system-ui,-apple-system,sans-serif";
  e.innerHTML='<span>New app update available. Your current work will not be interrupted.</span><span style="display:flex;gap:8px;flex-shrink:0"><button id="paUpdateLater" type="button" style="padding:8px 11px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#334155;font-weight:700">Later</button><button id="paUpdateNow" type="button" style="padding:8px 11px;border:0;border-radius:9px;background:#0f766e;color:#fff;font-weight:800">Update</button></span>';
  document.body.appendChild(e);
  e.querySelector("#paUpdateLater").onclick=removeNotice;
  e.querySelector("#paUpdateNow").onclick=applyUpdate;
}
async function check(){
  if(checking||document.visibilityState==="hidden")return;
  checking=true;
  try{
    const u=new URL(VERSION_URL,document.baseURI);u.searchParams.set("_",Date.now());
    const r=await fetch(u,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});
    if(!r.ok)throw Error("version check failed");
    const remote=String((await r.json())?.build_id||"");
    if(!remote||remote===BUILD_ID)return;
    showNotice(remote);
  }catch(e){console.warn("Version check:",e)}
  finally{checking=false}
}
async function applyUpdate(){
  const b=document.getElementById("paUpdateNow");
  if(b){b.disabled=true;b.textContent="Updating…"}
  try{
    if("serviceWorker"in navigator)await Promise.all((await navigator.serviceWorker.getRegistrations()).map(x=>x.update().catch(()=>{})));
  }finally{
    sessionStorage.setItem("pa_last_update",pendingBuild||"");
    location.reload();
  }
}
async function repair(){
  if(!confirm("Repair app cache only? Your login, localStorage and IndexedDB data will NOT be deleted."))return;
  if("serviceWorker"in navigator)await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r=>r.unregister().catch(()=>false)));
  if("caches"in window)await Promise.all((await caches.keys()).map(k=>caches.delete(k)));
  location.reload();
}
window.PA_REPAIR_APP=repair;
let updateBooted=false;
async function boot(){
  if(updateBooted)return;
  try{await (window.PA_CONFIG_READY||Promise.resolve());}catch{}
  if(window.PA_CONFIG_ENABLED&&!window.PA_CONFIG_ENABLED("system.update_notifications"))return;
  updateBooted=true;
  const b=document.createElement("button");b.textContent="Repair app";b.hidden=true;
  b.style.cssText="position:fixed;right:14px;bottom:14px;z-index:2147483646;padding:10px 14px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#10203a;font:700 13px system-ui";
  b.onclick=repair;document.body.appendChild(b);
  document.addEventListener("keydown",e=>{if(e.altKey&&e.shiftKey&&e.key.toLowerCase()==="r"){b.hidden=false;clearTimeout(b._t);b._t=setTimeout(()=>b.hidden=true,15000)}});
  check();document.addEventListener("visibilitychange",()=>document.visibilityState==="visible"&&check());
  window.addEventListener("focus",check);setInterval(check,300000);
}
window.addEventListener("pa-config-loaded",()=>boot());
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",boot,{once:true}):boot();
})();