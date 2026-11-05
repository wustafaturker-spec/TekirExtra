import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { PrismaService } from "../src/core/prisma.service";
import { AbonelikOdemeService } from "../src/abonelik-odeme/abonelik-odeme.service";
import { AbonelikErisimService } from "../src/core/abonelik-erisim.service";
import { PAKET_MODUL_KODLARI, type PaketKapsamSozlesmesi } from "@tekirextra/shared";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PlatformFirmaIstisnaService } from "../src/mevzuat/platform-firma-istisna.service";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });
const servis = new PlatformFirmaIstisnaService({ db } as never), kisi = randomUUID(), firma = randomUUID();
const olarak = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: kisi, eposta: "istisna@kabul.invalid", rol: "yonetici" }, is);
it("kapsam onayı API ve doğrudan DB yazımında uygulanır; bitişte fazla kayıtlar korunur, yeni yazım durur", async () => {
  const tenantId = randomUUID();
  await admin.tenant.create({ data: { id: tenantId, unvan: "Süreli kapsam kabulü", vkn: "8199990002" } });
  const a = await admin.tenantAbonelik.create({ data: { tenantId, planKodu: "baslangic" } });
  const kapsamSozlesmesi: PaketKapsamSozlesmesi = { semaSurumu: 1, moduller: ["cari"], kotalar: { kullanici: { sinir: 3, uyariYuzdesi: 80 }, cari: { sinir: 300, uyariYuzdesi: 80 }, stok: { sinir: 0, uyariYuzdesi: 80 }, aylikFatura: { sinir: 100, uyariYuzdesi: 80 } } };
  const r = await olarak(() => servis.taslak({ tenantId, paketSurumId: a.paketSurumId!, neden: "Geçici ek cari kotası", baslangic: new Date(Date.now()-86400000).toISOString(), bitis: new Date(Date.now()+3600000).toISOString(), kapsamSozlesmesi }));
  await olarak(() => servis.onayla(tenantId, r.id));
  const erisim = new AbonelikErisimService(app);
  expect(await erisim.modulleriGetir(tenantId)).toEqual(["cari"]);
  await expect(app.tenantIslem(tenantId, (tx) => tx.stokKart.create({ data: { tenantId, kod: "KAPALI", ad: "Kapalı modül" } }))).rejects.toThrow("paket_modul_kapali:stok");
  await admin.cariHesap.createMany({ data: Array.from({ length: 251 }, (_, n) => ({ tenantId, kod: String(n), unvan: "Ek kota carisi", tip: "musteri" as const })) });
  await admin.$executeRaw`UPDATE platform_firma_istisna_taslaklari SET bitis=clock_timestamp()-interval '1 second' WHERE id=${r.id}::uuid`;
  expect(await erisim.modulleriGetir(tenantId)).toBeNull();
  await expect(app.tenantIslem(tenantId, (tx) => tx.cariHesap.create({ data: { tenantId, kod: "FAZLA", unvan: "Standart kotada fazla", tip: "musteri" } }))).rejects.toThrow("paket_kota_dolu:cari");
  expect(await admin.cariHesap.count({ where: { tenantId } })).toBe(251);
  expect((await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId } })).paketKosullari).toEqual(a.paketKosullari);
});
beforeAll(async () => {
  await admin.platformKullanici.create({ data: { id: kisi, eposta: `${kisi}@kabul.invalid`, adSoyad: "İstisna yönetici", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  await admin.tenant.create({ data: { id: firma, unvan: "İstisna kabul", vkn: "8199990001" } });
  await admin.tenantAbonelik.create({ data: { tenantId: firma, planKodu: "v1" } });
});

it("özel fiyat onayda yeni ödemeye geçer, süre sonunda döner ve eski ödeme fotoğrafı korunur", async () => {
  const kaynak = await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } });
  const kosullar = kaynak.paketKosullari as { fiyatlandirma: { paraBirimi: "TRY"; vergiDahil: false; kdvOrani: string; donemler: { aySayisi: 1 | 3 | 6 | 12; matrah: string }[] } };
  await admin.user.create({ data: { tenantId: firma, eposta: `${randomUUID()}@kabul.invalid`, adSoyad: "Fiyat kabul", parolaHash: "x", rol: "yonetici" } });
  const odeme = new AbonelikOdemeService(app, { etkin: async () => ({ saglayici: "iyzico", ortam: "test", config: {} }) } as never, { db: { mevzuatOlay: { create: vi.fn() } } } as never, { unut: vi.fn() } as never);
  odeme.saglayiciUret = () => ({ odemeBaslat: async (g: { denemeId: string }) => ({ token: g.denemeId, odemeSayfasiUrl: "https://kabul.invalid" }) }) as never;
  const eski = await odeme.baslat(firma, 1, "panel", null);
  const eskiKayit = await admin.abonelikOdemeDenemesi.findUniqueOrThrow({ where: { id: eski.denemeId } });
  const g = { tenantId: firma, paketSurumId: kaynak.paketSurumId!, neden: "Süreli özel fiyat kabulü", baslangic: new Date(Date.now()-172800000).toISOString(), bitis: new Date(Date.now()+3600000).toISOString(), fiyatlandirma: { ...kosullar.fiyatlandirma, donemler: kosullar.fiyatlandirma.donemler.map((d) => ({ ...d, matrah: String(100*d.aySayisi) })) } };
  const r = await olarak(() => servis.taslak(g));
  expect(await olarak(() => servis.fiyatOnayla(firma, r.id))).toEqual({ tekrar: false, durum: "onaylandi" });
  expect(await olarak(() => servis.fiyatOnayla(firma, r.id))).toMatchObject({ tekrar: true });
  const yeni = await odeme.baslat(firma, 1, "panel", null);
  expect(await admin.abonelikOdemeDenemesi.findUniqueOrThrow({ where: { id: yeni.denemeId } })).toMatchObject({ toplam: new (await import("@prisma/client")).Prisma.Decimal("120.00") });
  expect(await admin.abonelikOdemeDenemesi.findUniqueOrThrow({ where: { id: eski.denemeId } })).toEqual(eskiKayit);
  expect((await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } })).paketKosullari).toEqual(kaynak.paketKosullari);
  await expect(admin.tenantAbonelik.update({ where: { tenantId: firma }, data: { planKodu: "profesyonel" } })).rejects.toThrow("istisna_onayli_fiyat");
  await admin.$executeRaw`UPDATE platform_firma_istisna_taslaklari SET bitis=clock_timestamp()-interval '1 second' WHERE id=${r.id}::uuid`;
  const sonra = await odeme.baslat(firma, 1, "panel", null);
  const sonKayit = await admin.abonelikOdemeDenemesi.findUniqueOrThrow({ where: { id: sonra.denemeId } });
  expect(sonKayit.toplam.toFixed(2)).toBe(eskiKayit.toplam.toFixed(2));
});
afterAll(async () => { await Promise.all([admin.$disconnect(), db.$disconnect(), app.$disconnect()]); });

