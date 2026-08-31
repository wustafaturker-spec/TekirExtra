import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { bosTutucuylaCalistir } from "./core/istek-baglami";
import { randomUUID } from "node:crypto";
import { MetricsService } from "./core/observability/metrics.service";
import { ObservabilityExceptionFilter } from "./core/observability/exception.filter";
import { structuredLogger } from "./core/observability/structured-logger";
import { DagitikRateLimiter } from "./core/guvenlik/rate-limiter";

import { json, urlencoded } from "express";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: process.env.JSON_BODY_LIMIT ?? "2mb" }));
  app.use(urlencoded({ limit: process.env.FORM_BODY_LIMIT ?? "2mb", extended: true }));
  const metrics = app.get(MetricsService);
  app.useGlobalFilters(new ObservabilityExceptionFilter(metrics));
  app.setGlobalPrefix("api/v1", { exclude: ["health", "health/ready", "metrics"] });
  app.use((_req: unknown, _res: unknown, next: () => void) =>
    bosTutucuylaCalistir(next),
  );
  app.use(cookieParser());
  app.use((req: { headers: Record<string, string | string[] | undefined>; path?: string; method: string }, res: { setHeader: (name: string, value: string) => void; on: (event: string, cb: () => void) => void; statusCode: number }, next: () => void) => {
    const requestId = String(req.headers["x-request-id"] ?? randomUUID());
    req.headers["x-request-id"] = requestId;
    res.setHeader("X-Request-ID", requestId);
    const started = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - started;
      const route = req.path ?? "unknown";
      metrics.observeHttp(durationMs, { method: req.method, route, status: res.statusCode });
      structuredLogger.info("http_request", { requestId, method: req.method, path: route, statusCode: res.statusCode, durationMs });
    });
    next();
  });
  const limit = Number(process.env.RATE_LIMIT_MAX ?? 300);
  const pencereMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  const rateLimiter = await DagitikRateLimiter.olustur(limit, pencereMs, process.env.REDIS_URL);
  app.use(async (req: { ip?: string; path?: string }, res: { status: (kod: number) => { json: (govde: unknown) => void }; setHeader: (ad: string, deger: string) => void }, next: () => void) => {
    if (req.path === "/health" || req.path === "/health/ready" || req.path === "/metrics") return next();
    const anahtar = req.ip ?? "unknown";
    const simdi = Date.now();
    const sonuc = await rateLimiter.tuket(anahtar, simdi);
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(sonuc.kalan));
    res.setHeader("RateLimit-Reset", String(Math.ceil(sonuc.sifirlamaMs / 1000)));
    if (!sonuc.izinli) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((sonuc.sifirlamaMs - simdi) / 1000))));
      metrics.increment("rate_limit_rejections_total", { path: req.path ?? "unknown" });
      structuredLogger.warn("rate_limit_rejected", { path: req.path, ip: anahtar, source: sonuc.kaynak });
      return res.status(429).json({ mesaj: "Çok fazla istek. Lütfen daha sonra tekrar deneyin." });
    }
    next();
  });
  app.enableCors({
    origin: process.env.APP_URL ?? "http://localhost:3100",
    credentials: true,
  });
  app.use((_req: unknown, res: { setHeader: (ad: string, deger: string) => void }, next: () => void) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    next();
  });
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().on?.("close", () => { void rateLimiter.kapat(); });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  structuredLogger.info("api_ready", { port, healthUrl: `http://localhost:${port}/health` });
}

void bootstrap();
