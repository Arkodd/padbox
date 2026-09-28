// Keeps a copy of the whole app (and the bundled firmware) so it opens and works with no internet after the first
// visit. Bump VERSION when publishing a new version: the old copy is then replaced on the next visit.
const VERSION = 'padbox-web-4';
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
// the app's own files: the saved copy first (works offline), refreshed in the background when online
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || new Response('Offline', { status: 503 });
  }));
});