it("ileri başlangıç bekler; etkin iptal eski Repeatable Read yazıcısını durdurur ve standart kotaya döner", async () => {
  const tenantId = randomUUID();
  await admin.tenant.create({ data: { id: tenantId, unvan: "İstisna iptal yarışı", vkn: "8199990003" } });
  const a = await admin.tenantAbonelik.create({ data: { tenantId, planKodu: "baslangic" } });
  const kapsamSozlesmesi: PaketKapsamSozlesmesi = { semaSurumu: 1, moduller: ["cari"], kotalar: { kullanici: { sinir: 3, uyariYuzdesi: 80 }, cari: { sinir: 300, uyariYuzdesi: 80 }, stok: { sinir: 0, uyariYuzdesi: 80 }, aylikFatura: { sinir: 100, uyariYuzdesi: 80 } } };
  const r = await olarak(() => servis.taslak({ tenantId, paketSurumId: a.paketSurumId!, neden: "İleri tarih ve iptal yarışı", baslangic: new Date(Date.now()+86400000).toISOString(), bitis: new Date(Date.now()+172800000).toISOString(), kapsamSozlesmesi }));
  await olarak(() => servis.onayla(tenantId, r.id));
  const erisim = new AbonelikErisimService(app);
  expect(await erisim.modulleriGetir(tenantId)).toBeNull();
  await admin.$executeRaw`UPDATE platform_firma_istisna_taslaklari SET baslangic=clock_timestamp()-interval '1 second' WHERE id=${r.id}::uuid`;
  expect(await erisim.modulleriGetir(tenantId)).toEqual(["cari"]);
  await admin.cariHesap.createMany({ data: Array.from({ length: 251 }, (_, n) => ({ tenantId, kod: String(n), unvan: "İptal öncesi cari", tip: "musteri" as const })) });
  await expect(admin.$transaction(async (tx) => {
    await tx.tenantAbonelik.findUniqueOrThrow({ where: { tenantId } });
    await olarak(() => servis.iptal(tenantId, r.id, "Etkin koşullar iptal edildi"));
    await tx.cariHesap.create({ data: { tenantId, kod: "ESKI", unvan: "Eski görünüm", tip: "musteri" } });
  }, { isolationLevel: "RepeatableRead", timeout: 10000 })).rejects.toMatchObject({ code: "P2034" });
  expect(await erisim.modulleriGetir(tenantId)).toBeNull();
  await expect(admin.cariHesap.create({ data: { tenantId, kod: "YENI", unvan: "Yeni görünüm", tip: "musteri" } })).rejects.toThrow("paket_kota_dolu:cari");
  expect(await admin.cariHesap.count({ where: { tenantId } })).toBe(251);
});

