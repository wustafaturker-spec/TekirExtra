import { BadRequestException, ArgumentsHost, Catch, ExceptionFilter, ForbiddenException, HttpException, ServiceUnavailableException } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { MetricsService } from "./metrics.service";
import { structuredLogger } from "./structured-logger";

/**
 * STK-35: bağlantı havuzu dolduğunda Prisma'nın verdiği hatalar — P2024
 * (havuzdan bağlantı alınamadı), P2028 (işlem süresinde başlatılamadı).
 * Kalıcı bir arıza değil; istemci kısa süre sonra yeniden denemeli.
 */
const YOGUNLUK_KODLARI = new Set(["P2024", "P2028", "P2034"]);
const RETRY_AFTER_SN = 3;

export function yogunlukHatasiMi(hata: unknown): boolean {
  if (!(hata instanceof Error) || !hata.name.startsWith("PrismaClient")) return false;
  const kod = (hata as { code?: unknown }).code;
  return typeof kod === "string" && YOGUNLUK_KODLARI.has(kod);
}

/**
 * body-parser'ın istek gövdesi hataları (http-errors: `expose` + 4xx `status`):
 * bozuk JSON, büyük gövde, sıkıştırılmış gövde (SEC-04 `inflate: false`).
 * İstemci hatasıdır; 500 yerine kendi durumu ve Türkçe iletiyle döner.
 */
const GOVDE_HATASI_ILETILERI: Record<string, string> = {
  "encoding.unsupported": "Sıkıştırılmış istek gövdesi desteklenmiyor",
  "entity.parse.failed": "İstek gövdesi geçerli JSON değil",
  "entity.too.large": "İstek gövdesi çok büyük",
  "charset.unsupported": "İstek karakter kümesi desteklenmiyor",
};
export function istemciGovdeHatasi(hata: unknown): { status: number; mesaj: string } | null {
  if (!(hata instanceof Error)) return null;
  const h = hata as Error & { status?: unknown; expose?: unknown; type?: unknown };
  if (h.expose !== true || typeof h.status !== "number" || h.status < 400 || h.status > 499) return null;
  return { status: h.status, mesaj: GOVDE_HATASI_ILETILERI[String(h.type)] ?? "İstek gövdesi işlenemedi" };
}

/**
 * P2003: bağlı kayıt yok (başka kiracınınki dahil, kiraci_bag_denetle) ya da kayıt başka
 * satırlarca kullanılıyor. İstemci hatasıdır; hangisi olduğu ve kimlik ayrıntısı söylenmez.
 */
export function bagHatasiMi(hata: unknown): boolean {
  return hata instanceof Error && hata.name.startsWith("PrismaClient") && (hata as { code?: unknown }).code === "P2003";
}
export function paketKotaHatasi(hata: unknown): HttpException | null {
  if (!(hata instanceof Error) || !hata.name.startsWith("PrismaClient")) return null;
  const m = `${hata.message} ${JSON.stringify((hata as { meta?: unknown }).meta ?? {})}`;
  if (m.includes("paket_modul_kapali:")) return new ForbiddenException("Bu modül abonelik paketinizde kapalı.");
  if (m.includes("paket_kota_dolu:")) return new BadRequestException("Paket kullanım kotası doldu. Kullanımı azaltın veya paket değişikliği isteyin.");
  return null;
}

@Catch()
export class ObservabilityExceptionFilter implements ExceptionFilter {
  constructor(private readonly metrics: MetricsService) {}

  catch(hata: unknown, host: ArgumentsHost): void {
    const yogun = yogunlukHatasiMi(hata);
    const exception = yogun
      ? new ServiceUnavailableException("Sistem şu an yoğun, birkaç saniye sonra yeniden deneyin")
      : bagHatasiMi(hata)
        ? new BadRequestException("Seçilen bağlı kayıt bulunamadı ya da kayıt başka işlemlerde kullanılıyor")
        : paketKotaHatasi(hata) ?? hata;
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const istemci = istemciGovdeHatasi(exception);
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : exception instanceof ZodError
        ? 400
        : istemci?.status ?? 500;
    const requestId = String(req.headers["x-request-id"] ?? "unknown");
    this.metrics.increment("errors_total", { status_code: String(status) });
    const logAlanlari = {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: status,
    };
    if (yogun) {
      structuredLogger.warn("db_pool_busy", { ...logAlanlari, errorMessage: (hata as Error).message });
    } else if (status >= 500) {
      structuredLogger.error("http_exception", exception, logAlanlari);
    } else {
      structuredLogger.warn("http_client_error", {
        ...logAlanlari,
        errorName: exception instanceof Error ? exception.name : undefined,
        errorMessage: exception instanceof Error ? exception.message : String(exception),
      });
    }
    const body = exception instanceof HttpException
      ? exception.getResponse()
      : exception instanceof ZodError
        ? {
            statusCode: 400,
            message: exception.issues.map((issue) =>
              `${issue.path.join(".") || "alan"}: ${issue.message}`,
            ),
            error: "Bad Request",
          }
        : istemci
          ? { statusCode: istemci.status, message: istemci.mesaj }
          : { message: "Beklenmeyen sunucu hatası" };
    if (yogun) res.setHeader("Retry-After", String(RETRY_AFTER_SN));
    res.status(status).json(body);
  }
}
