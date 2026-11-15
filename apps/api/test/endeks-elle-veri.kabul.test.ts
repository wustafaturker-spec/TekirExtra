import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { degerleriYaz } from "../src/fiyat-endeks/endeks-deposu";
import { PlatformEndeksController } from "../src/fiyat-endeks/platform-endeks.controller";

/**
 * END-05 kabul testi (gerçek PostgreSQL): platform yöneticisi EVDS
 * erişilemezken tamamlanmış bir ayın değerini dayanağıyla elle girer; EVDS
 * değeri elle ezilmez; EVDS aynı dönemi farklı getirince değer EVDS'ninki
 * olur ve fark görülene kadar uyarı kalır. Kiracı (uygulama rolü) katalog ve
 * revizyon görüldü bilgisini değiştiremez.
 */
const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const kontrol = new PlatformEndeksController({ db } as never, { anahtarTanimli: () => false } as never);
const kisi = randomUUID();
const SERI = `ELLE${String(Date.now()).slice(-9)}`;
const yonetici = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: kisi, eposta: "elle@kabul.invalid", rol: "yonetici" }, is);
const gecenAy = () => { const t = new Date(); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1)).toISOString().slice(0, 7); };
const buAy = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }).slice(0, 7);

beforeAll(async () => {
  await admin.platformKullanici.create({ data: { id: kisi, eposta: `${kisi}@kabul.invalid`, adSoyad: "Endeks yönetici", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  await admin.endeksSerisi.create({ data: { kod: SERI, evdsKodu: `TP.${SERI}`, ad: "Elle veri kabul serisi", etkin: false } });
  await admin.endeksDegeri.create({ data: { seriKodu: SERI, donem: new Date("2020-01-01T00:00:00.000Z"), deger: "100", kaynak: "evds" } });
});
afterAll(async () => {
  await admin.mevzuatOlay.deleteMany({ where: { kullaniciId: kisi } });
  await admin.endeksDegerRevizyonu.deleteMany({ where: { seriKodu: SERI } });
  await admin.endeksSerisi.deleteMany({ where: { kod: SERI } });
  await admin.platformKullanici.deleteMany({ where: { id: kisi } });
  await Promise.all([admin.$disconnect(), db.$disconnect(), app.$disconnect()]);
});

describe("END-05 elle endeks verisi — gerçek PostgreSQL", () => {
  it("tamamlanmış ay dayanağıyla girilir, son dönem ilerler ve olay kaydı yazılır", async () => {
    const donem = gecenAy();
    await yonetici(() => kontrol.elleGir(SERI, { donem, deger: "123.456789", aciklama: "TÜİK bülteni, kabul testi" }));
    const d = await db.endeksDegeri.findUniqueOrThrow({ where: { seriKodu_donem: { seriKodu: SERI, donem: new Date(`${donem}-01T00:00:00.000Z`) } } });
    expect([d.kaynak, d.deger.toString(), d.aciklama]).toEqual(["elle", "123.456789", "TÜİK bülteni, kabul testi"]);
    expect((await db.endeksSerisi.findUniqueOrThrow({ where: { kod: SERI } })).sonDonem?.toISOString().slice(0, 7)).toBe(donem);
    expect(await db.mevzuatOlay.count({ where: { kullaniciId: kisi, olay: "endeks_degeri_elle_girildi" } })).toBe(1);
    // Kendi düzeltmesi uyarı üretmez.
    await yonetici(() => kontrol.elleGir(SERI, { donem, deger: "124", aciklama: "Düzeltme, kabul testi" }));
    expect((await yonetici(() => kontrol.listele())).seriler.find((s) => s.kod === SERI)).toMatchObject({ elleDegerSayisi: 1, gorulmemisRevizyon: 0 });
  });

  it("içinde bulunulan ay, EVDS değeri olan ay ve hatalı girdi reddedilir", async () => {
    await expect(yonetici(() => kontrol.elleGir(SERI, { donem: buAy(), deger: "1", aciklama: "Bu ay olmaz" }))).rejects.toThrow("tamamlanmış");
    await expect(yonetici(() => kontrol.elleGir(SERI, { donem: "2020-01", deger: "1", aciklama: "EVDS değeri var" }))).rejects.toThrow("EVDS değeri var");
    for (const g of [{ donem: "2020-02", deger: "0", aciklama: "sıfır değer" }, { donem: "2020-02", deger: "-5", aciklama: "eksi değer" }, { donem: "2020-13", deger: "1", aciklama: "geçersiz ay" }, { donem: "2020-02", deger: "1", aciklama: "" }, { donem: "2020-02", deger: "1,5", aciklama: "virgüllü" }]) {
      await expect(yonetici(() => kontrol.elleGir(SERI, g))).rejects.toThrow();
    }
    await expect(yonetici(() => kontrol.elleGir("YOK_BOYLE", { donem: "2020-02", deger: "1", aciklama: "seri yok" }))).rejects.toThrow("bulunamadı");
  });

  it("EVDS farklı değer getirince değer EVDS'nin olur, dayanak silinir, fark görülene kadar uyarıdır", async () => {
    const donem = `${gecenAy()}-01`;
    const yazim = await degerleriYaz(app, SERI, [{ donem, deger: "125" }], "evds");
    expect(yazim).toMatchObject({ revize: 1, elleUyusmaz: 1 });
    const d = await db.endeksDegeri.findUniqueOrThrow({ where: { seriKodu_donem: { seriKodu: SERI, donem: new Date(`${donem}T00:00:00.000Z`) } } });
    expect([d.kaynak, d.deger.toString(), d.aciklama]).toEqual(["evds", "125", null]);
    expect((await yonetici(() => kontrol.listele())).seriler.find((s) => s.kod === SERI)).toMatchObject({ elleDegerSayisi: 0, gorulmemisRevizyon: 1 });
    // Uygulama rolü görüldü bilgisini değiştiremez.
    await expect(app.endeksDegerRevizyonu.updateMany({ where: { seriKodu: SERI }, data: { gorulduAt: new Date() } })).rejects.toThrow();
    expect(await yonetici(() => kontrol.revizyonlarGoruldu(SERI))).toEqual({ adet: 1 });
    expect(await yonetici(() => kontrol.revizyonlarGoruldu(SERI))).toEqual({ adet: 0 });
    expect((await yonetici(() => kontrol.listele())).seriler.find((s) => s.kod === SERI)?.gorulmemisRevizyon).toBe(0);
  });

  it("elle girilen değer EVDS'de aynı gelirse kaynak EVDS olur, revizyon ve uyarı oluşmaz", async () => {
    await yonetici(() => kontrol.elleGir(SERI, { donem: "2020-03", deger: "101.5", aciklama: "Aynı gelecek değer" }));
    expect(await degerleriYaz(app, SERI, [{ donem: "2020-03-01", deger: "101.5" }], "evds")).toMatchObject({ revize: 0, elleUyusmaz: 0 });
    const d = await db.endeksDegeri.findUniqueOrThrow({ where: { seriKodu_donem: { seriKodu: SERI, donem: new Date("2020-03-01T00:00:00.000Z") } } });
    expect([d.kaynak, d.aciklama]).toEqual(["evds", null]);
  });
});