it("önizlemeden sonra kullanım artarsa onay koşulları yeniden denetler", async () => {
  const tenantId = randomUUID();
  await admin.tenant.create({ data: { id: tenantId, unvan: "Onay öncesi kullanım", vkn: "8199990004" } });
  const a = await admin.tenantAbonelik.create({ data: { tenantId, planKodu: "baslangic" } });
  const kapsamSozlesmesi: PaketKapsamSozlesmesi = { semaSurumu: 1, moduller: ["cari"], kotalar: { kullanici: { sinir: 3, uyariYuzdesi: 80 }, cari: { sinir: 0, uyariYuzdesi: 80 }, stok: { sinir: 0, uyariYuzdesi: 80 }, aylikFatura: { sinir: 100, uyariYuzdesi: 80 } } };
  const r = await olarak(() => servis.taslak({ tenantId, paketSurumId: a.paketSurumId!, neden: "Onayda güncel kullanım", baslangic: new Date(Date.now()-1000).toISOString(), bitis: new Date(Date.now()+3600000).toISOString(), kapsamSozlesmesi }));
  expect(await olarak(() => servis.uygunluk(tenantId, r.id))).toMatchObject({ kosullarUygun: true });
  await admin.cariHesap.create({ data: { tenantId, kod: "SONRA", unvan: "Sonradan eklenen", tip: "musteri" } });
  await expect(olarak(() => servis.onayla(tenantId, r.id))).rejects.toThrow("Güncel kullanım");
  const [kayit] = await admin.$queryRaw<{ onay_at: Date | null }[]>`SELECT onay_at FROM platform_firma_istisna_taslaklari WHERE id=${r.id}::uuid`;
  expect(kayit.onay_at).toBeNull();
});

