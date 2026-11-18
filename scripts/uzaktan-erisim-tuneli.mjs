#!/usr/bin/env node

/**
 * TekirExtra Uzaktan Erişim Tüneli
 * 
 * Port 3100 üzerindeki TekirExtra uygulamasını (Next.js ve /platform modülü dahil)
 * Cloudflare Tunnel üzerinden güvenli ve dışarıdan erişilebilir hale getirir.
 * 
 * Next.js iç yönlendirmelerinde (307 redirect) oluşan localhost adreslerini
 * otomatik olarak göreli yola dönüştürür; böylece /platform, /panel vb.
 * modüller dış ağdan kesintisiz çalışır.
 */

import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const HEDEF_HOST = "127.0.0.1";
const HEDEF_PORT = 3100;
const PROXY_PORT = 3105;
const TUNEL_DOSYASI = path.resolve(process.cwd(), ".tunel-adresi.txt");

// 1. Ters Proxy Sunucusu (Redirect ve WebSocket köprüsü)
const server = http.createServer((req, res) => {
  const reqHeaders = { ...req.headers };
  const incomingHost = req.headers["host"];
  reqHeaders["x-forwarded-host"] = incomingHost;
  reqHeaders["x-forwarded-proto"] = req.headers["x-forwarded-proto"] || "https";
  reqHeaders["host"] = `127.0.0.1:${HEDEF_PORT}`;

  const proxyReq = http.request(
    {
      hostname: HEDEF_HOST,
      port: HEDEF_PORT,
      path: req.url,
      method: req.method,
      headers: reqHeaders,
    },
    (proxyRes) => {
      const headers = { ...proxyRes.headers };

      // Redirect başlıklarında (Location) yerel 3100 adreslerini göreli yola çevir
      if (headers.location) {
        headers.location = headers.location.replace(
          /^https?:\/\/(localhost|127\.0\.0\.1)(:3100)?/i,
          ""
        );
        if (!headers.location.startsWith("/")) {
          headers.location = "/" + headers.location;
        }
      }

      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("TekirExtra (port 3100) ulaşılamıyor: " + err.message);
  });

  req.pipe(proxyReq, { end: true });
});

// WebSocket desteği
server.on("upgrade", (req, socket, head) => {
  const proxyReq = http.request({
    hostname: HEDEF_HOST,
    port: HEDEF_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${HEDEF_PORT}` },
  });

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/${proxyRes.httpVersion} 101 Switching Protocols\r\n` +
        Object.keys(proxyRes.headers)
          .map((h) => `${h}: ${proxyRes.headers[h]}`)
          .join("\r\n") +
        "\r\n\r\n"
    );
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on("error", () => {
    socket.destroy();
  });

  proxyReq.end();
});

server.listen(PROXY_PORT, HEDEF_HOST, () => {
  console.log(`[Proxy] Yerel ara köprü 127.0.0.1:${PROXY_PORT} üzerinde aktif.`);
  baslatCloudflared();
});

let cloudflaredProc = null;

function baslatCloudflared() {
  console.log("[Tünel] Cloudflare Tunnel başlatılıyor...");

  cloudflaredProc = spawn("cloudflared", [
    "tunnel",
    "--url",
    `http://${HEDEF_HOST}:${PROXY_PORT}`,
  ]);

  let tunelUrlBulundu = false;

  const ciktiIsle = (data) => {
    const metin = data.toString();
    const eslesme = metin.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (eslesme && !tunelUrlBulundu) {
      tunelUrlBulundu = true;
      const url = eslesme[0];
      fs.writeFileSync(TUNEL_DOSYASI, url + "\n", "utf-8");
      fs.writeFileSync("/tmp/tekirextra-tunel-adresi.txt", url + "\n", "utf-8");
      
      console.log("\n=======================================================");
      console.log("       TEKIREXTRA UZAKTAN ERİŞİM TÜNELİ HAZIR         ");
      console.log("=======================================================");
      console.log(`🌐 Ana Uygulama:    ${url}`);
      console.log(`🏛️  Platform Modülü: ${url}/platform`);
      console.log(`🔐 Platform Giriş:  ${url}/platform/giris`);
      console.log(`📊 Yönetim Paneli:  ${url}/panel`);
      console.log("=======================================================\n");
    }
  };

  cloudflaredProc.stdout.on("data", ciktiIsle);
  cloudflaredProc.stderr.on("data", ciktiIsle);

  cloudflaredProc.on("close", (code) => {
    console.log(`[Tünel] Cloudflared kapandı (kod: ${code})`);
    process.exit(code ?? 0);
  });
}

function kapat() {
  console.log("\n[Kapatılıyor] Tünel sonlandırılıyor...");
  try {
    if (fs.existsSync(TUNEL_DOSYASI)) fs.unlinkSync(TUNEL_DOSYASI);
  } catch {}
  if (cloudflaredProc) {
    cloudflaredProc.kill("SIGTERM");
  }
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", kapat);
process.on("SIGTERM", kapat);
