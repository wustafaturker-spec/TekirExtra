import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { createServer } from "node:http";
import { AppModule } from "./app.module";
import { MetricsService } from "./core/observability/metrics.service";

/** Ayrı süreçte kalıcı BullMQ işleyicilerini çalıştırır. */
async function bootstrap(): Promise<void> {
  process.env.TEKIR_WORKER = "1";
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  const metrics = app.get(MetricsService);
  const metrikPortu = Number(process.env.WORKER_METRICS_PORT || 9464);
  const metrikSunucusu = createServer((istek, yanit) => {
    if (istek.url === "/health") { yanit.writeHead(200, { "Content-Type": "application/json" }); yanit.end(JSON.stringify({ durum: "ok", worker: "ready" })); return; }
    if (istek.url === "/metrics") { yanit.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" }); yanit.end(metrics.render()); return; }
    yanit.writeHead(404); yanit.end();
  });
  await new Promise<void>((resolve, reject) => { metrikSunucusu.once("error", reject); metrikSunucusu.listen(metrikPortu, "0.0.0.0", resolve); });
  const kapat = () => metrikSunucusu.close();
  process.once("SIGTERM", kapat); process.once("SIGINT", kapat);
  // eslint-disable-next-line no-console
  console.log(`TekirExtra worker hazır — kuyruklar etkin, metrikler :${metrikPortu}/metrics`);
  await new Promise(() => undefined);
}

void bootstrap();
