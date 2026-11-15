import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/core/prisma.service";
import { raporErisilebilir, raporTanimiAl } from "../src/core/raporlar/rapor-kayit";
import "../src/ai/ai-kullanim.raporlar";

/**
 * AI-101 kabul testi (gerçek PostgreSQL, uygulama rolü + RLS): çağrı izlerinden
 * özellik/sağlayıcı/model kırılımı; başarı oranı, iptal, yeniden deneme, hata
 * türleri ve maliyet; dönem ve özellik süzgeci; başka firmanın izi görünmez;
 * yalnız yönetici çalıştırır.
 */
const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const prisma = new PrismaService();
const A = { tenant: randomUUID(), user: randomUUID() }, B = { tenant: randomUUID(), user: randomUUID() };
const tanim = raporTanimiAl("genel.yapay_zeka_kullanimi")!;

beforeAll(async () => {
  for (const [f, unvan] of [[A.tenant, "AI Rapor Alfa"], [B.tenant, "AI Rapor Beta"]] as const) {
    await yonetim.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${f}::uuid, ${unvan}, ${String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-10)}, now(), now())`;
  }
  const iz = (tenantId: string, userId: string, o: Record<string, unknown>) => ({
    tenantId, userId, ozellik: "asistan", saglayici: "openai", model: "m1", islem: "aracli_sohbet", sureMs: 2000, basarili: true, createdAt: new Date("2026-11-10T10:00:00Z"), ...o,
  });
  await yonetim.aiCagriIz.createMany({ data: [
    iz(A.tenant, A.user, { maliyetUsd: "0.01" }),
    iz(A.tenant, A.user, { maliyetUsd: "0.02", sureMs: 4000 }),
    iz(A.tenant, A.user, { basarili: false, hataSinifi: "SAGLAYICI_HTTP_503" }),
    iz(A.tenant, A.user, { basarili: true, deneme: 2, denemeNedeni: "yeniden_deneme", maliyetUsd: "0.01" }),
    iz(A.tenant, A.user, { basarili: false, hataSinifi: "IPTAL" }),
    iz(A.tenant, A.user, { ozellik: "ozet", model: "m2", maliyetUsd: "0.005", maliyetTahmini: true }),
    iz(A.tenant, A.user, { createdAt: new Date("2026-09-01T10:00:00Z") }),
    iz(B.tenant, B.user, { maliyetUsd: "9" }),
  ] as never });
});

afterAll(async () => {
  await yonetim.aiCagriIz.deleteMany({ where: { tenantId: { in: [A.tenant, B.tenant] } } }).catch(() => undefined);
  await yonetim.tenant.deleteMany({ where: { id: { in: [A.tenant, B.tenant] } } }).catch(() => undefined);
  await Promise.all([yonetim.$disconnect(), prisma.$disconnect()]);
});

const calistir = (tenantId: string, filtreler: Record<string, string>) =>
  prisma.tenantIslem(tenantId, (tx) => tanim.calistir({ filtreler: { baslangic: "2026-11-01", bitis: "2026-11-30", ...filtreler } }, { tenantId, tx }));

describe("AI-101 Yapay Zekâ Kullanımı raporu", () => {
  it("özellik/model kırılımında başarı, iptal, yeniden deneme, hata türleri ve maliyet; dönem dışı ve başka firma yok", async () => {
    const r = await calistir(A.tenant, {});
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ ozellikAdi: "Asistan", saglayici: "openai", model: "m1", cagri: 5, basarili: 3, basariOrani: "60.00", iptal: 1, yenidenDeneme: 1, maliyet: "0.0400", doviz: "USD", tahminiMaliyetli: 0 });
    expect(String(r[0].hatalar)).toMatch(/SAGLAYICI_HTTP_503: 1/);
    expect(String(r[0].hatalar)).toMatch(/IPTAL: 1/);
    expect(r[1]).toMatchObject({ ozellikAdi: "Özet ve brifing", model: "m2", cagri: 1, maliyet: "0.0050", tahminiMaliyetli: 1, hatalar: "—" });
  });

  it("özellik süzgeci uygulanır; içerik alanı yoktur; yalnız yönetici erişir", async () => {
    const r = await calistir(A.tenant, { ozellik: "ozet" });
    expect(r.map((x) => x.ozellikAdi)).toEqual(["Özet ve brifing"]);
    expect(Object.keys(r[0]).sort()).toEqual(["basariOrani", "basarili", "cagri", "doviz", "hatalar", "iptal", "maliyet", "model", "ozellikAdi", "saglayici", "sureP50", "tahminiMaliyetli", "yenidenDeneme"]);
    expect(raporErisilebilir(tanim, "yonetici")).toBe(true);
    for (const rol of ["muhasebe", "mali_musavir", "salt_okunur", "satis"] as const) expect(raporErisilebilir(tanim, rol)).toBe(false);
  });
});
