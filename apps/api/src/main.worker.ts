import "reflect-metadata";
import { uretimSirlariniDenetle } from "./core/guvenlik/uretim-sirlari";
import { NestFactory } from "@nestjs/core";
import { createServer } from "node:http";
import { AppModule } from "./app.module";
import { NabizLogger } from "./core/nabiz/nabiz";
import { MetricsService } from "./core/observability/metrics.service";
import { metrikErisimi } from "./core/observability/observability.controller";

// Örnek sırlarla üretimde açılmaz; uygulama başlatılmadan önce denetlenir.
uretimSirlariniDenetle();

/** Ayrı süreçte kalıcı BullMQ işleyicilerini çalıştırır. */
async function bootstrap(): Promise<void> {
  process.env.TEKIR_WORKER = "1";
  const app = await NestFactory.createApplicationContext(AppModule, { logger: new NabizLogger() });
  app.enableShutdownHooks();
  const metrics = app.get(MetricsService);
  const metrikPortu = Number(process.env.WORKER_METRICS_PORT || 9464);
  const metrikSunucusu = createServer((istek, yanit) => {
    if (istek.url === "/health") { yanit.writeHead(200, { "Content-Type": "application/json" }); yanit.end(JSON.stringify({ durum: "ok", worker: "ready" })); return; }
    if (istek.url === "/metrics") {
      // SEC-07: API'deki kural; üretimde token yoksa kapalı.
      const erisim = metrikErisimi(process.env.METRICS_TOKEN, istek.headers.authorization);
      if (erisim !== "izinli") { yanit.writeHead(erisim === "yok" ? 404 : 401); yanit.end(); return; }
      yanit.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" }); yanit.end(metrics.render()); return;
    }
    yanit.writeHead(404); yanit.end();
  });
  await new Promise<void>((resolve, reject) => { metrikSunucusu.once("error", reject); metrikSunucusu.listen(metrikPortu, process.env.WORKER_METRICS_HOST || "0.0.0.0", resolve); });
  const kapat = () => metrikSunucusu.close();
  process.once("SIGTERM", kapat); process.once("SIGINT", kapat);
  // eslint-disable-next-line no-console
  console.log(`TekirExtra worker hazır — kuyruklar etkin, metrikler :${metrikPortu}/metrics`);
  await new Promise(() => undefined);
}

void bootstrap();
