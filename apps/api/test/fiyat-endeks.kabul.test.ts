import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Rol } from "@tekirextra/shared";

/**
 * END-24 kabul testi: gerçek PostgreSQL (uygulama rolü, RLS). İki firma;
 * kesinleşmede fiyat listesi izi ve fiyat geçmişi tetikleyicileri, ortak
 * endeks tablolarının yetkileri, ürün karşılaştırması, rol ayarı, plan
 * özelliği ve toplu rapor. Plan özelliğinin paket sözleşmesinden okunması
 * birim testinde (CNL-19) sınandığı için burada firma kümesiyle taklit edilir.
 */
const planAcik = new Set<string>();
vi.mock("../src/core/abonelik-erisim.service", async (asil) => ({
  ...(await asil<typeof import("../src/core/abonelik-erisim.service")>()),
  planOzelligiAcik: async (_tx: unknown, tenantId: string) => planAcik.has(tenantId),
}));

const { PrismaService } = await import("../src/core/prisma.service");
const { baglamlaCalistir } = await import("../src/core/istek-baglami");
const { FiyatEndeksService } = await import("../src/fiyat-endeks/fiyat-endeks.service");
const { aylikToplamlar } = await import("../src/fiyat-endeks/fiyat-endeks-veri");
const { raporTanimiAl } = await import("../src/core/raporlar/rapor-kayit");
const { degerleriYaz } = await import("../src/fiyat-endeks/endeks-deposu");
const { endeksVerisi } = await import("../src/fiyat-endeks/fiyat-endeks-veri");
await import("../src/fiyat-endeks/fiyat-endeks.raporlar");
await import("../src/fiyat-endeks/fiyat-endeks-makas.raporlar");

const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const prisma = new PrismaService();
const servis = new FiyatEndeksService(prisma);
const ek = String(Date.now()).slice(-9);
const SERI = `KABUL${ek}`;
const KUR = `KABULKUR${ek}`;
const A = { tenant: randomUUID(), yonetici: randomUUID(), satis: randomUUID(), liste: randomUUID(), cariListeli: randomUUID(), cariListesiz: randomUUID(), stok: randomUUID() };
const B = { tenant: randomUUID(), yonetici: randomUUID(), cari: randomUUID(), stok: randomUUID() };

const ile = <T>(tenantId: string, userId: string, rol: Rol, is: () => Promise<T>) => baglamlaCalistir({ tenantId, userId, rol }, is);
const ay = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function fatura(tenantId: string, cariId: string, stokId: string, tarih: string, satirlar: { miktar: string; birim?: string; matrah: string }[], durum: "kesin" | "taslak" | "iptal" = "kesin", tip: "satis" | "alis" = "satis") {
  const toplam = satirlar.reduce((t, s) => t.add(s.matrah), new Prisma.Decimal(0)).toString();
  return yonetim.fatura.create({ data: {
    tenantId, cariId, tip, durum, tarih: ay(tarih),
    toplamBrut: toplam, toplamMatrah: toplam, genelToplam: toplam, toplamSatirIskontosu: "0", genelIskontoToplam: "0", toplamKdv: "0", toplamTevkifat: "0", toplamNetKdv: "0",
    satirlar: { create: satirlar.map((s) => ({ tenantId, stokId, miktar: s.miktar, birim: s.birim ?? "adet", birimFiyat: "0", matrah: s.matrah, toplamTutar: s.matrah, kdvTutari: "0", netKdvTutari: "0" })) },
  } });
}

