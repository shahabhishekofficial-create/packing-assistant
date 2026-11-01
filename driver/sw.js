/* Offline shell + install support for the driver module.
   Cache naming is scoped per app: this worker only evicts caches it owns. */
const BUILD_ID="20261031-pwa5",CACHE="pa-driver-"+BUILD_ID,CORE=["./","./index.html","../icons/driver-180.png","manifest.webmanifest","../tokens.css?v=20261004-tokens1","../components.css?v=20261004-components1","../styles.css?v=20261011-outletlatlong1","../mobile.css?v=20261031-pwa8","../ui.css?v=20261031-pwa8","../config.js?v=20261011-outletlatlong1","driver.js?v=20261011-outletlatlong1","../update.js?v=20261031-pwa8","./driver-ux-v2.css?v=20261011-outletlatlong1","./driver-ux-v2.js?v=20261011-outletlatlong1","../pwa-install.js?v=20261031-pwa8","../icons/driver-192.png","../icons/driver-512.png","../version.json"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil((async()=>{
  if(self.registration.navigationPreload){try{await self.registration.navigationPreload.enable()}catch(_){}}
  const keep=CACHE;
  await Promise.all((await caches.keys()).filter(k=>(k.startsWith("pa-driver-")||k.startsWith("packing-assistant-driver-"))&&k!==keep).map(k=>caches.delete(k).catch(()=>false)));
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
