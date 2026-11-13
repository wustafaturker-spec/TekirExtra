/*
 * SAH-01/02: saha ekranlarının servis işçisi. Kapsamı yalnız /saha sayfaları ve derlenmiş durağan
 * dosyalardır; API yanıtları ve kişisel veri önbelleğe alınmaz (çevrimdışı veri IndexedDB'de,
 * kullanıcıya bağlı tutulur). Sayfalar ağdan, ağ yoksa son kopyadan; durağan dosyalar önbellekten.
 */
const SURUM = "saha-v2";
const SAYFALAR = ["/saha", "/saha/sayim", "/saha/masraf"];

// Kurulum saha sayfasından, oturum açıkken olur; ilk açılan sayfa işçi devreye girmeden yüklendiği
// için sayfalar burada indirilir. Giriş sayfasına yönlendirilen yanıt saklanmaz.
self.addEventListener("install", (olay) => {
  olay.waitUntil(caches.open(SURUM).then((c) => Promise.all(SAYFALAR.map((s) =>
    fetch(s, { credentials: "same-origin" }).then((y) => (y.ok && !y.redirected ? c.put(s, y) : undefined)).catch(() => undefined),
  ))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (olay) => {
  olay.waitUntil(caches.keys().then((adlar) => Promise.all(adlar.filter((a) => a !== SURUM).map((a) => caches.delete(a)))).then(() => self.clients.claim()));
});

self.addEventListener("message", (olay) => {
  // SAH-09: çıkışta önbellek temizlenir.
  if (olay.data === "temizle") olay.waitUntil(caches.delete(SURUM));
});

self.addEventListener("fetch", (olay) => {
  const istek = olay.request;
  if (istek.method !== "GET") return;
  const url = new URL(istek.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    olay.respondWith(caches.open(SURUM).then(async (c) => {
      const kayitli = await c.match(istek);
      if (kayitli) return kayitli;
      const yanit = await fetch(istek);
      if (yanit.ok) c.put(istek, yanit.clone());
      return yanit;
    }));
    return;
  }
  if (istek.mode === "navigate" && url.pathname.startsWith("/saha")) {
    olay.respondWith(fetch(istek).then((yanit) => {
      // Giriş sayfasına yönlendirme önbelleğe yazılmaz.
      if (yanit.ok && !yanit.redirected) caches.open(SURUM).then((c) => c.put(url.pathname, yanit.clone()));
      return yanit;
    }).catch(async () => (await caches.match(url.pathname)) || (await caches.match("/saha")) || Response.error()));
  }
});