beforeAll(async () => {
  for (const [f, unvan] of [[A, "Endeks Alfa"], [B, "Endeks Beta"]] as const) {
    await yonetim.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${f.tenant}::uuid, ${unvan}, ${String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-10)}, now(), now())`;
  }
  for (const [tenant, id, rol] of [[A.tenant, A.yonetici, "yonetici"], [A.tenant, A.satis, "satis"], [B.tenant, B.yonetici, "yonetici"]] as const) {
    await yonetim.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${id}::uuid, ${tenant}::uuid, ${`end-${id}@test.local`}, 'x', ${`Endeks ${rol}`}, ${rol}::"Rol", now())`;
  }
  await yonetim.fiyatListesi.create({ data: { id: A.liste, tenantId: A.tenant, ad: `Bayi ${ek}` } });
  await yonetim.cariHesap.createMany({ data: [
    { id: A.cariListeli, tenantId: A.tenant, kod: "C1", unvan: "Listeli müşteri", tip: "musteri", fiyatListesiId: A.liste },
    { id: A.cariListesiz, tenantId: A.tenant, kod: "C2", unvan: "Listesiz müşteri", tip: "musteri" },
    { id: B.cari, tenantId: B.tenant, kod: "C1", unvan: "Beta müşteri", tip: "musteri" },
  ] });
  await yonetim.stokKart.createMany({ data: [
    { id: A.stok, tenantId: A.tenant, kod: "U1", ad: "Ürün alfa", tip: "urun", anaBirim: "adet" },
    { id: B.stok, tenantId: B.tenant, kod: "U1", ad: "Ürün beta", tip: "urun", anaBirim: "adet" },
  ] });
  await yonetim.stokBirim.create({ data: { tenantId: A.tenant, stokId: A.stok, ad: "koli", katsayi: "12" } });
  await yonetim.endeksSerisi.create({ data: { kod: SERI, evdsKodu: `TP.KABUL.${ek}`, ad: "Kabul endeksi", bazYili: "2026=100" } });
  await yonetim.endeksDegeri.createMany({ data: [["2026-01-01", "100"], ["2026-02-01", "110"], ["2026-03-01", "120"]].map(([d, v]) => ({ seriKodu: SERI, donem: ay(d), deger: v })) });

  // Ocak (liste): 10 adet × 100 + 1 koli (12 adet) 1320 → 2320 / 22 adet.
  await fatura(A.tenant, A.cariListeli, A.stok, "2026-01-10", [{ miktar: "10", matrah: "1000" }, { miktar: "1", birim: "koli", matrah: "1320" }]);
  // Şubat (liste): taslak açılır, uygulama rolüyle kesinleşir → tetikleyici liste izini yazar.
  const taslak = await fatura(A.tenant, A.cariListeli, A.stok, "2026-02-10", [{ miktar: "10", matrah: "1100" }, { miktar: "10", matrah: "1100" }], "taslak");
  await prisma.tenantIslem(A.tenant, (tx) => tx.fatura.update({ where: { id: taslak.id }, data: { durum: "kesin" } }));
  // Şubat iptal (girmez), tanımsız birim (girmez, sayılır), bedelsiz satır (girmez).
  await fatura(A.tenant, A.cariListeli, A.stok, "2026-02-12", [{ miktar: "1", matrah: "99999" }, { miktar: "1", matrah: "99999" }], "iptal");
  await fatura(A.tenant, A.cariListesiz, A.stok, "2026-02-15", [{ miktar: "1", birim: "palet", matrah: "5000" }, { miktar: "5", matrah: "0" }]);
  // Mart (listesiz cari): 2 × 10 adet × 125.
  await fatura(A.tenant, A.cariListesiz, A.stok, "2026-03-05", [{ miktar: "10", matrah: "1250" }, { miktar: "10", matrah: "1250" }]);
  // Beta: çok yüksek fiyat; Alfa'nın hiçbir hesabına girmemeli.
  await fatura(B.tenant, B.cari, B.stok, "2026-01-10", [{ miktar: "1", matrah: "777777" }, { miktar: "1", matrah: "777777" }]);
  planAcik.add(A.tenant);
});

afterAll(async () => {
  await yonetim.endeksSerisi.deleteMany({ where: { kod: { in: [SERI, KUR] } } });
  await yonetim.$disconnect();
  await prisma.$disconnect();
});

