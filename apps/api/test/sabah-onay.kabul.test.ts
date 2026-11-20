import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, it, expect } from "vitest";
import { trSimdi } from "../src/ai/ai-zaman";
import { HazirlikService } from "../src/ai/hazirlik/hazirlik.service";
import { HafizaService } from "../src/ai/hafiza/hafiza.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { PrismaService } from "../src/core/prisma.service";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const db = new PrismaService();
const service = new HazirlikService(db, new HafizaService(db));
const tenantId = randomUUID();

afterAll(async () => {
  await admin.$transaction(async (tx) => {
    await tx.crmEtkilesim.deleteMany({ where: { tenantId } });
    await tx.aiHazirlik.deleteMany({ where: { tenantId } });
    await tx.fatura.deleteMany({ where: { tenantId } });
    await tx.user.deleteMany({ where: { tenantId } });
    await tx.tenant.deleteMany({ where: { id: tenantId } });
  }, { timeout: 60_000 });
  await Promise.all([db.$disconnect(), admin.$disconnect()]);
});

it("eşzamanlı Sabah Onay kararları tek iş kaydı üretir ve reddedilen yazım yeniden denenebilir", async () => {
  await admin.tenant.create({ data: { id: tenantId, unvan: "Sabah Onay Kabul", vkn: String(Date.now()).slice(-10) } });
  const user = await admin.user.create({ data: { tenantId, eposta: `${tenantId}@kabul.invalid`, adSoyad: "Onaylayan", parolaHash: "test", rol: "muhasebe" } });
  const baglam = { tenantId, userId: user.id, rol: "muhasebe" as const };
  await baglamlaCalistir(baglam, async () => {
    const { cari, hazirlik } = await db.tenantIslem(tenantId, async (tx) => {
      const cari = await tx.cariHesap.create({ data: { tenantId, kod: "M1", unvan: "Test müşteri", tip: "musteri" } });
      const hazirlik = await tx.aiHazirlik.create({ data: {
        tenantId, tur: "vadesi_gecen_hatirlatma", tekilAnahtar: randomUUID(), baslik: "Hatırlatma", ozet: "Test",
        kaynakTur: "cari", kaynakId: cari.id, hedefOzeti: "test", olusturanUserId: user.id,
        gecerlilikBitisAt: new Date(Date.now() + 60_000), oneri: { cariId: cari.id, konu: "Vade", metin: "İlk metin" },
      } });
      return { cari, hazirlik };
    });

    await expect(baglamlaCalistir({ ...baglam, paketModulleri: [] }, () => service.onayla(hazirlik.id))).rejects.toBeInstanceOf(ForbiddenException);
    expect(await db.tenantIslem(tenantId, (tx) => tx.aiHazirlik.findUnique({ where: { id: hazirlik.id } }))).toMatchObject({ durum: "hazir" });

    await expect(service.onayla(hazirlik.id, { cariId: randomUUID() })).rejects.toBeInstanceOf(BadRequestException);

    await expect(baglamlaCalistir({ ...baglam, userId: randomUUID(), rol: "yonetici" }, () => service.onayla(hazirlik.id)))
      .rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(await db.tenantIslem(tenantId, (tx) => tx.aiHazirlik.findUnique({ where: { id: hazirlik.id } }))).toMatchObject({ durum: "hazir" });

    const kararlar = await Promise.allSettled([
      service.onayla(hazirlik.id, { metin: "Düzeltilmiş metin" }),
      service.onayla(hazirlik.id, { metin: "Düzeltilmiş metin" }),
    ]);
    expect(kararlar.filter((karar) => karar.status === "fulfilled")).toHaveLength(1);
    expect(kararlar.find((karar) => karar.status === "rejected")).toMatchObject({ reason: expect.any(ConflictException) });
    const kayitlar = await db.tenantIslem(tenantId, (tx) => tx.crmEtkilesim.findMany({ where: { cariId: cari.id } }));
    expect(kayitlar).toMatchObject([{ aciklama: "Düzeltilmiş metin" }]);
    expect(await db.tenantIslem(tenantId, (tx) => tx.aiHazirlik.findUnique({ where: { id: hazirlik.id } }))).toMatchObject({
      durum: "onaylandi", olusanKayitId: kayitlar[0].id,
    });

    const donem = trSimdi().gun.slice(0, 7);
    const kapanisHazirla = () => service.hazirla(tenantId, user.id, { turler: ["ay_sonu_kapanis"] });
    await Promise.all([kapanisHazirla(), kapanisHazirla()]);
    const kapanislar = await db.tenantIslem(tenantId, (tx) => tx.aiHazirlik.findMany({
      where: { tenantId, tur: "ay_sonu_kapanis" },
    }));
    expect(kapanislar).toHaveLength(1);
    const [kapanis] = kapanislar;
    expect(kapanis.oneri).toMatchObject({ donem, taslakFaturaSayisi: 0 });
    await expect(baglamlaCalistir({ ...baglam, ozelRol: { id: randomUUID(), kapali: ["raporlar.goruntule"] } },
      () => service.onayla(kapanis.id))).rejects.toBeInstanceOf(ForbiddenException);
    await db.tenantIslem(tenantId, (tx) => tx.fatura.create({ data: {
      tenantId, cariId: cari.id, tip: "satis", durum: "taslak", tarih: new Date(),
      toplamBrut: 0, toplamSatirIskontosu: 0, genelIskontoToplam: 0, toplamMatrah: 0,
      toplamKdv: 0, toplamTevkifat: 0, toplamNetKdv: 0, genelToplam: 0,
    } }));
    await expect(service.onayla(kapanis.id)).rejects.toBeInstanceOf(ConflictException);
    expect(await db.tenantIslem(tenantId, (tx) => tx.aiHazirlik.findUnique({ where: { id: kapanis.id } })))
      .toMatchObject({ durum: "hedef_degisti", olusanKayitId: null });

    expect(await kapanisHazirla()).toMatchObject({ uretilenSayisi: 1 });
    const guncel = await db.tenantIslem(tenantId, (tx) => tx.aiHazirlik.findUniqueOrThrow({ where: { id: kapanis.id } }));
    expect(guncel).toMatchObject({
      durum: "hazir",
      oneri: { taslakFaturaSayisi: 1 },
      kanit: { maddeler: expect.arrayContaining([{ ad: "Taslak Faturalar", bekleyen: 1, durum: "bekliyor" }]) },
    });
    expect(guncel.hedefOzeti).not.toBe(kapanis.hedefOzeti);
    await expect(service.onayla(kapanis.id)).resolves.toMatchObject({ durum: "onaylandi" });
    expect(await kapanisHazirla()).toMatchObject({ uretilenSayisi: 0 });
  });
});
