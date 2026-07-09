// Service worker Ohipa — installabilité PWA + coquille hors-ligne.
// Bump la version pour forcer la mise à jour du cache lors d'un déploiement.
const CACHE = 'ohipa-v2';
const SHELL = [
  '/', '/dashboard.html', '/pointage.html', '/planning.html', '/history.html',
  '/reports.html', '/login.html',
  '/css/style.css', '/js/api.js', '/js/nav.js', '/js/splash.js', '/js/admin-nav.js',
  '/logo.png', '/icons/icon-192.png',
  '/fonts/space-grotesk-400.woff2', '/fonts/space-grotesk-500.woff2', '/fonts/space-grotesk-700.woff2',
];

self.addEventListener('install', (e) => {
  // Mise en cache individuelle (allSettled) : une ressource en échec ne vide
  // pas toute la coquille (contrairement à addAll qui est atomique).
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                    // POST/PUT... => réseau (pointage, etc.)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // CDN => réseau
  if (url.pathname.startsWith('/api/')) return;        // API => toujours réseau (données fraîches)

  // Navigations HTML : réseau d'abord (contenu à jour), repli sur le cache hors-ligne.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((resp) => { cachePut(req, resp.clone()); return resp; })
        .catch(() => caches.match(req).then((r) => r || caches.match('/dashboard.html')))
    );
    return;
  }

  // Assets statiques : cache d'abord, sinon réseau (et on met en cache).
  e.respondWith(
    caches.match(req).then((r) => r || fetch(req).then((resp) => { cachePut(req, resp.clone()); return resp; }))
  );
});

function cachePut(req, resp) {
  if (resp && resp.ok && resp.type === 'basic') {
    caches.open(CACHE).then((c) => c.put(req, resp)).catch(() => {});
  }
}
