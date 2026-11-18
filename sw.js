const CACHE = 'scriptpress-v1';
const ASSETS = ['./', 'index.html', 'help.html', 'privacy.html', 'style.css', 'script-core.js', 'app.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'mono-Regular.woff2', 'mono-Bold.woff2', 'mono-pdf.ttf', 'mono-pdf-bold.ttf', 'OFL-LiberationMono.txt'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('scriptpress')).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
