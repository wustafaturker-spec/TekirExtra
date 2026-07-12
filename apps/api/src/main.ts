import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { bosTutucuylaCalistir } from "./core/istek-baglami";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });
  app.use((_req: unknown, _res: unknown, next: () => void) =>
    bosTutucuylaCalistir(next),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.APP_URL ?? "http://localhost:3000",
    credentials: true,
  });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`TekirExtra API hazır: http://localhost:${port}/health`);
}

void bootstrap();
