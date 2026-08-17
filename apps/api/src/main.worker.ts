import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

/**
 * Worker giriş noktası. BullMQ kuyruk işleyicileri 6. aşamada (e-belge)
 * buraya bağlanacak; şimdilik uygulama bağlamını ayağa kaldırıp bekler.
 */
async function bootstrap(): Promise<void> {
  process.env.TEKIR_WORKER = "1";
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  // eslint-disable-next-line no-console
  console.log("TekirExtra worker hazır — otomatik kira tahakkukları etkin");
  await new Promise(() => undefined);
}

void bootstrap();
