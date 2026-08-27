import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { MetricsService } from "./metrics.service";
import { structuredLogger } from "./structured-logger";

@Catch()
export class ObservabilityExceptionFilter implements ExceptionFilter {
  constructor(private readonly metrics: MetricsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
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
    if (status >= 500) {
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
    res.status(status).json(body);
  }
}
