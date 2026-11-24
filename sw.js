// Offline: responde desde la caché y actualiza en segundo plano. Recordatorios: push desde GitHub Actions.
const CACHE = 'registro-22'; // subirlo en cada versión: así la app avisa «Versión nueva»
const ARCHIVOS = ['./', 'index.html', 'app.js', 'logica.js', 'recordatorio.js', 'manifest.webmanifest', 'icono-180.png', 'icono-512.png'];
importScripts('recordatorio.js');

self.addEventListener('install', (e) => {
  // cache: 'reload' salta la caché HTTP de GitHub Pages (10 min) para no guardar archivos viejos
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: 'reload' })))));
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
    fetch(url.href, { cache: 'no-cache' }).then((r) => { // por URL: un Request 'navigate' no acepta opciones
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }),
  );
  e.waitUntil(nuevo.catch(() => {}));
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((viejo) => viejo || nuevo));
});

// Lee lo anotado en el teléfono (la misma base que usa app.js).
function leerDatos() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open('registro');
    r.onerror = () => mal(r.error);
    r.onsuccess = () => {
      const db = r.result;
      const out = { items: [], ajustes: {} };
      if (!db.objectStoreNames.contains('items')) { db.close(); return ok(out); }
      const stores = ['items', 'ajustes'].filter((s) => db.objectStoreNames.contains(s));
      const t = db.transaction(stores);
      t.objectStore('items').getAll().onsuccess = (ev) => { out.items = ev.target.result; };
      if (stores.includes('ajustes')) t.objectStore('ajustes').get('cfg').onsuccess = (ev) => { out.ajustes = ev.target.result || {}; };
      t.oncomplete = () => { db.close(); ok(out); };
      t.onerror = () => mal(t.error);
    };
  });
}

// iOS exige mostrar una notificación por cada push: si algo falla, igual se muestra una genérica.
self.addEventListener('push', (e) => {
  let tipo = 'almuerzo';
  try { tipo = e.data.json().tipo || tipo; } catch {}
  e.waitUntil(
    leerDatos()
      .then(({ items, ajustes }) => self.textoRecordatorio(tipo, items, ajustes, new Date()))
      .catch(() => ({ titulo: 'Registro', cuerpo: '¿Anotaste lo de hoy?' }))
      .then(({ titulo, cuerpo }) => self.registration.showNotification(titulo, { body: cuerpo, icon: 'icono-180.png', tag: 'recordatorio' })),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((cs) => (cs.length ? cs[0].focus() : self.clients.openWindow('./'))),
  );
});
