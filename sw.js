// Keeps a copy of the whole app (and the bundled firmware) so it opens and works with no internet after the first
// visit. Bump VERSION when publishing a new version: the old copy is then replaced on the next visit.
const VERSION = 'padbox-web-5';   // also APP_VERSION in js/main.js
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/ui.js', 'js/update.js',
  'js/gp/app.js', 'js/gp/device.js', 'js/gp/model.js',
  'js/phob/app.js', 'js/phob/device.js',
  'assets/logo.png', 'assets/app.png', 'assets/gs_essential_trace.png', 'assets/gs_platform_trace.png',
  'assets/Poppins-Regular.ttf', 'assets/Poppins-SemiBold.ttf',
  'firmware/PadBox GS Essential - HOJA2.uf2', 'firmware/PadBox GS Essential - GP2040-CE.uf2',
  'firmware/PadBox GS Platform - HOJA2.uf2', 'firmware/PadBox GS Platform - GP2040-CE.uf2', 'firmware/PadBox GS Platform - PhobGCC.uf2',
];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// the app's own files: the newest from the site when online (so an update shows up on the next visit), the saved copy
// when offline or when the site doesn't answer within a few seconds
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async c => {
    const net = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
    net.catch(() => { });   // offline: handled below
    const slow = new Promise(res => setTimeout(res, 4000, null));
    try { const r = await Promise.race([net, slow]); if (r && r.ok) return r; } catch (x) { }
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try { return await net; } catch (x) { return new Response('Offline', { status: 503 }); }
  }));
});
