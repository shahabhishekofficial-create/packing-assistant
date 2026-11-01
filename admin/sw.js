/* Offline shell + install support for the operations admin, expenses and ledgers modules.
   Cache naming is scoped per app: this worker only evicts caches it owns. */
const BUILD_ID="20261031-pwa5",CACHE="pa-admin-"+BUILD_ID,CORE=["./","./index.html","manifest.json","../icons/admin-180.png","../tokens.css?v=20261004-tokens1","../components.css?v=20261004-components1","../styles.css?v=20261011-outletlatlong7","../mobile.css?v=20261031-pwa8","../ui.css?v=20261031-pwa8","../config.js?v=20261001-audit2","./auth.js?v=20261001-audit2","../app.js?v=20261011-outletlatlong6","./team.js?v=20261002-staffid3","./inventory-nav.js?v=20261001-audit2","../update.js?v=20261031-pwa8","../pwa-install.js?v=20261031-pwa8","./expenses.html","./expenses.css?v=20261014-expenses1","./expenses-list.css?v=20261015-slice2a3","./expenses-export.css?v=20261019-export1","manifest-expenses.webmanifest","../icons/expenses-180.png","../config.js?v=20261014-expenses1","./auth.js?v=20261014-expenses1","./expenses.js?v=20261014-expenses1","./expenses-list.js?v=20261023-expense-list-delete1","./expenses-export.js?v=20261019-export3","./payments.html","./payments.css?v=20261021-payments4","manifest-payments.webmanifest","../icons/ledgers-180.png","./payments.js?v=20261021-payments5","./inventory.html","../styles.css?v=20261007-scroll1","./inventory.css?v=20261001-audit2","./inventory.js?v=20261031-pwa8","./vegetable-inventory.html","./vegetable-inventory.css?v=20261001-audit2","./vegetable-inventory.js?v=20261006-vegadmin2","../icons/admin-192.png","../icons/admin-512.png","../version.json"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil((async()=>{
  if(self.registration.navigationPreload){try{await self.registration.navigationPreload.enable()}catch(_){}}
  const keep=CACHE;
  await Promise.all((await caches.keys()).filter(k=>(k.startsWith("pa-admin-")||k.startsWith("packing-assistant-admin-"))&&k!==keep).map(k=>caches.delete(k).catch(()=>false)));
  await self.clients.claim();
})())});
async function nf(r,e){
  try{
    const p=e&&e.preloadResponse?await e.preloadResponse.catch(()=>null):null;
    const x=p||await fetch(r);
    if(x&&x.ok){const copy=x.clone();await (await caches.open(CACHE)).put(r,copy)}
    return x;
  }catch(_){return (await caches.match(r))||new Response("Offline",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}})}
}
self.addEventListener("fetch",e=>{
  const r=e.request;
  if(r.method!=="GET")return;
  const u=new URL(r.url);
  if(u.origin!==location.origin)return;
  if(r.mode==="navigate"||u.pathname.endsWith("/version.json")){e.respondWith(nf(r,e));return}
  e.respondWith(fetch(r).then(x=>{if(x&&x.ok){const copy=x.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(r,copy)).catch(()=>{}))}return x}).catch(()=>caches.match(r)));
});
