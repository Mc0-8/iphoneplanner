// Service worker: makes the app work offline.
// Files are served from the cache straight away. When a new version is pushed to GitHub,
// the app downloads it in the background and offers "Update" (also Settings → Check for updates).
// Bump CACHE when the list of files changes.

const CACHE = 'planner-v6';
const FILES = [
  './',
  'index.html',
  'manifest.json',
  'css/app.css',
  'fonts/bricolage-grotesque.woff2',
  'fonts/plex-sans-400.woff2',
  'fonts/plex-sans-500.woff2',
  'fonts/plex-sans-600.woff2',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js',
  'js/block-ui.js',
  'js/scheduler.js',
  'js/db.js',
  'js/drag.js',
  'js/dates.js',
  'js/icons.js',
  'js/store.js',
  'js/task-ui.js',
  'js/theme.js',
  'js/ui.js',
  'js/screens/day-view.js',
  'js/screens/focus.js',
  'js/screens/habits.js',
  'js/screens/notes.js',
  'js/screens/review.js',
  'js/screens/search.js',
  'js/screens/stats.js',
  'js/screens/lists.js',
  'js/screens/schedule.js',
  'js/screens/study.js',
  'js/screens/week.js',
  'js/screens/settings.js',
  'js/screens/tasks.js',
  'js/screens/today.js',
];

// Fetch fresh copies (skip the browser's HTTP cache) so a new version is complete and current.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

// The page asks the new version to take over when the user taps "Update".
self.addEventListener('message', (event) => {
  if (event.data === 'activate-update') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req, { cache: 'no-cache' })
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
