import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Geliştirme ve üretim aynı klasörü kullanırsa eşzamanlı `next dev` / `next build`
  // işlemleri manifestleri silip 500 hatasına yol açabiliyor.
  distDir: process.env.NEXT_DIST_DIR ?? (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: "http://127.0.0.1:3001/api/v1/:path*",
      },
    ];
  },
};

export default nextConfig;
