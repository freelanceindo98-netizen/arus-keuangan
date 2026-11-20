const CACHE_NAME = 'arus-cloud-turnstile-v10-cache2';
const OFFLINE_FILES = ['./','./index.html','./styles.css','./config.js','./app.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install', event => {event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(OFFLINE_FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate', event => {event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch', event => {
 const req=event.request;
 if(req.method!=='GET' || new URL(req.url).origin!==self.location.origin) return;
 if(new URL(req.url).pathname.endsWith('/reset-password.html')) {event.respondWith(fetch(req));return;}
 if(req.mode==='navigate') {event.respondWith(fetch(req).catch(()=>caches.match('./index.html')));return;}
 event.respondWith(fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE_NAME).then(c=>c.put(req,copy));}return res;}).catch(()=>caches.match(req)));
});
