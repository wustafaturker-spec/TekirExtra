import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ConflictException, Module } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { Prisma, PrismaClient } from "@prisma/client";
import { gunTR, type PanelWidget } from "@tekirextra/shared";
import { afterAll, expect, it } from "vitest";
import { RollerGuard } from "../src/auth/roller.guard";
import { PanelWidgetController } from "../src/auth/panel-widget.controller";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { PrismaService } from "../src/core/prisma.service";
import { raporTanimlari } from "../src/core/raporlar/rapor-kayit";
import "../src/kasa-banka/kasa-banka.raporlar";
import { RaporController } from "../src/rapor/rapor.controller";
import { RaporService } from "../src/rapor/rapor.service";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const db = new PrismaService();
const panel = new PanelWidgetController(db);
const rapor = new RaporService(db);

// Vitest dönüşümü NestJS constructor metadata’sını üretmez.
Reflect.defineMetadata("design:paramtypes", [RaporService], RaporController);

@Module({
  controllers: [RaporController],
  providers: [{ provide: RaporService, useValue: rapor }],
})
class WidgetRaporKabulModule {}

const firmalar: string[] = [];

async function firmaOlustur() {
  const tenantId = randomUUID();
  await admin.tenant.create({ data: { id: tenantId, unvan: "Widget Kabul", vkn: String(parseInt(tenantId.slice(0, 8), 16)).padStart(10, "0") } });
  firmalar.push(tenantId);
  async function kullanici(rol: "yonetici" | "muhasebe") {
    const user = await admin.user.create({ data: {
      tenantId, rol, eposta: `${rol}.${tenantId}@kabul.invalid`, adSoyad: rol, parolaHash: "test",
    } });
    return { tenantId, userId: user.id, rol };
  }
  return { yonetici: await kullanici("yonetici"), muhasebe: await kullanici("muhasebe") };
}

afterAll(async () => {
  const tenantId = { in: firmalar };
  await admin.$transaction(async (tx) => {
    await tx.kasaBankaHareket.deleteMany({ where: { tenantId } });
    await tx.fatura.deleteMany({ where: { tenantId } });
    await tx.kasa.deleteMany({ where: { tenantId } });
    await tx.cariHesap.deleteMany({ where: { tenantId } });
    await tx.user.deleteMany({ where: { tenantId } });
    await tx.tenant.deleteMany({ where: { id: tenantId } });
  }, { timeout: 60_000 });
  await Promise.all([db.$disconnect(), admin.$disconnect()]);
});

