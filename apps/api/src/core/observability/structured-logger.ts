import { baglamAl } from "../istek-baglami";

export type LogLevel = "info" | "warn" | "error";

function hataMesaji(hata: unknown): { name?: string; message?: string; stack?: string } {
  if (hata instanceof Error) return { name: hata.name, message: hata.message, stack: hata.stack };
  return { message: String(hata) };
}

export class StructuredLogger {
  private readonly service = process.env.SERVICE_NAME ?? "tekirextra-api";

  yaz(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    const baglam = baglamAl();
    const kayit = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      event,
      requestId: fields.requestId ?? undefined,
      tenantId: baglam?.tenantId,
      userId: baglam?.userId,
      ...fields,
    };
    process.stdout.write(`${JSON.stringify(kayit)}\n`);
  }

  info(event: string, fields?: Record<string, unknown>): void { this.yaz("info", event, fields); }
  warn(event: string, fields?: Record<string, unknown>): void { this.yaz("warn", event, fields); }
  error(event: string, hata: unknown, fields: Record<string, unknown> = {}): void {
    this.yaz("error", event, { ...fields, error: hataMesaji(hata) });
  }
}

export const structuredLogger = new StructuredLogger();
