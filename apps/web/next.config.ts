import type { NextConfig } from "next";

const gelistirme = process.env.NODE_ENV === "development";

/**
 * SEC-15: sayfaların CSP'si istek başına nonce gerektirdiği için `src/middleware.ts`
 * içindedir. Entegratörden gelen belge görünümü bu yalıtılmış çerçevede çalışır. Görünüm
 * karekodu satır içi betikle çizdiği için `'unsafe-inline'` yalnız burada kalır;
 * `sandbox` sayesinde sayfa ayrı kökendedir, oturuma ve API'ye erişemez.
 */
const BELGE_CERCEVESI_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob: https:",
  "font-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  "sandbox allow-scripts",
].join("; ");

const GUVENLIK_BASLIKLARI = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ...(gelistirme ? [] : [{ key: "Strict-Transport-Security", value: "max-age=15552000" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: GUVENLIK_BASLIKLARI },
      { source: "/belge-cerceve.html", headers: [{ key: "Content-Security-Policy", value: BELGE_CERCEVESI_CSP }] },
    ];
  },
  output: "standalone",
  // SEC-04: uygulama next/image kullanmıyor; /_next/image ucu (sharp/libvips ve
  // geçmişteki RCE/SSRF açıkları) kapalı tutulur.
  images: { unoptimized: true },
  // Geliştirme ve üretim aynı klasörü kullanırsa eşzamanlı `next dev` / `next build`
  // işlemleri manifestleri silip 500 hatasına yol açabiliyor.
  distDir: process.env.NEXT_DIST_DIR ?? (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${(process.env.API_PROXY_URL ?? "http://127.0.0.1:3001").replace(/\/+$/, "")}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
