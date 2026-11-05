import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PlatformFirmaTakipService } from "../src/mevzuat/platform-firma-takip.service";
import { PlatformFirmaService } from "../src/mevzuat/platform-firma.service";
import { PlatformGorevService } from "../src/mevzuat/platform-gorev.service";
import { firmaFiltreSemasi } from "../src/mevzuat/platform-firma-filtre";
import { editorGorebilirMi } from "../src/mevzuat/olay-gorunurlugu";

const env = resolve(__dirname, "../.env");
if (existsSync(env)) process.loadEnvFile(env);
const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const service = new PlatformFirmaTakipService({ db } as never);
const firmalar = new PlatformFirmaService({ db } as never, {} as never, {} as never);
const gorevler = new PlatformGorevService({ db } as never);
const ids = { firma: randomUUID(), diger: randomUUID(), ben: randomUUID(), sorumlu: randomUUID(), editor: randomUUID() };
const olarak = <T>(is: () => Promise<T>, rol: "yonetici" | "mevzuat_editoru" = "yonetici") => platformBaglamiylaCalistir({ kullaniciId: rol === "yonetici" ? ids.ben : ids.editor, eposta: "test@ornek.invalid", rol }, is);
const girdi = { sorumluId: ids.sorumlu, durum: "acik" as const, sonrakiGorusme: "2020-01-01", surum: 0 };

beforeAll(async () => {
  for (const id of [ids.firma, ids.diger]) await admin.tenant.create({ data: { id, unvan: `TAKIP-${id}`, vkn: id.replaceAll("-", "").slice(0, 10), vergiDairesi: "Test" } });
  for (const id of [ids.ben, ids.sorumlu, ids.editor]) await admin.platformKullanici.create({ data: { id, eposta: `${id}@ornek.invalid`, adSoyad: id === ids.ben ? "Kaydeden" : "Sorumlu", parolaHash: "x", totpSecretSifreli: "x", rol: id === ids.editor ? "mevzuat_editoru" : "yonetici" } });
});
afterAll(async () => {
  await admin.platformGorev.deleteMany({ where: { tenantId: { in: [ids.firma, ids.diger] } } });
  await admin.$executeRaw`DELETE FROM mevzuat_olaylari WHERE kullanici_id IN (${ids.ben}::uuid, ${ids.editor}::uuid)`;
  await admin.tenant.deleteMany({ where: { id: { in: [ids.firma, ids.diger] } } });
  await admin.platformKullanici.deleteMany({ where: { id: { in: [ids.ben, ids.sorumlu, ids.editor] } } });
  await Promise.all([admin.$disconnect(), db.$disconnect(), app.$disconnect()]);
});

