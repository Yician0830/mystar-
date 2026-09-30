// 旅遊紀錄 service worker
// 只快取「頁面外殼」（HTML、圖示、Firebase SDK、字型），讓離線也能開啟。
// 旅程資料本身由 Firestore 離線快取負責；Firestore 與登入的請求不經過這裡。
var CACHE = 'travel-archive-v1';   // 改版時把 v1 改成 v2，舊快取會在啟用時清掉

var CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];
var EXTERNAL = [
  'https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js',
  'https://fonts.googleapis.com/css2?family=Archivo+Black&family=Noto+Sans+TC:wght@500;700;900&display=swap'
];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){
    return c.addAll(CORE).then(function(){
      // 外部資源用 no-cors 各自快取，任何一個失敗都不影響安裝
      return Promise.all(EXTERNAL.map(function(u){
        return fetch(new Request(u, { mode: 'no-cors' })).then(function(r){ return c.put(u, r); }).catch(function(){});
      }));
    });
  }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf('travel-archive-') === 0 && k !== CACHE; })
      .map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

function store(req, res){
  if(res && (res.ok || res.type === 'opaque')){
    var copy = res.clone();
    caches.open(CACHE).then(function(c){ c.put(req, copy); });
  }
  return res;
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;
  var url = new URL(req.url);

  // 同網域（頁面本身）：先連網取最新版，失敗（離線）才用快取
  if(url.origin === self.location.origin){
    e.respondWith(
      fetch(req).then(function(res){ return store(req, res); })
        .catch(function(){
          return caches.match(req, { ignoreSearch: true }).then(function(hit){
            return hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error());
          });
        })
    );
    return;
  }

  // Firebase SDK 與字型檔（版本固定，內容不會變）：優先用快取
  if(url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0 || url.hostname === 'fonts.gstatic.com'){
    e.respondWith(caches.match(req).then(function(hit){
      return hit || fetch(req).then(function(res){ return store(req, res); });
    }));
    return;
  }

  // 字型樣式表：先給快取、背景更新
  if(url.hostname === 'fonts.googleapis.com'){
    e.respondWith(caches.match(req).then(function(hit){
      var net = fetch(req).then(function(res){ return store(req, res); }).catch(function(){ return hit; });
      return hit || net;
    }));
    return;
  }
  // 其他（Firestore、登入…）一律不攔截，交給瀏覽器
});
