import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, expect, it, vi } from "vitest";
import { AiOnayService } from "../src/ai/onay/ai-onay.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { PrismaService } from "../src/core/prisma.service";

/**
 * AI-107 kabulü (gerçek PostgreSQL): eşzamanlı onayda tek yan etki ve tek karar kaydı;
 * düzenlenen talep eski sürümle onaylanamaz; web–Telegram yarışında biri kazanır.
 * Ekran uçları sahtedir: okuma uçları sabit belge döner, yazan uç çağrıları sayılır.
 */
const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const db = new PrismaService();
const tenantId = randomUUID();

afterAll(async () => {
  await admin.$transaction(async (tx) => {
    await tx.aiOlay.deleteMany({ where: { tenantId } });
    await tx.aiOnayKarari.deleteMany({ where: { tenantId } });
    await tx.aiOnayTalebi.deleteMany({ where: { tenantId } });
    await tx.user.deleteMany({ where: { tenantId } });
    await tx.tenant.deleteMany({ where: { id: tenantId } });
  }, { timeout: 60_000 });
  await Promise.all([db.$disconnect(), admin.$disconnect()]);
});

function sahteUc() {
  const yazanlar: unknown[][] = [];
  const belge = { id: randomUUID(), no: "TKF2026000000045", tur: "teklif", yon: "satis", durum: "onaylandi", cari: { unvan: "Deneme A.Ş.", eposta: "muhasebe@deneme.example" }, eposta: "muhasebe@deneme.example", konu: "Teklif", metin: "Ekte", ekSurumu: "1" };
  return {
    belge, yazanlar,
    cagir: vi.fn(async (u: { yol: string }, arg: unknown[]) => {
      if (!u.yol.startsWith("GET ")) { yazanlar.push(arg); await new Promise((r) => setTimeout(r, 30)); return { gonderildi: true }; }
      return belge;
    }),
  };
}

it("onay sürümü ve karar kaydı: tek yan etki, eski sürüm reddi, kanal yarışı", async () => {
  await admin.tenant.create({ data: { id: tenantId, unvan: "Onay Sürüm Kabul", vkn: String(Date.now()).slice(-10) } });
  const user = await admin.user.create({ data: { tenantId, eposta: `${tenantId}@kabul.invalid`, adSoyad: "Onaylayan", parolaHash: "test", rol: "yonetici" } });
  const baglam = { tenantId, userId: user.id, rol: "yonetici" as const };
  const uc = sahteUc();
  const servis = new AiOnayService(db, uc as never, {} as never);
  const ac = (eposta: string) => baglamlaCalistir(baglam, () => servis.olustur({ arac: "belge_eposta_gonder", parametreler: { belgeId: uc.belge.id, eposta }, ozet: "Teklif e-postası", kaynak: "asistan" }));

  // 10 eşzamanlı onay: tek yan etki, tek karar; diğerleri 409 ZATEN_SONUCLANDI.
  const t1 = await ac("ilk@deneme.example");
  expect(t1).toMatchObject({ surum: 1, duzenlenebilir: { eposta: "ilk@deneme.example" } });
  const sonuclar = await Promise.allSettled(Array.from({ length: 10 }, () => baglamlaCalistir(baglam, () => servis.onayla(t1.id, { surum: 1, kanal: "WEB" }))));
  expect(sonuclar.filter((s) => s.status === "fulfilled")).toHaveLength(1);
  expect(sonuclar.filter((s) => s.status === "rejected").map((s) => (s as PromiseRejectedResult).reason.getResponse().kod)).toEqual(Array(9).fill("ZATEN_SONUCLANDI"));
  expect(uc.yazanlar).toHaveLength(1);
  expect(await admin.aiOnayKarari.findMany({ where: { talepId: t1.id } })).toMatchObject([{ karar: "onaylandi", kanal: "WEB", surum: 1, kararVerenId: user.id }]);

  // Düzenleme yeni sürüm üretir; eski sürümle onay reddedilir, yenisi düzenlenmiş değerle çalışır.
  const t2 = await ac("eski@deneme.example");
  const duz = await baglamlaCalistir(baglam, () => servis.duzenle(t2.id, { surum: 1, degerler: { eposta: "yeni@deneme.example" } }));
  expect(duz).toMatchObject({ surum: 2, duzenlenebilir: { eposta: "yeni@deneme.example" } });
  await expect(baglamlaCalistir(baglam, () => servis.duzenle(t2.id, { surum: 1, degerler: { eposta: "x@deneme.example" } }))).rejects.toMatchObject({ response: { kod: "ESKI_SURUM" } });
  await expect(baglamlaCalistir(baglam, () => servis.duzenle(t2.id, { surum: 2, degerler: { belgeId: randomUUID() } }))).rejects.toThrow(/düzenlenemez: belgeId/);
  await expect(baglamlaCalistir(baglam, () => servis.onayla(t2.id, { surum: 1, kanal: "TELEGRAM" }))).rejects.toMatchObject({ response: { kod: "ESKI_SURUM" } });
  expect(uc.yazanlar).toHaveLength(1);
  await baglamlaCalistir(baglam, () => servis.onayla(t2.id, { surum: 2, kanal: "WEB" }));
  expect(uc.yazanlar.at(-1)).toEqual([uc.belge.id, { eposta: "yeni@deneme.example" }]);
  expect(await admin.aiOnayKarari.findUniqueOrThrow({ where: { talepId: t2.id } })).toMatchObject({ surum: 2, kanal: "WEB" });

  // Web ve Telegram yarışı: biri kazanır, diğeri ZATEN_SONUCLANDI; tek karar, kanal kazananınki.
  const t3 = await ac("yaris@deneme.example");
  const yaris = await Promise.allSettled([
    baglamlaCalistir(baglam, () => servis.onayla(t3.id, { surum: 1, kanal: "WEB" })),
    baglamlaCalistir(baglam, () => servis.reddet(t3.id, { surum: 1, kanal: "TELEGRAM" })),
  ]);
  expect(yaris.filter((s) => s.status === "fulfilled")).toHaveLength(1);
  expect((yaris.find((s) => s.status === "rejected") as PromiseRejectedResult).reason.getResponse().kod).toBe("ZATEN_SONUCLANDI");
  const karar = await admin.aiOnayKarari.findMany({ where: { talepId: t3.id } });
  expect(karar).toHaveLength(1);
  expect(karar[0]!.kanal).toBe(yaris[0]!.status === "fulfilled" ? "WEB" : "TELEGRAM");
  // Karar kaydı içerik taşımaz: alıcı adresi değil yalnız özet.
  expect(JSON.stringify(karar[0])).not.toContain("yaris@deneme.example");
});
