/* Offline shell + install support for the packing, restaurant, vegetable and indent modules.
   Cache naming is scoped per app: this worker only evicts caches it owns. */
const BUILD_ID="20261031-pwa3",CACHE="pa-core-"+BUILD_ID,CORE=["./","./index.html","manifest.webmanifest","tokens.css?v=20261004-tokens1","components.css?v=20261004-components1","styles.css?v=20261006-deliveryfix2","icons/packing-180.png","config.js?v=20261006-deliveryfix2","app.js?v=20261006-deliveryfix2","update.js?v=20261031-pwa3","pwa-install.js?v=20261031-pwa3","./inventory-count.html","styles.css?v=20261005-restinv1","manifest-restaurant-inventory.webmanifest","icons/restaurant-180.png","config.js?v=20261005-restinv1","inventory-count.js?v=20261005-restinv1","./vegetable-inventory.html","vegetable-inventory.css?v=20261006-deliveryfix2","manifest-vegetable-inventory.webmanifest","icons/vegetable-180.png","vegetable-inventory.js?v=20261006-deliveryfix2","./indent-summary.html","manifest-indent-summary.webmanifest","icons/indent-180.png","./icons/packing-192.png","./icons/packing-512.png","./pwa-install.js?v=20261031-pwa3","./version.json"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil((async()=>{
  if(self.registration.navigationPreload){try{await self.registration.navigationPreload.enable()}catch(_){}}
  const keep=CACHE;
  await Promise.all((await caches.keys()).filter(k=>(k.startsWith("pa-core-")||k.startsWith("packing-assistant-")&&!k.startsWith("packing-assistant-admin-")&&!k.startsWith("packing-assistant-driver-"))&&k!==keep).map(k=>caches.delete(k).catch(()=>false)));
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
