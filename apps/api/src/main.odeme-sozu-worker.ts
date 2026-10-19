import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createServer } from "node:http";
import { PrismaService } from "./core/prisma.service";
import { EpostaService } from "./tenant/eposta.service";
import { OdemeSozuHatirlatmaService } from "./cari/odeme-sozu-hatirlatma.service";

@Module({ providers: [PrismaService, EpostaService, OdemeSozuHatirlatmaService] })
class OdemeSozuWorkerModule {}
async function bootstrap() {
  process.env.TEKIR_ODEME_SOZU_WORKER = "1";
  const app = await NestFactory.createApplicationContext(OdemeSozuWorkerModule);
  app.enableShutdownHooks();
  const servis = app.get(OdemeSozuHatirlatmaService);
  const server = createServer((_req, res) => { const ok = servis.saglikli(); res.writeHead(ok ? 200 : 503); res.end(ok ? "ok" : "not_ready"); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(Number(process.env.ODEME_SOZU_WORKER_PORT ?? 9467), "127.0.0.1", resolve); });
  process.once("SIGTERM", () => server.close());
  process.once("SIGINT", () => server.close());
}
void bootstrap().catch(error => { console.error(error); process.exit(1); });