describe("firma takibi — gerçek PostgreSQL ve roller", () => {
  it("kayıtsız firmada sürüm sıfır; olmayan firmada 404", async () => {
    expect(await olarak(() => service.getir(ids.firma))).toMatchObject({ surum: 0, sorumluId: null, gecikti: false });
    await expect(olarak(() => service.getir(randomUUID()))).rejects.toThrow("Firma bulunamadı");
  });
  it("takibi ve denetimi birlikte kaydeder, gecikme ve firma filtrelerini çalıştırır", async () => {
    expect(await olarak(() => service.guncelle(ids.firma, girdi))).toMatchObject({ surum: 1, sorumluAdi: "Sorumlu", gecikti: true });
    const olay = await admin.mevzuatOlay.findFirst({ where: { kullaniciId: ids.ben, olay: "firma_takibi_guncellendi" } });
    expect(olay?.detay).toMatchObject({ tenantId: ids.firma, onceki: { sorumluId: null }, yeni: { sorumluId: ids.sorumlu } });
    const liste = await firmalar.sayfali(firmaFiltreSemasi.parse({ firma: ids.firma, goster: "takibiGeciken" }));
    expect(liste.toplam).toBe(1);
    expect(liste.kayitlar[0].takip?.sonrakiGorusme).toBe("2020-01-01");
  });
  it("iki ilk yazım/güncellemeden yalnız biri kazanır, kaybedenin verisi yazılmaz", async () => {
    const sonuclar = await Promise.allSettled([
      olarak(() => service.guncelle(ids.diger, girdi)),
      olarak(() => service.guncelle(ids.diger, { ...girdi, durum: "bekliyor" })),
    ]);
    expect(sonuclar.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(sonuclar.filter((s) => s.status === "rejected")).toHaveLength(1);
    await expect(olarak(() => service.guncelle(ids.firma, girdi))).rejects.toThrow("başka biri");
  });
  it("editör/pasif/davetli sorumlu kabul etmez; sorumlusu pasif işi filtreler", async () => {
    await expect(olarak(() => service.guncelle(ids.firma, { ...girdi, surum: 1, sorumluId: ids.editor }))).rejects.toThrow("aktif bir platform yöneticisi");
    await admin.platformKullanici.update({ where: { id: ids.sorumlu }, data: { aktif: false } });
    expect(await olarak(() => service.getir(ids.firma))).toMatchObject({ sorumluUygun: false });
    expect((await firmalar.sayfali(firmaFiltreSemasi.parse({ firma: ids.firma, goster: "sorumluUygunDegil" }))).toplam).toBe(1);
    await expect(olarak(() => service.guncelle(ids.firma, { ...girdi, surum: 1 }))).rejects.toThrow("aktif bir platform yöneticisi");
    await admin.platformKullanici.update({ where: { id: ids.sorumlu }, data: { aktif: true, davetTuru: "iki_adim" } });
    await expect(olarak(() => service.guncelle(ids.firma, { ...girdi, surum: 1 }))).rejects.toThrow("aktif bir platform yöneticisi");
    await admin.platformKullanici.update({ where: { id: ids.sorumlu }, data: { davetTuru: null } });
  });
  it("not tekrarında çift kayıt/olay oluşturmaz, başka firmaya sızdırmaz", async () => {
    const g = { metin: "Firma iç notu", islemAnahtari: randomUUID() };
    const [bir, iki] = await Promise.all([olarak(() => service.notEkle(ids.firma, g)), olarak(() => service.notEkle(ids.firma, g))]);
    expect(bir.id).toBe(iki.id);
    expect((await olarak(() => service.notlar(ids.firma))).toplam).toBe(1);
    expect((await olarak(() => service.notlar(ids.diger))).toplam).toBe(0);
    expect(await admin.mevzuatOlay.count({ where: { kullaniciId: ids.ben, olay: "firma_notu_eklendi" } })).toBe(1);
    await expect(olarak(() => service.notEkle(ids.firma, { ...g, metin: "Farklı metin" }))).rejects.toThrow("farklı bir not");
  });
  it("olay yazımı hata verirse takip ve not geri alınır", async () => {
    const bozuk = { db: { $queryRaw: db.$queryRaw.bind(db), $transaction: (fn: (tx: unknown) => unknown) => db.$transaction(async (tx) => fn(new Proxy(tx, { get: (target, prop) => prop === "mevzuatOlay" ? { create: () => { throw new Error("olay yazılamadı"); } } : Reflect.get(target, prop) }))) } };
    const s = new PlatformFirmaTakipService(bozuk as never);
    await expect(olarak(() => s.guncelle(ids.firma, { ...girdi, surum: 1, durum: "tamamlandi" }))).rejects.toThrow("olay yazılamadı");
    expect(await olarak(() => service.getir(ids.firma))).toMatchObject({ surum: 1, durum: "acik" });
    await expect(olarak(() => s.notEkle(ids.firma, { metin: "Geri alınmalı", islemAnahtari: randomUUID() }))).rejects.toThrow("olay yazılamadı");
    expect((await olarak(() => service.notlar(ids.firma))).toplam).toBe(1);
  });
  it("firma görevini mevcut görev merkezine bağlar; mevzuata bağlamaz", async () => {
    const g = { baslik: "Firma görüşmesi", aciklama: null, kapsam: "platform" as const, oncelik: "normal" as const, sonTarih: null, sorumluId: ids.sorumlu, degisiklikId: null, tenantId: ids.firma };
    const gorev = await olarak(() => gorevler.olustur(g));
    expect(gorev.tenantId).toBe(ids.firma);
    const filtre = { durum: "hepsi" as const, arama: "", benim: false, geciken: false, sorumluPasif: false, sayfa: 1, firma: ids.firma };
    expect((await olarak(() => gorevler.listele(filtre))).toplam).toBe(1);
    expect((await olarak(() => gorevler.listele({ ...filtre, firma: ids.diger }))).toplam).toBe(0);
    await expect(olarak(() => gorevler.olustur({ ...g, kapsam: "mevzuat" }))).rejects.toThrow("yalnız platform görevine");
    await expect(olarak(() => gorevler.olustur({ ...g, tenantId: randomUUID() }))).rejects.toThrow(/firma bulunamadı/i);
    await olarak(() => gorevler.guncelle(gorev.id, { surum: 1, durum: "tamamlandi" }));
    const olaylar = await olarak(() => service.olaylar(ids.firma));
    expect(olaylar.kayitlar.some((o) => o.olay === "platform_gorevi_guncellendi")).toBe(true);
  });
  it("tamamlanan takibi gecikenler görünümünden çıkarır", async () => {
    await olarak(() => service.guncelle(ids.firma, { ...girdi, surum: 1, durum: "tamamlandi" }));
    expect((await firmalar.sayfali(firmaFiltreSemasi.parse({ firma: ids.firma, goster: "takibiGeciken" }))).toplam).toBe(0);
  });
  it("kiracı rolü ve editör iç notlara/takibe erişemez; notlar değiştirilemez", async () => {
    for (const tablo of ["platform_firma_takipleri", "platform_firma_notlari"]) await expect(app.$queryRawUnsafe(`SELECT * FROM ${tablo}`)).rejects.toThrow(/permission denied/);
    await expect(db.$executeRaw`UPDATE platform_firma_notlari SET metin = 'değiştir' WHERE tenant_id = ${ids.firma}::uuid`).rejects.toThrow(/permission denied/);
    await expect(db.$executeRaw`DELETE FROM platform_firma_notlari WHERE tenant_id = ${ids.firma}::uuid`).rejects.toThrow(/permission denied/);
    await expect(olarak(() => service.getir(ids.firma), "mevzuat_editoru")).rejects.toThrow("yöneticisi yetkisi");
    await expect(olarak(() => service.notlar(ids.firma), "mevzuat_editoru")).rejects.toThrow("yöneticisi yetkisi");
    expect(editorGorebilirMi("firma_notu_eklendi")).toBe(false);
    expect(editorGorebilirMi("firma_takibi_guncellendi")).toBe(false);
  });
});
