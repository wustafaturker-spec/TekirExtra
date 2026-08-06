import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { Observable, tap } from "rxjs";
import { baglamAl } from "./istek-baglami";
import { PrismaService } from "./prisma.service";

const MUTASYON_METOTLARI = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Denetim izi (KLN-04): kimlikli tüm mutasyonlar başarıyla tamamlandığında
 * audit_log'a yazılır — kim, ne zaman, hangi uçta ne yaptı. Gövde İÇERİĞİ
 * loglanmaz (parola/kimlik bilgisi sızıntısı riski); yalnızca uç ve parametreler.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const istek = context.switchToHttp().getRequest<Request>();
    const baglam = baglamAl();

    if (!baglam || !MUTASYON_METOTLARI.has(istek.method) || istek.path.endsWith("/kullanim/olay")) {
      return next.handle();
    }

    // Yol deseninden varlık adı: /api/v1/baglantilar/:id/test → baglantilar
    const varlik = istek.path.replace(/^\/api\/v1\//, "").split("/")[0] ?? "";

    return next.handle().pipe(
      tap(() => {
        void this.prisma
          .tenantIslem(baglam.tenantId, (tx) =>
            tx.auditLog.create({
              data: {
                tenantId: baglam.tenantId,
                userId: baglam.userId,
                islem: `${istek.method} ${istek.path}`,
                varlik,
                varlikId: (istek.params as Record<string, string>).id ?? null,
              },
            }),
          )
          .catch((hata: unknown) => {
            // Audit yazılamaması isteği geri almaz ama sessiz de kalmaz
            this.logger.error(`Denetim izi yazılamadı: ${String(hata)}`);
          });
      }),
    );
  }
}
