import "reflect-metadata";
import { uretimSirlariniDenetle } from "./core/guvenlik/uretim-sirlari";
import { surecHataKaydediciAyarla, yakalanmamisHatalariDinle } from "./core/observability/surec-hatalari";
import { HataKayitService } from "./core/observability/hata-kayit";
import { NestFactory } from "@nestjs/core";
import { createServer } from "node:http";
import { AppModule } from "./app.module";
import { NabizLogger } from "./core/nabiz/nabiz";

// Örnek sırlarla üretimde açılmaz; uygulama başlatılmadan önce denetlenir.
uretimSirlariniDenetle();
// PLT-124: yakalanmamış söz reddi ve istisna kaydedilir (kaydedici uygulama açılınca kurulur).
yakalanmamisHatalariDinle();

/**
 * CNL-01: Telegram kanalının ayrı süreci. Asistan araçları uygulamanın uçlarını süreç içinden
 * çağırdığı için AppModule yüklenir; `TEKIR_WORKER` açık olmadığından worker zamanlayıcıları
 * burada çalışmaz, API'ye özgü alarm denetimi de `TEKIR_TELEGRAM` ile kapalıdır. Bot anahtarı
 * (TELEGRAM_BOT_TOKEN) yalnız bu sürece verilir; asistan yükü ana worker'ı etkilemez.
 */
async function bootstrap(): Promise<void> {
  process.env.TEKIR_TELEGRAM = "1";
  delete process.env.TEKIR_WORKER;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: new NabizLogger() });
  // PLT-123: süreç dışı hatalar da uygulama hataları gruplamasına düşer.
  { const hataKayit = app.get(HataKayitService); surecHataKaydediciAyarla({ kaynak: "telegram", yalnizArkaPlan: false, kaydet: (g) => hataKayit.kaydet(g) }); }
  app.enableShutdownHooks();
  const port = Number(process.env.TELEGRAM_SAGLIK_PORTU || 9468);
  const sunucu = createServer((istek, yanit) => {
    if (istek.url === "/health") { yanit.writeHead(200, { "Content-Type": "application/json" }); yanit.end(JSON.stringify({ durum: "ok", surec: "telegram" })); return; }
    yanit.writeHead(404); yanit.end();
  });
  await new Promise<void>((resolve, reject) => { sunucu.once("error", reject); sunucu.listen(port, process.env.TELEGRAM_SAGLIK_HOST || "127.0.0.1", resolve); });
  const kapat = () => sunucu.close();
  process.once("SIGTERM", kapat); process.once("SIGINT", kapat);
  // eslint-disable-next-line no-console
  console.log(`TekirExtra Telegram süreci hazır — sağlık :${port}/health`);
}

void bootstrap().catch((hata) => { console.error(hata); process.exit(1); });
