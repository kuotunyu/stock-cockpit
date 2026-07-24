// Stock1 Service Worker：app shell network-first、/api 永遠走網路。
// 我們的更新方式是「整包複製 code」——network-first 保證重整一次就是新版，
// 不會發生朋友被 cache-first 卡在舊版的災難。快取只在離線/伺服器沒開時當備援。
const CACHE_PREFIX = "stock1-shell-";
const CACHE_NAME = "stock1-shell-v5";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./lucide.min.js",
  "./manifest.json",
  "./icon.svg",
  "./fonts/IBMPlexMono-Medium-Latin1.woff2",
  "./fonts/IBMPlexMono-SemiBold-Latin1.woff2",
  "./fonts/IBMPlexMono-Bold-Latin1.woff2",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // addAll 必須整包成功才啟用新版；失敗時保留上一版 worker，避免半套 shell。
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // API 一律即時：行情資料快取了只會誤導。非 GET（登入等）也不碰。
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        if (response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          await caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        // 允許離線開啟帶 query 的首頁（例如安裝捷徑／除錯旗標），資產版本 query 亦可命中 shell。
        const cached = await caches.match(event.request, { ignoreSearch: true });
        if (cached) return cached;
        if (event.request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      })
  );
});