describe("END-27 tetikleyicileri", () => {
  it("kesinleşen fatura carinin o anki listesini taşır; cari listesi sonradan değişse de iz kalır", async () => {
    const faturalar = await yonetim.fatura.findMany({ where: { tenantId: A.tenant, durum: "kesin" }, select: { cariId: true, fiyatListesiId: true } });
    expect(faturalar.filter((f) => f.cariId === A.cariListeli).every((f) => f.fiyatListesiId === A.liste)).toBe(true);
    expect(faturalar.filter((f) => f.cariId === A.cariListesiz).every((f) => f.fiyatListesiId === null)).toBe(true);
    await yonetim.cariHesap.update({ where: { id: A.cariListeli }, data: { fiyatListesiId: null } });
    const satirlar = await prisma.tenantIslem(A.tenant, (tx) => aylikToplamlar(tx, { taraf: "satis", baslangic: "2026-01-01", bitisHaric: "2026-04-01", listeler: [A.liste] }));
    expect(satirlar.map((s) => s.ay).sort()).toEqual(["2026-01-01", "2026-02-01"]);
    expect(satirlar.every((s) => s.bugunkuListe === 0)).toBe(true);
    await yonetim.cariHesap.update({ where: { id: A.cariListeli }, data: { fiyatListesiId: A.liste } });
  });

  it("liste fiyatı eklenip değişince geçmişe yazılır; başka firma göremez", async () => {
    await prisma.tenantIslem(A.tenant, async (tx) => {
      await tx.fiyatListesiKalem.create({ data: { tenantId: A.tenant, listeId: A.liste, stokId: A.stok, fiyat: "100" } });
      await tx.fiyatListesiKalem.updateMany({ where: { listeId: A.liste, stokId: A.stok }, data: { fiyat: "115.5" } });
      await tx.fiyatListesiKalem.updateMany({ where: { listeId: A.liste, stokId: A.stok }, data: { fiyat: "115.5" } });
    });
    const gecmis = await prisma.tenantIslem(A.tenant, (tx) => tx.fiyatListesiFiyatGecmisi.findMany({ where: { listeId: A.liste }, orderBy: { degistiAt: "asc" } }));
    expect(gecmis.map((g) => [g.eskiFiyat?.toString() ?? null, g.yeniFiyat.toString()])).toEqual([[null, "100"], ["100", "115.5"]]);
    expect(await prisma.tenantIslem(B.tenant, (tx) => tx.fiyatListesiFiyatGecmisi.count())).toBe(0);
  });
});

describe("ortak endeks tablolarının yetkisi", () => {
  it("uygulama rolü katalog yazamaz, yalnız çekim durumunu ve değeri yazar", async () => {
    await expect(prisma.endeksSerisi.create({ data: { kod: `X${ek}`, evdsKodu: `TP.X.${ek}`, ad: "Yetkisiz" } })).rejects.toThrow();
    await expect(prisma.endeksSerisi.update({ where: { kod: SERI }, data: { ad: "Değişti" } })).rejects.toThrow();
    await prisma.endeksSerisi.update({ where: { kod: SERI }, data: { sonHata: null, sonCekimAt: new Date() } });
    await prisma.endeksDegeri.upsert({ where: { seriKodu_donem: { seriKodu: SERI, donem: ay("2026-04-01") } }, create: { seriKodu: SERI, donem: ay("2026-04-01"), deger: "125" }, update: {} });
    await expect(prisma.endeksDegeri.deleteMany({ where: { seriKodu: SERI } })).rejects.toThrow();
  });
});