it("taslak koşulları korur; çakışmayı ve app erişimini engeller, iptal tekrar güvenlidir", async () => {
  const iptalOnce = await admin.mevzuatOlay.count({ where: { kullaniciId: kisi, olay: "firma_istisna_taslagi_iptal" } });
  const [sayim] = await admin.$queryRaw<{ adet: bigint }[]>`SELECT count(*) AS adet FROM platform_firma_istisna_taslaklari WHERE tenant_id=${firma}::uuid`;
  const once = await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } });
  expect(await olarak(() => servis.kaynak(firma))).toMatchObject({ paketSurumId: once.paketSurumId, kosullar: once.paketKosullari });
  const kapsam: PaketKapsamSozlesmesi = { semaSurumu: 1, moduller: [...PAKET_MODUL_KODLARI], kotalar: {
    kullanici: { sinir: 20, uyariYuzdesi: 80 }, cari: { sinir: 3000, uyariYuzdesi: 80 }, stok: { sinir: 6000, uyariYuzdesi: 80 }, aylikFatura: { sinir: 2000, uyariYuzdesi: 80 },
  } };
  const g = { tenantId: firma, paketSurumId: once.paketSurumId!, neden: "Firma için özel koşul hazırlığı", baslangic: new Date(Date.now()+86400000).toISOString(), bitis: new Date(Date.now()+172800000).toISOString(), kapsamSozlesmesi: kapsam };
  const r = await olarak(() => servis.taslak(g));
  expect(r).toMatchObject({ durum: "taslak", uygulamaEntegrasyonu: false, hedef: { limitler: { kullanici: 20 } } });
  expect(await olarak(() => servis.uygunluk(firma, r.id))).toMatchObject({ kosullarUygun: true, engeller: [], uygulamaEntegrasyonu: false });
  await admin.tenantAbonelik.update({ where: { tenantId: firma }, data: { durum: "askida" } });
  expect(await olarak(() => servis.uygunluk(firma, r.id))).toMatchObject({ kosullarUygun: false, engeller: ["abonelik_uygun_degil"] });
  await admin.tenantAbonelik.update({ where: { tenantId: firma }, data: { durum: "aktif", updatedAt: once.updatedAt } });
  expect(await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } })).toEqual(once);
  await expect(olarak(() => servis.taslak(g))).rejects.toThrow("başka bir istisna");
  expect(await olarak(() => servis.listele(firma, 100))).toMatchObject({ toplam: Number(sayim.adet) + 1, kayitlar: [] });
  await expect(app.$queryRaw`SELECT * FROM platform_firma_istisna_taslaklari`).rejects.toThrow();
  await expect(db.$executeRaw`DELETE FROM platform_firma_istisna_taslaklari`).rejects.toThrow();
  expect(await olarak(() => servis.iptal(firma, r.id, "Hazırlık iptal edildi"))).toEqual({ tekrar: false });
  expect(await olarak(() => servis.iptal(firma, r.id, "Hazırlık iptal edildi"))).toEqual({ tekrar: true });
  expect(await olarak(() => servis.uygunluk(firma, r.id))).toMatchObject({ kosullarUygun: false, engeller: ["iptal_edildi"] });
  const yeni = await olarak(() => servis.taslak({ ...g, kapsamSozlesmesi: { ...kapsam, kotalar: { ...kapsam.kotalar, cari: { sinir: 0, uyariYuzdesi: 80 } } } }));
  await admin.cariHesap.create({ data: { tenantId: firma, kod: "ISTISNA", unvan: "Kota kontrolü", tip: "musteri" } });
  expect(await olarak(() => servis.uygunluk(firma, yeni.id))).toMatchObject({ kosullarUygun: false, engeller: ["kota_asimi:cari"], kullanim: { cari: 1 } });
  await expect(app.$queryRaw`SELECT platform_firma_istisna_uygunluk(${kisi}::uuid,${firma}::uuid,${yeni.id}::uuid)`).rejects.toThrow();
  expect(await admin.mevzuatOlay.count({ where: { kullaniciId: kisi, olay: "firma_istisna_taslagi_iptal" } })).toBe(iptalOnce + 1);
});
