import { ArgumentsHost, Catch, ExceptionFilter, HttpException, ServiceUnavailableException } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { MetricsService } from "./metrics.service";
import { structuredLogger } from "./structured-logger";

/**
 * STK-35: bağlantı havuzu dolduğunda Prisma'nın verdiği hatalar — P2024
 * (havuzdan bağlantı alınamadı), P2028 (işlem süresinde başlatılamadı).
 * Kalıcı bir arıza değil; istemci kısa süre sonra yeniden denemeli.
 */
const YOGUNLUK_KODLARI = new Set(["P2024", "P2028"]);
const RETRY_AFTER_SN = 3;

export function yogunlukHatasiMi(hata: unknown): boolean {
  if (!(hata instanceof Error) || !hata.name.startsWith("PrismaClient")) return false;
  const kod = (hata as { code?: unknown }).code;
  return typeof kod === "string" && YOGUNLUK_KODLARI.has(kod);
}

@Catch()
export class ObservabilityExceptionFilter implements ExceptionFilter {
  constructor(private readonly metrics: MetricsService) {}

  catch(hata: unknown, host: ArgumentsHost): void {
    const yogun = yogunlukHatasiMi(hata);
    const exception = yogun
      ? new ServiceUnavailableException("Sistem şu an yoğun, birkaç saniye sonra yeniden deneyin")
      : hata;
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : exception instanceof ZodError
        ? 400
        : 500;
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
        : { message: "Beklenmeyen sunucu hatası" };
    if (yogun) res.setHeader("Retry-After", String(RETRY_AFTER_SN));
    res.status(status).json(body);
  }
}