describe("ürün karşılaştırması", () => {
  const sorgu = { baslangic: "2026-01", bitis: "2026-03", endeksler: [SERI], satisKapsami: "tum" as const, listeler: [], alis: false };

  it("tüm satışlar: ağırlıklı ortalama, iptal/bedelsiz/birimsiz dışarıda, reel değişim doğru", async () => {
    const r = await ile(A.tenant, A.yonetici, "yonetici", () => servis.urun(A.stok, sorgu));
    const s = r.seriler[0];
    expect(s.satirlar.map((x) => x.fiyat)).toEqual(["105.4545", "110.0000", "125.0000"]);
    expect(s.karsilastirmalar[0]).toMatchObject({ sonAy: "2026-03-01", fiyatDegisim: "18.53", endeksDegisim: "20.00", reelDegisim: "-1.22", olmasiGerekenFiyat: "126.5455", fark: "-1.5455" });
    expect(r.uyarilar.join(" ")).toMatch(/1 fatura satırının birimi/);
    expect(r.endeksler[0].degerler.map((d) => d.normal)).toEqual(["100.00", "110.00", "120.00"]);
  });

  it("fiyat listesine göre: yalnız listeli carinin satışları", async () => {
    const r = await ile(A.tenant, A.yonetici, "yonetici", () => servis.urun(A.stok, { ...sorgu, satisKapsami: "liste", listeler: [A.liste] }));
    expect(r.seriler).toHaveLength(1);
    expect(r.seriler[0].satirlar.map((x) => x.durum)).toEqual(["tamam", "tamam", "yok"]);
    expect(r.seriler[0].karsilastirmalar[0]).toMatchObject({ sonAy: "2026-02-01", fiyatDegisim: "4.31", endeksDegisim: "10.00" });
  });

  it("başka firmanın ürünü bulunamaz; toplamlar firma dışına taşmaz", async () => {
    await expect(ile(A.tenant, A.yonetici, "yonetici", () => servis.urun(B.stok, sorgu))).rejects.toThrow(/bulunamadı/);
    const hepsi = await prisma.tenantIslem(A.tenant, (tx) => aylikToplamlar(tx, { taraf: "satis", baslangic: "2026-01-01", bitisHaric: "2026-04-01" }));
    expect(new Set(hepsi.map((h) => h.stokId))).toEqual(new Set([A.stok]));
  });

  it("rol erişimini yönetici belirler; alış tarafı ayrı açılır", async () => {
    await expect(ile(A.tenant, A.satis, "satis", () => servis.urun(A.stok, sorgu))).rejects.toThrow(/erişiminiz yok/);
    await yonetim.modulAyar.upsert({ where: { tenantId_modul: { tenantId: A.tenant, modul: "fiyat_endeks" } }, create: { tenantId: A.tenant, modul: "fiyat_endeks", ayarlar: { satisRolleri: ["satis"], alisRolleri: ["muhasebe"] } }, update: { ayarlar: { satisRolleri: ["satis"], alisRolleri: ["muhasebe"] } } });
    const r = await ile(A.tenant, A.satis, "satis", () => servis.urun(A.stok, { ...sorgu, alis: true }));
    expect(r.seriler.map((s) => s.taraf)).toEqual(["satis"]);
    expect(r.uyarilar.join(" ")).toMatch(/Alış fiyatı tarafına erişiminiz olmadığı/);
  });

  it("plan özelliği kapalı firmada açılmaz", async () => {
    await expect(ile(B.tenant, B.yonetici, "yonetici", () => servis.urun(B.stok, sorgu))).rejects.toThrow(/abonelik planınızda açık değil/);
    await expect(ile(B.tenant, B.yonetici, "yonetici", () => servis.secenekler())).rejects.toThrow(/abonelik planınızda açık değil/);
  });
});

describe("endeks ucu (END-21)", () => {
  it("aylık değer ve değişimler uygulamada hesaplanır; plan özelliği kapalı firmada açılmaz", async () => {
    const r = await ile(A.tenant, A.yonetici, "yonetici", () => servis.endeks(SERI, { baslangic: "2026-01", bitis: "2026-03" }));
    expect(r.degerler.map((d) => [d.ay, d.deger, d.aylikDegisim])).toEqual([["2026-01", "100.0000", null], ["2026-02", "110.0000", "10.00"], ["2026-03", "120.0000", "9.09"]]);
    expect(r.ozet).toMatchObject({ ilkAy: "2026-01", sonAy: "2026-03", donemDegisimi: "20.00" });
    await expect(ile(B.tenant, B.yonetici, "yonetici", () => servis.endeks(SERI, { baslangic: "2026-01", bitis: "2026-03" }))).rejects.toThrow(/abonelik planınızda açık değil/);
    await expect(ile(A.tenant, A.yonetici, "yonetici", () => servis.endeks(SERI, { baslangic: "2026-03", bitis: "2026-01" }))).rejects.toThrow(/sonra olamaz/);
  });
});

