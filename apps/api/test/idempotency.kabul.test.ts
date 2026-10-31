import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { firstValueFrom, of, throwError } from "rxjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdempotencyInterceptor, TERK_SURESI_MS } from "../src/core/idempotency.interceptor";
import { istekBaglami } from "../src/core/istek-baglami";
import { PrismaService } from "../src/core/prisma.service";

/**
 * HTTP tekrar koruması gerçek PostgreSQL'de, uygulama rolü ve RLS ile. Hata veren
 * istek ayırmayı bırakır (eskiden "calisiyor" kalıp her yeniden denemeyi 409'a
 * düşürüyordu — banka "Hareketleri çek" 2026-10-31); terk edilmiş ayırma devralınır.
 */
const env = resolve(__dirname, "../.env");
if (existsSync(env)) process.loadEnvFile(env);

const yonetici = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const db = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });
const interceptor = new IdempotencyInterceptor(db);
const tenantId = randomUUID();
const userId = randomUUID();
const ROTA = "/api/v1/kasa-banka/banka-baglantilari/x/senkronize";

let calisma = 0;
function istek(anahtar: string, sonuc: () => unknown) {
  const request = { method: "POST", originalUrl: ROTA, body: {}, get: (ad: string) => (ad === "idempotency-key" ? anahtar : undefined) };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  const next = { handle: () => { calisma++; try { return of(sonuc()); } catch (e) { return throwError(() => e); } } } as CallHandler;
  return istekBaglami.run({ deger: { tenantId, userId, rol: "yonetici" } }, async () => firstValueFrom(await interceptor.intercept(context, next)));
}
const kayit = (anahtar: string) => yonetici.aiAracIstegi.findUnique({ where: { tenantId_userId_kaynak_istekAnahtari: { tenantId, userId, kaynak: "http", istekAnahtari: anahtar } } });

beforeAll(async () => {
  await yonetici.$executeRaw`INSERT INTO tenants (id, unvan, vkn, vergi_dairesi, created_at, updated_at) VALUES (${tenantId}::uuid, 'IDEMPOTENCY KABUL', ${String(Date.now()).slice(-10)}, 'Test', now(), now())`;
  await yonetici.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, aktif, created_at, updated_at) VALUES (${userId}::uuid, ${tenantId}::uuid, ${`idem-${tenantId}@ornek.invalid`}, 'x', 'Kabul', 'yonetici', true, now(), now())`;
});

afterAll(async () => {
  await yonetici.$executeRaw`DELETE FROM users WHERE tenant_id = ${tenantId}::uuid`;
  await yonetici.$executeRaw`DELETE FROM tenants WHERE id = ${tenantId}::uuid`;
  await Promise.all([yonetici.$disconnect(), db.$disconnect()]);
});

describe("HTTP tekrar koruması (gerçek PostgreSQL)", () => {
  it("hata veren istek ayırmayı bırakır; aynı anahtarla yeniden deneme çalışır ve tamamlanır", async () => {
    const anahtar = `idem-${randomUUID()}`;
    calisma = 0;
    await expect(istek(anahtar, () => { throw new Error("Vomsis hareketleri alınamadı"); })).rejects.toThrow("Vomsis");
    expect(await kayit(anahtar)).toBeNull();
    await expect(istek(anahtar, () => ({ yeniSatir: 3 }))).resolves.toEqual({ yeniSatir: 3 });
    expect(calisma).toBe(2);
    expect(await kayit(anahtar)).toMatchObject({ durum: "tamamlandi" });
    // Tamamlanmış istek tekrarında işlem çalışmaz, saklanan yanıt döner.
    await expect(istek(anahtar, () => ({ yeniSatir: 99 }))).resolves.toEqual({ yeniSatir: 3 });
    expect(calisma).toBe(2);
  });

  it("10 dakikadan eski 'calisiyor' kayıt (çökmüş istek) devralınır; yenisi 409 alır", async () => {
    const eski = `idem-${randomUUID()}`, yeni = `idem-${randomUUID()}`;
    // Önceki sürümün bıraktığı takılı kayıtlar: biri eski, biri taze.
    for (const [a, yas] of [[eski, TERK_SURESI_MS + 60_000], [yeni, 30_000]] as const) {
      await istek(a, () => ({ ilk: true }));
      await yonetici.aiAracIstegi.update({ where: { tenantId_userId_kaynak_istekAnahtari: { tenantId, userId, kaynak: "http", istekAnahtari: a } }, data: { durum: "calisiyor", sonuc: undefined, tamamlandiAt: null, createdAt: new Date(Date.now() - yas) } });
    }
    await expect(istek(eski, () => ({ yeniden: true }))).resolves.toEqual({ yeniden: true });
    expect(await kayit(eski)).toMatchObject({ durum: "tamamlandi" });
    await expect(istek(yeni, () => ({ yeniden: true }))).rejects.toThrow("halen işleniyor");
  });
});
