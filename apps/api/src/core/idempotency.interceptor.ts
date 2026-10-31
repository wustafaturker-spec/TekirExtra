import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Request } from "express";
import { createHash } from "node:crypto";
import { Observable, catchError, from, mergeMap, of, throwError } from "rxjs";
import { baglamAl } from "./istek-baglami";
import { PrismaService } from "./prisma.service";

const MUTASYONLAR = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ANAHTAR = /^[A-Za-z0-9._:-]{8,100}$/;
/**
 * Bu süreden uzun "calisiyor" kalan ayırma terk edilmiş sayılır (süreç çöktü, istek kesildi):
 * aynı anahtarla gelen istek onu devralıp yeniden çalışır. Uzun süren gerçek bir isteğin
 * (ör. banka çekimi) yanlışlıkla ikinci kez çalışmaması için HTTP zaman aşımlarından uzun tutulur.
 */
export const TERK_SURESI_MS = 10 * 60_000;

function kararliJson(deger: unknown): string {
  if (deger === null || typeof deger !== "object") return JSON.stringify(deger);
  if (Array.isArray(deger)) return `[${deger.map(kararliJson).join(",")}]`;
  return `{${Object.entries(deger as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${kararliJson(v)}`).join(",")}}`;
}

/** Kimlikli HTTP mutasyonlarında isteğe bağlı Idempotency-Key tekrar koruması. */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const istek = context.switchToHttp().getRequest<Request>();
    const baglam = baglamAl();
    const anahtar = istek.get("idempotency-key")?.trim();
    if (!baglam || !MUTASYONLAR.has(istek.method) || !anahtar) return next.handle();
    if (!ANAHTAR.test(anahtar)) throw new ConflictException("Idempotency-Key 8-100 karakter olmalı; yalnız harf, rakam, nokta, alt çizgi, iki nokta ve tire içermelidir.");

    const rota = `${istek.method} ${istek.originalUrl.split("?")[0]}`;
    const ozet = createHash("sha256").update(kararliJson({ rota, govde: istek.body ?? null })).digest("hex");
    const onceki = await this.ayir(baglam.tenantId, baglam.userId, anahtar, rota, ozet);
    if (onceki.tekrar) return of(onceki.sonuc);

    return next.handle().pipe(
      // İşlem hata verdiyse ayırma bırakılır: aynı anahtarla yeniden deneme gerçekten yeniden çalışır.
      // Eskiden kayıt "calisiyor" kalıyor, sonraki her deneme "halen işleniyor" (409) alıyordu.
      // Yalnız işleyicinin hatası yakalanır; tamamlama yazımı düşerse işlem olmuştur, kayıt silinmez.
      catchError((hata: unknown) => from(this.birak(baglam.tenantId, baglam.userId, anahtar).catch(() => undefined)).pipe(mergeMap(() => throwError(() => hata)))),
      mergeMap((sonuc) => from(this.tamamla(baglam.tenantId, baglam.userId, anahtar, sonuc).then(() => sonuc))),
    );
  }

  private async ayir(tenantId: string, userId: string, anahtar: string, rota: string, ozet: string): Promise<{ tekrar: boolean; sonuc?: unknown }> {
    try {
      await this.prisma.tenantIslem(tenantId, (tx) => tx.aiAracIstegi.create({ data: { tenantId, userId, kaynak: "http", istekAnahtari: anahtar, arac: rota, girdiOzeti: ozet } }));
      return { tekrar: false };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
      const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiAracIstegi.findUnique({ where: { tenantId_userId_kaynak_istekAnahtari: { tenantId, userId, kaynak: "http", istekAnahtari: anahtar } } }));
      if (!kayit || kayit.arac !== rota || kayit.girdiOzeti !== ozet) throw new ConflictException("Idempotency-Key farklı bir HTTP işlemi veya gövdesi için daha önce kullanılmış.");
      if (kayit.durum !== "tamamlandi" || !kayit.sonuc || typeof kayit.sonuc !== "object" || !("httpSonuc" in kayit.sonuc)) {
        if (kayit.durum === "calisiyor" && Date.now() - kayit.createdAt.getTime() > TERK_SURESI_MS && await this.devral(tenantId, kayit.id, kayit.createdAt)) return { tekrar: false };
        throw new ConflictException("Bu istek halen işleniyor; aynı anahtarla kısa süre sonra tekrar deneyin.");
      }
      return { tekrar: true, sonuc: (kayit.sonuc as { httpSonuc: unknown }).httpSonuc };
    }
  }

  /** Terk edilmiş ayırmayı koşullu devralır; aynı anda iki istek devralmaya çalışırsa yalnız biri kazanır. */
  private async devral(tenantId: string, id: string, eskiZaman: Date): Promise<boolean> {
    const { count } = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiAracIstegi.updateMany({ where: { id, durum: "calisiyor", createdAt: eskiZaman }, data: { createdAt: new Date() } }));
    return count === 1;
  }

  private async birak(tenantId: string, userId: string, anahtar: string): Promise<void> {
    await this.prisma.tenantIslem(tenantId, (tx) => tx.aiAracIstegi.deleteMany({ where: { tenantId, userId, kaynak: "http", istekAnahtari: anahtar, durum: "calisiyor" } }));
  }

  private async tamamla(tenantId: string, userId: string, anahtar: string, sonuc: unknown): Promise<void> {
    await this.prisma.tenantIslem(tenantId, (tx) => tx.aiAracIstegi.update({
      where: { tenantId_userId_kaynak_istekAnahtari: { tenantId, userId, kaynak: "http", istekAnahtari: anahtar } },
      data: { durum: "tamamlandi", sonuc: JSON.parse(JSON.stringify({ httpSonuc: sonuc ?? null })) as Prisma.InputJsonValue, tamamlandiAt: new Date() },
    }));
  }
}