describe("ek fiyat çizgileri (END-07)", () => {
  const sorgu = { baslangic: "2026-01", bitis: "2026-03", endeksler: [SERI], satisKapsami: "tum" as const, listeler: [], alis: false };
  it("kart fiyatı yatay referans; liste geçmişi dönemden sonra başladıysa boş; maliyet ve son alış aylık", async () => {
    const depo = randomUUID();
    await yonetim.depo.create({ data: { id: depo, tenantId: A.tenant, kod: "D1", ad: "Ana depo" } });
    await yonetim.stokKart.update({ where: { id: A.stok }, data: { satisFiyati: "120" } });
    // Şubat çıkışları: (10×80 + 30×90) / 40 = 87,5; giriş ve maliyetsiz çıkış girmez.
    await yonetim.stokHareket.createMany({ data: [
      { tenantId: A.tenant, stokId: A.stok, depoId: depo, tip: "cikis", miktar: "-10", girilenBirim: "adet", girilenMiktar: "10", maliyet: "80", tarih: ay("2026-02-05") },
      { tenantId: A.tenant, stokId: A.stok, depoId: depo, tip: "cikis", miktar: "-30", girilenBirim: "adet", girilenMiktar: "30", maliyet: "90", tarih: ay("2026-02-20") },
      { tenantId: A.tenant, stokId: A.stok, depoId: depo, tip: "giris", miktar: "50", girilenBirim: "adet", girilenMiktar: "50", maliyet: "60", tarih: ay("2026-02-01") },
      { tenantId: A.tenant, stokId: A.stok, depoId: depo, tip: "cikis", miktar: "-5", girilenBirim: "adet", girilenMiktar: "5", maliyet: "0", tarih: ay("2026-03-01") },
    ] });
    // Alışlar: Aralık 2025 70/adet (başlangıç değeri), Şubat 1 koli 960 → 80/adet; Mart'a taşınır.
    await fatura(A.tenant, A.cariListesiz, A.stok, "2025-12-15", [{ miktar: "10", matrah: "700" }], "kesin", "alis");
    await fatura(A.tenant, A.cariListesiz, A.stok, "2026-02-03", [{ miktar: "1", birim: "koli", matrah: "960" }], "kesin", "alis");
    await fatura(A.tenant, A.cariListesiz, A.stok, "2026-02-25", [{ miktar: "1", matrah: "5" }], "taslak", "alis");

    const r = await ile(A.tenant, A.yonetici, "yonetici", () => servis.urun(A.stok, { ...sorgu, cizgiler: ["liste", "maliyet", "sonAlis"] }));
    expect(r.ekCizgiOlcegi).toEqual({ seri: "Satış fiyatı (tüm satışlar)", bazFiyat: "105.4545" });
    const c = Object.fromEntries(r.ekCizgiler.map((x) => [x.anahtar, x]));
    expect(c["liste:kart"]).toMatchObject({ yatay: true });
    expect(c["liste:kart"].degerler.map((d) => d.normal)).toEqual(["113.79", "113.79", "113.79"]);
    expect(c.maliyet.degerler.map((d) => d.fiyat)).toEqual([null, "87.5000", null]);
    expect(c.sonAlis.degerler.map((d) => d.fiyat)).toEqual(["70.0000", "80.0000", "80.0000"]);

    // Liste kapsamı: geçmiş bugün başladı (END-27 testi), Ocak–Mart boş ve yatay değil.
    const l = await ile(A.tenant, A.yonetici, "yonetici", () => servis.urun(A.stok, { ...sorgu, satisKapsami: "liste", listeler: [A.liste], cizgiler: ["liste"] }));
    expect(l.ekCizgiler[0]).toMatchObject({ anahtar: `liste:${A.liste}`, yatay: false });
    expect(l.ekCizgiler[0].degerler.every((d) => d.fiyat === null)).toBe(true);

    // Alış erişimi olmayan rol maliyet ve son alışı göremez.
    const sat = await ile(A.tenant, A.satis, "satis", () => servis.urun(A.stok, { ...sorgu, cizgiler: ["liste", "maliyet", "sonAlis"] }));
    expect(sat.ekCizgiler.map((x) => x.anahtar)).toEqual(["liste:kart"]);
    expect(sat.uyarilar.join(" ")).toMatch(/Maliyet ve son alış fiyatı alış tarafındadır/);
  });
});

