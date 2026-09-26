const BUILD_ID="20260926-22",CACHE="packing-assistant-admin-"+BUILD_ID;
self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));
self.addEventListener("activate",e=>e.waitUntil((async()=>{
  await Promise.all((await caches.keys()).filter(k=>k.startsWith("packing-assistant-admin-")).map(k=>caches.delete(k).catch(()=>false)));
  await self.clients.claim();
})()));
self.addEventListener("fetch",e=>{
  const r=e.request;
  if(r.method!=="GET")return;
  const u=new URL(r.url);
  if(u.origin!==location.origin)return;
  e.respondWith(fetch(r,{cache:"no-store"}).catch(()=>caches.match(r)));
});