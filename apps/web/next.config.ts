import type { NextConfig } from "next";

const gelistirme = process.env.NODE_ENV === "development";

/**
 * SEC-10: web güvenlik başlıkları. Next'in satır içi önyükleme betikleri, tema
 * betiği ve e-Belge görünümlerinin (srcDoc iframe ebeveynin CSP'sini devralır)
 * karekod betikleri için `'unsafe-inline'` gerekir; yine de dış betik yükleme,
 * dışarıya veri gönderme (connect-src), eklenti, <base> değiştirme, dışarıya
 * form gönderme ve başka sitenin paneli çerçevelemesi kapanır. Gelen e-postadaki
 * uzak görseller için img-src https açıktır.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${gelistirme ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${gelistirme ? " ws: wss:" : ""}`,
  "frame-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const GUVENLIK_BASLIKLARI = [
  { key: "Content-Security-Policy", value: CSP },
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
    return [{ source: "/:path*", headers: GUVENLIK_BASLIKLARI }];
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