describe("marj makası ve tedarikçi zam denetimi (END-13/14)", () => {
  const eklenenYiufe: Date[] = [];
  afterAll(async () => { await yonetim.endeksDegeri.deleteMany({ where: { seriKodu: "YIUFE", donem: { in: eklenenYiufe } } }); });
  it("maliyeti satıştan hızlı artan ürün eşikle işaretlenir; dövizde sabit fiyatın TL artışı kur etkisi sayılır", async () => {
    // Ocak ve Mart alışları: TL 10 adet × 90 ve USD 10 adet × 3 USD (kur 30) → 90/adet; Mart 120/adet (USD kur 40).
    await fatura(A.tenant, A.cariListesiz, A.stok, "2026-01-20", [{ miktar: "10", matrah: "900" }], "kesin", "alis");
    await fatura(A.tenant, A.cariListesiz, A.stok, "2026-03-20", [{ miktar: "10", matrah: "1200" }], "kesin", "alis");
    for (const [tarih, kur] of [["2026-01-21", "30"], ["2026-03-21", "40"]] as const) {
      await yonetim.fatura.create({ data: { tenantId: A.tenant, cariId: A.cariListeli, tip: "alis", durum: "kesin", tarih: ay(tarih), dovizCinsi: "USD", kur,
        toplamBrut: "30", toplamMatrah: "30", genelToplam: "30", toplamSatirIskontosu: "0", genelIskontoToplam: "0", toplamKdv: "0", toplamTevkifat: "0", toplamNetKdv: "0",
        satirlar: { create: [{ tenantId: A.tenant, stokId: A.stok, miktar: "10", birim: "adet", birimFiyat: "3", matrah: "30", toplamTutar: "30", kdvTutari: "0", netKdvTutari: "0" }] } } });
    }
    for (const [d, v] of [["2026-01-01", "100"], ["2026-03-01", "110"]] as const) {
      if (!(await yonetim.endeksDegeri.findUnique({ where: { seriKodu_donem: { seriKodu: "YIUFE", donem: ay(d) } } }))) {
        await yonetim.endeksDegeri.create({ data: { seriKodu: "YIUFE", donem: ay(d), deger: v } }); eklenenYiufe.push(ay(d));
      }
    }
    const calistir = (kod: string, filtreler: Record<string, string | boolean>, userId = A.yonetici, rol: Rol = "yonetici") =>
      ile(A.tenant, userId, rol, () => prisma.tenantIslem(A.tenant, (tx) => raporTanimiAl(kod)!.calistir({ filtreler }, { tenantId: A.tenant, tx })));

    const makas = await calistir("stok.marj_makasi", { baslangic: "2026-01-01", bitis: "2026-03-31" });
    expect(makas).toHaveLength(1);
    expect(makas[0]).toMatchObject({ stokId: A.stok, bazAy: "2026-01", sonAy: "2026-03", bazSatis: "105.4545", sonSatis: "125.0000", bazMaliyet: "90.0000", sonMaliyet: "120.0000",
      satisDegisim: "18.53", maliyetDegisim: "33.33", makas: "14.80", bazMarj: "14.66", sonMarj: "4.00", marjDegisim: "-10.66", durum: "Maliyet satış fiyatından hızlı arttı (eşik 10 puan)" });
    // Eşik kiracı ayarıdır.
    const ayar = await yonetim.modulAyar.findUniqueOrThrow({ where: { tenantId_modul: { tenantId: A.tenant, modul: "fiyat_endeks" } } });
    await yonetim.modulAyar.update({ where: { id: ayar.id }, data: { ayarlar: { ...(ayar.ayarlar as object), makasEsigi: 20 } } });
    expect(await calistir("stok.marj_makasi", { baslangic: "2026-01-01", bitis: "2026-03-31", yalnizEsikUstu: true })).toEqual([]);
    await yonetim.modulAyar.update({ where: { id: ayar.id }, data: { ayarlar: ayar.ayarlar as object } });
    // Satış rolünün alış erişimi yok (önceki testte yalnız satış tarafı açıldı).
    await expect(calistir("stok.marj_makasi", { baslangic: "2026-01-01", bitis: "2026-03-31" }, A.satis, "satis")).rejects.toThrow(/Alış fiyatı ve maliyet/);

    const zam = await calistir("stok.tedarikci_zam", { baslangic: "2026-01-01", bitis: "2026-03-31" });
    const tl = zam.find((z) => z.dovizCinsi === "TRY"), usd = zam.find((z) => z.dovizCinsi === "USD");
    expect(tl).toMatchObject({ cariId: A.cariListesiz, bazAy: "2026-01", sonAy: "2026-03", bazFiyat: "90.0000", sonFiyat: "120.0000", tlDegisim: "33.33", endeksDegisim: "10.00", endeksFarki: "23.33", dovizDegisim: null, durum: "Endeksin üzerinde zam" });
    expect(usd).toMatchObject({ cariId: A.cariListeli, tlDegisim: "33.33", dovizDegisim: "0.00", kurDegisim: "33.33", durum: "Dövizde fiyat sabit; TL artışı kur etkisi" });
    expect(zam[0].endeksFarki).toBe("23.33");
    await expect(calistir("stok.tedarikci_zam", { baslangic: "2026-01-01", bitis: "2026-03-31" }, A.satis, "satis")).rejects.toThrow(/Alış fiyatı ve maliyet/);
  });
});

