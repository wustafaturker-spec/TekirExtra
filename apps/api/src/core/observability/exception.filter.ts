import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import type { Request, Response } from "express";
import { MetricsService } from "./metrics.service";
import { structuredLogger } from "./structured-logger";

@Catch()
export class ObservabilityExceptionFilter implements ExceptionFilter {
  constructor(private readonly metrics: MetricsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const requestId = String(req.headers["x-request-id"] ?? "unknown");
    this.metrics.increment("errors_total", { status_code: String(status) });
    structuredLogger.error("http_exception", exception, {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: status,
    });
    const body = exception instanceof HttpException ? exception.getResponse() : { message: "Beklenmeyen sunucu hatası" };
    res.status(status).json(body);
  }
}
