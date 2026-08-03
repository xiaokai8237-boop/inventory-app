// 物流筐收发管理系统 - Service Worker（离线完整可用）
const CACHE = 'kuanwei-v89';
const ASSETS = [
  '/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png',
  // 预缓存 xlsx 库，保证离线时对账/导出可用
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 收到 SKIP_WAITING 消息：立即接管新版本（配合前端"立即更新"）
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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
  if (req.method !== 'GET') return; // 不缓存 POST（OCR/备份等）
  const url = new URL(req.url);

  // 页面导航：网络优先（保证最新），离线时用缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 静态资源：缓存优先，加速加载
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(req, clone));
        return res;
      });
    })
  );
});
