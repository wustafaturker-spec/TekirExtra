import "reflect-metadata";
import { uretimSirlariniDenetle } from "./core/guvenlik/uretim-sirlari";
import { surecHataKaydediciAyarla, yakalanmamisHatalariDinle } from "./core/observability/surec-hatalari";
import { HataKayitService } from "./core/observability/hata-kayit";
import { NabizLogger } from "./core/nabiz/nabiz";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createServer } from "node:http";
import { AbonelikErisimService } from "./core/abonelik-erisim.service";
import { PrismaService } from "./core/prisma.service";
import { EpostaService } from "./tenant/eposta.service";
import { IletiSablonService } from "./ileti/ileti-sablon.service";
import { SmsService } from "./ileti/sms.service";
import { PlatformIletiService } from "./ileti/platform-ileti.service";
import { PlatformPrismaService } from "./mevzuat/platform-prisma.service";
import { OdemeSozuHatirlatmaService } from "./cari/odeme-sozu-hatirlatma.service";

// ILT-02: EpostaService platform hesabını kullanır; bu süreç AppModule'ü yüklemediği için sağlayıcılar burada verilir.
@Module({ providers: [HataKayitService, PrismaService, PlatformPrismaService, PlatformIletiService, IletiSablonService, EpostaService, SmsService, OdemeSozuHatirlatmaService, AbonelikErisimService] })
class OdemeSozuWorkerModule {}
// Örnek sırlarla üretimde açılmaz; uygulama başlatılmadan önce denetlenir.
uretimSirlariniDenetle();
// PLT-124: yakalanmamış söz reddi ve istisna kaydedilir (kaydedici uygulama açılınca kurulur).
yakalanmamisHatalariDinle();

async function bootstrap() {
  process.env.TEKIR_ODEME_SOZU_WORKER = "1";
  const app = await NestFactory.createApplicationContext(OdemeSozuWorkerModule, { logger: new NabizLogger() });
  // PLT-123: süreç dışı hatalar da uygulama hataları gruplamasına düşer.
  { const hataKayit = app.get(HataKayitService); surecHataKaydediciAyarla({ kaynak: "worker", yalnizArkaPlan: false, kaydet: (g) => hataKayit.kaydet(g) }); }
  app.enableShutdownHooks();
  const servis = app.get(OdemeSozuHatirlatmaService);
  const server = createServer((_req, res) => { const ok = servis.saglikli(); res.writeHead(ok ? 200 : 503); res.end(ok ? "ok" : "not_ready"); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(Number(process.env.ODEME_SOZU_WORKER_PORT ?? 9467), "127.0.0.1", resolve); });
  process.once("SIGTERM", () => server.close());
  process.once("SIGINT", () => server.close());
}
void bootstrap().catch(error => { console.error(error); process.exit(1); });