describe("toplu rapor (END-12)", () => {
  it("firmanın ürünlerini endeksin gerisinde kalan önce listeler; yetkisi olmayan taraf reddedilir", async () => {
    const tanim = raporTanimiAl("stok.fiyat_endeks")!;
    const satirlar = await ile(A.tenant, A.yonetici, "yonetici", () => prisma.tenantIslem(A.tenant, (tx) => tanim.calistir({ filtreler: { baslangic: "2026-01-01", bitis: "2026-03-31", endeks: SERI, taraf: "satis" } }, { tenantId: A.tenant, tx })));
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0]).toMatchObject({ stokId: A.stok, reelDegisim: "-1.22", durum: "Endeksin gerisinde" });
    await expect(ile(A.tenant, A.satis, "satis", () => prisma.tenantIslem(A.tenant, (tx) => tanim.calistir({ filtreler: { baslangic: "2026-01-01", bitis: "2026-03-31", endeks: SERI, taraf: "alis" } }, { tenantId: A.tenant, tx })))).rejects.toThrow(/Alış fiyatı/);
  });
});

describe("kur serisi: EVDS aylık ortalaması", () => {
  it("içinde bulunulan ay her çekimde güncellenir ama revizyon sayılmaz; geçmiş ay değişirse revizyondur", async () => {
    await yonetim.endeksSerisi.create({ data: { kod: KUR, evdsKodu: `TP.KABULKUR.${ek}`, ad: "Kabul kuru", kaynakSiklik: "gunluk", tur: "kur" } });
    await degerleriYaz(yonetim, KUR, [{ donem: "2026-10-01", deger: "49.31" }, { donem: "2026-11-01", deger: "50.00" }], "evds", "2026-11-01");
    const ikinci = await degerleriYaz(yonetim, KUR, [{ donem: "2026-10-01", deger: "49.31" }, { donem: "2026-11-01", deger: "50.02" }], "evds", "2026-11-01");
    expect(ikinci).toMatchObject({ yeni: 0, revize: 0 });
    const ucuncu = await degerleriYaz(yonetim, KUR, [{ donem: "2026-10-01", deger: "49.35" }], "evds", "2026-11-01");
    expect(ucuncu.revize).toBe(1);
    const v = await prisma.tenantIslem(A.tenant, (tx) => endeksVerisi(tx, KUR, "2026-10-01", "2026-11-01"));
    expect(v.tur).toBe("kur");
    expect([...v.degerler.entries()].map(([a, d]) => [a, d.toString()]).sort()).toEqual([["2026-10-01", "49.35"], ["2026-11-01", "50.02"]]);
    expect(await yonetim.endeksDegerRevizyonu.count({ where: { seriKodu: KUR } })).toBe(1);
  });
});
