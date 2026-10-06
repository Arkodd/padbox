// Keeps a copy of the whole app (and the bundled firmware) so it opens and works with no internet after the first
// visit. Bump VERSION when publishing a new version: the old copy is then replaced on the next visit.
// The files are the published site's (tools/build-gs.js): the calibrator in the new design at the root, using the
// device and model modules in js/.
const VERSION = 'padbox-web-17';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'v2.css',
  'main.js', 'gp-app.js', 'hoja-app.js', 'phob-app.js', 'drawing.js', 'icons.js', 'ref-icons.js', 'parts.js', 'gs-essential-shapes.js',
  'js/ui.js', 'js/update.js', 'js/legacy-update.js', 'js/gp/device.js', 'js/gp/model.js', 'js/hoja/device.js', 'js/hoja/model.js', 'js/phob/device.js',
  'assets/logo.png', 'assets/app.png', 'fonts/Poppins-Regular.ttf', 'fonts/Poppins-SemiBold.ttf', 'fonts/Xirod.otf',
  'firmware/versions.json', 'firmware/PadBox GS Essential - HOJA2.uf2', 'firmware/PadBox GS Essential - GP2040-CE.uf2',
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
