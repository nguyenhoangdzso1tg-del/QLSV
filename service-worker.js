/* Service Worker – Quản lí vi phạm (PWA): cache trang để mở nhanh + chạy khi không có mạng */
const CACHE = "quan-li-vi-pham-v25";

const ASSETS = [
  "./",
  "./index.html",
  "./login.html",
  "./login.css",
  "./style.css",
  "./theme.css",
  "./theme-init.js",
  "./app-auth.js",
  "./auth.js",
  "./student-data.js",
  "./profile.html",
  "./profile.js",
  "./admin.html",
  "./admin.js",
  "./danhsach.html",
  "./calendar.html",
  "./quanly-sv.html",
  "./diemdanh.html",
  "./danhsach-diemdanh.html",
  "./gan-coso.html",
  "./upload-students.html",
  "./xoa-students.html",
  "./firebase.js",
  "./sendfirebase.js",
  "./list.js",
  "./diemdanh.js",
  "./diemdanh-ai.js",
  "./diemdanh-chat.js",
  "./diemdanh-list.js",
  "./script.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  // Trang HTML: ưu tiên mạng (luôn có dữ liệu mới), nếu mất mạng mới lấy cache
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Assert khác (CSS/JS/icon): cache trước – mạng sau
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      });
    })
  );
});