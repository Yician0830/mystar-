/* 推し手帳 - 極簡 Service Worker
   只快取 App 外殼（HTML / manifest / icons），讓已開過的頁面在離線或訊號不穩時仍能打開。
   Firebase 等雲端資料仍需要網路，不在快取範圍內。 */
const CACHE_NAME = 'oshi-app-shell-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

/* ================= 推播通知（Firebase Cloud Messaging，背景接收） =================
   用 try/catch 整段包起來：就算這個瀏覽器不支援推播、或 Firebase 訊息模組載入失敗，
   都不能影響到上面「離線快取」這個 Service Worker 原本最重要的工作。 */
try {
  importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js');

  firebase.initializeApp({
    apiKey: "AIzaSyBjclP4efWWcOTO88W_3tlcC4Za_hEIzW0",
    authDomain: "mystarlifeapp.firebaseapp.com",
    projectId: "mystarlifeapp",
    storageBucket: "mystarlifeapp.firebasestorage.app",
    messagingSenderId: "941753508434",
    appId: "1:941753508434:web:5bdf24eac9ee4514d8758b",
    measurementId: "G-FDX9867N4N"
  });

  const messaging = firebase.messaging();

  // App 完全沒開、或分頁在背景時，推播會從這裡進來，負責顯示成手機的系統通知
  messaging.onBackgroundMessage((payload) => {
    const title = (payload.notification && payload.notification.title) || '☀️ 推し手帳 今日提醒';
    const body = (payload.notification && payload.notification.body) || '';
    const url = (payload.data && payload.data.url) || './';
    self.registration.showNotification(title, {
      body,
      icon: './icons/icon-192.png',
      badge: './icons/favicon-32.png',
      data: { url }
    });
  });

  // 點擊通知：如果 App 已經開著就切過去，沒開就開一個新分頁
  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || './';
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
        const existing = clientsArr.find((c) => c.url.includes(self.location.origin));
        if (existing) { existing.focus(); return; }
        return self.clients.openWindow(url);
      })
    );
  });
} catch (e) {
  // 推播初始化失敗（例如瀏覽器不支援），安靜記錄即可，下面的離線快取邏輯不受影響
  console.log('推播通知初始化失敗，離線快取功能不受影響', e);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // 只處理同來源的請求；Firebase / 字型等外部請求直接放行給網路
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
