import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