it("widget tercihi iki firmada ve iki rolde yalıtılır, dönem toplamları kaynak kayıtlarla uyuşur", async () => {
  const a = await firmaOlustur();
  const b = await firmaOlustur();
  const widget: PanelWidget = { id: randomUUID(), baslik: "Haftalık tahsilat", kaynak: "tahsilat", filtre: "bu_hafta", gorunum: "trend" };
  const ilkTercih = { surum: 0, widgetlar: [widget] };

  await expect(baglamlaCalistir(a.yonetici, () => panel.kaydet(ilkTercih))).resolves.toEqual({ ...ilkTercih, surum: 1 });
  await expect(baglamlaCalistir(a.yonetici, () => panel.kaydet(ilkTercih))).rejects.toBeInstanceOf(ConflictException);
  for (const baglam of [a.muhasebe, b.yonetici, b.muhasebe]) {
    await baglamlaCalistir(baglam, async () => {
      expect(await panel.getir()).toEqual({ surum: 0, widgetlar: [] });
      expect(await db.tenantIslem(baglam.tenantId, (tx) => tx.panelWidgetTercihi.findMany())).toEqual([]);
    });
  }
  await expect(baglamlaCalistir(b.muhasebe, () => panel.kaydet({ surum: 0, widgetlar: [] }))).resolves.toEqual({ surum: 1, widgetlar: [] });
  await expect(baglamlaCalistir(a.yonetici, () => panel.getir())).resolves.toEqual({ ...ilkTercih, surum: 1 });

  await baglamlaCalistir(a.muhasebe, async () => {
    const { tenantId } = a.muhasebe;
    const tarih = new Date(gunTR(new Date()));
    const fatura = await db.tenantIslem(tenantId, async (tx) => {
      const cari = await tx.cariHesap.create({ data: { tenantId, kod: "M1", unvan: "Widget müşterisi", tip: "musteri" } });
      const kasa = await tx.kasa.create({ data: { tenantId, ad: "Kabul kasa" } });
      await tx.kasaBankaHareket.createMany({ data: [
        { tenantId, kasaId: kasa.id, cariId: cari.id, tip: "tahsilat", tutar: "105.25", tutarTry: "105.25", tarih, kaynakTur: "manuel" },
        { tenantId, kasaId: kasa.id, cariId: cari.id, tip: "tahsilat", tutar: "900", tutarTry: "900", tarih, kaynakTur: "acilis" },
      ] });
      return tx.fatura.create({ data: {
        tenantId, tip: "satis", durum: "kesin", no: "KBL2026000000001", tarih, vadeTarihi: tarih, cariId: cari.id,
        toplamBrut: "200", toplamSatirIskontosu: "0", genelIskontoToplam: "0", toplamMatrah: "200",
        toplamKdv: "40", toplamTevkifat: "0", toplamNetKdv: "40", genelToplam: "240",
      } });
    });
    const kaynak = raporTanimlari().find((tanim) => tanim.kod === "kasa_banka.tahsilat_odeme")!;
    for (const donem of ["bu_hafta", "bu_ay"] as const) {
      const tahsilat = await rapor.tahsilatDonemiOzeti(donem);
      const satirlar = await db.tenantIslem(tenantId, (tx) => kaynak.calistir({
        filtreler: { baslangic: tahsilat.baslangic, bitis: tahsilat.bitis, virmanHaric: true },
      }, { tenantId, tx }));
      expect(tahsilat).toMatchObject({ toplam: "105.25", adet: 1 });
      expect(satirlar).toMatchObject([{ girisTry: tahsilat.toplam }]);
      expect(tahsilat.gunler.reduce((toplam, gun) => toplam.plus(gun.tutar), new Prisma.Decimal(0)).toFixed(2)).toBe(tahsilat.toplam);
      const vade = await rapor.vadeDonemiOzeti(donem);
      expect(vade).toMatchObject({ toplamAlacak: fatura.genelToplam.toFixed(2), alacakSayisi: 1, toplamBorc: "0.00" });
      expect(vade.alacaklar).toMatchObject([{ faturaId: fatura.id, kalanTry: "240.00" }]);
    }
  });
  await expect(baglamlaCalistir(b.muhasebe, () => rapor.tahsilatDonemiOzeti("bu_ay"))).resolves.toMatchObject({ toplam: "0.00", adet: 0 });
});

it("kaynak rapor HTTP uçları yetki kaldırılınca 403 döner", async () => {
  const { muhasebe } = await firmaOlustur();
  let izinKaldirildi = false;
  const app = await NestFactory.create(WidgetRaporKabulModule, { logger: false });
  try {
    app.setGlobalPrefix("api/v1");
    app.use((_istek: unknown, _yanit: unknown, next: () => void) =>
      baglamlaCalistir({
        ...muhasebe,
        ...(izinKaldirildi ? { ozelRol: { id: randomUUID(), kapali: ["raporlar.goruntule"] } } : {}),
      }, async () => next()),
    );
    app.useGlobalGuards(new RollerGuard(new Reflector()));
    await app.listen(0, "127.0.0.1");
    const adres = await app.getUrl();
    const kaynaklar = ["tahsilat-donemi", "vade-donemi"];
    for (const kaynak of kaynaklar) {
      const yanit = await fetch(`${adres}/api/v1/rapor/${kaynak}?donem=bu_hafta`);
      expect(yanit.status).toBe(200);
      expect(await yanit.json()).toMatchObject({ donem: "bu_hafta" });
    }
    izinKaldirildi = true;
    for (const kaynak of kaynaklar) {
      const yanit = await fetch(`${adres}/api/v1/rapor/${kaynak}?donem=bu_hafta`);
      expect(yanit.status).toBe(403);
      expect(await yanit.json()).not.toHaveProperty("donem");
    }
  } finally {
    await app.close();
  }
});
