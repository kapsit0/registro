// Offline: responde desde la caché y actualiza en segundo plano (la versión nueva aparece al abrir la próxima vez).
const CACHE = 'registro-1';
const ARCHIVOS = ['./', 'index.html', 'app.js', 'logica.js', 'manifest.webmanifest', 'icono-180.png', 'icono-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // OpenRouter va directo
  const nuevo = caches.open(CACHE).then((c) =>
    fetch(e.request).then((r) => {
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }),
  );
  e.waitUntil(nuevo.catch(() => {}));
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((viejo) => viejo || nuevo));
});
