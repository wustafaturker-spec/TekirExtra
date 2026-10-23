import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { AmortismanService } from "../src/demirbas/amortisman.service";
import { DemirbasService } from "../src/demirbas/demirbas.service";
import { DonemKilidiService } from "../src/donem-kapatma/donem-kilidi.service";
import { fisleriUret } from "../src/mali-musavir/muhasebe/fis-uretici";
import { uretimGirdisiOku } from "../src/mali-musavir/muhasebe/fis-okuyucu";
import { tahakkukOku } from "../src/rapor/tahakkuk";

/**
 * DMR-01…11: demirbaş gerçek PostgreSQL'de, uygulama rolüyle (RLS). Faturadan
 * adet başına kart, doğrudan gider uyarısı, açılış kaydı, binek oto kıstı ve
 * KKEG, yıl sonu kesinleştirme/geri alma kuralları, satışla elden çıkarma ve
 * muhasebe fişleri, zimmet devri, dönem kilidi.
 */

const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const uygulama = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

const tenantId = randomUUID();
const userId = randomUUID();
const [tedarikci, musteri, stok] = [randomUUID(), randomUUID(), randomUUID()];
const [alis, satis, alisSatir, satisSatir, nakliyeFatura, nakliyeSatir] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];

const prisma = {
  tenantIslem: <T>(t: string, fn: (tx: never) => Promise<T>, secenek?: { timeout?: number }) =>
    uygulama.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t}, true), set_config('app.user_id', ${userId}, true)`;
      return fn(tx as never);
    }, { timeout: secenek?.timeout ?? 30_000 }),
};
const kilit = new DonemKilidiService(prisma as never);
const ayarlar = { getir: async () => ({ defterTuru: "bilanco" }) };
const servis = new DemirbasService(prisma as never, kilit, ayarlar as never);
const amortisman = new AmortismanService(prisma as never, kilit);
const calistir = <T>(fn: () => Promise<T>, rol = "muhasebe") => baglamlaCalistir({ tenantId, userId, rol } as never, fn);
const fisler = (bas: string, bit: string) => prisma.tenantIslem(tenantId, async (tx) => fisleriUret(await uretimGirdisiOku(tx as never, tenantId, bas, bit)));
const ozet = (f: { satirlar: Array<{ hesapKodu: string; borc: { gt(n: number): boolean; add(x: unknown): { toFixed(n: number): string } }; alacak: unknown }> }) =>
  f.satirlar.map((s) => `${s.hesapKodu} ${s.borc.gt(0) ? "B" : "A"} ${s.borc.add(s.alacak).toFixed(2)}`);

let kart1 = "", kart2 = "", acilisKart = "", binek = "";

beforeAll(async () => {
  const y = yonetim;
  await y.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${tenantId}::uuid, 'Demirbaş Test', ${String(Date.now()).slice(-10)}, now(), now())`;
  await y.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${userId}::uuid, ${tenantId}::uuid, ${`dmr-${userId}@test.local`}, 'x', 'Test Muhasebe', 'muhasebe', now())`;
  await y.$executeRaw`INSERT INTO cari_hesaplar (id, tenant_id, kod, unvan, tip, updated_at) VALUES (${tedarikci}::uuid, ${tenantId}::uuid, 'TED-1', 'MAKİNE TEDARİK A.Ş.', 'tedarikci', now()), (${musteri}::uuid, ${tenantId}::uuid, 'MUS-1', 'ALICI LTD.', 'musteri', now())`;
  await y.$executeRaw`INSERT INTO stok_kartlari (id, tenant_id, kod, ad, tip, updated_at) VALUES (${stok}::uuid, ${tenantId}::uuid, 'DMR-HZM', 'Forklift', 'hizmet', now())`;
  const fatura = (id: string, no: string, tip: string, tarih: string, cari: string, matrah: number) =>
    y.$executeRawUnsafe(`INSERT INTO faturalar (id, tenant_id, no, tip, durum, tarih, cari_id, doviz_cinsi, kur, toplam_brut, toplam_satir_iskontosu, genel_iskonto_toplam, toplam_matrah, toplam_kdv, toplam_tevkifat, toplam_net_kdv, genel_toplam, created_at, updated_at)
      VALUES ($1::uuid, $2::uuid, $3, $4::"FaturaTip", 'kesin', $5::date, $6::uuid, 'TRY', 1, $7, 0, 0, $7, $8, 0, $8, $9, now(), now())`, id, tenantId, no, tip, tarih, cari, matrah, matrah * 0.2, matrah * 1.2);
  const satir = (id: string, faturaId: string, miktar: number, matrah: number) =>
    y.$executeRawUnsafe(`INSERT INTO fatura_satirlari (id, tenant_id, fatura_id, stok_id, miktar, birim_fiyat, matrah, kdv_tutari, net_kdv_tutari, toplam_tutar)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $8, $9)`, id, tenantId, faturaId, stok, miktar, matrah / miktar, matrah, matrah * 0.2, matrah * 1.2);
  await fatura(alis, "ALS2026000000001", "alis", "2026-02-10", tedarikci, 120000);
  await satir(alisSatir, alis, 2, 120000);
  await fatura(nakliyeFatura, "NKL2026000000001", "alis", "2026-02-12", tedarikci, 3000);
  await satir(nakliyeSatir, nakliyeFatura, 1, 3000);
  await fatura(satis, "SNC2027000000001", "satis", "2027-03-01", musteri, 50000);
  await satir(satisSatir, satis, 1, 50000);
  await y.$executeRaw`INSERT INTO mali_donemler (id, tenant_id, yil, ay, durum, updated_at) VALUES (gen_random_uuid(), ${tenantId}::uuid, 2027, 2, 'kapali', now())`;
});

afterAll(async () => {
  await uygulama.$disconnect();
  await yonetim.$disconnect();
});

describe("demirbaş ve amortisman (DMR-01…11)", () => {
  it("alış faturası satırı adet başına karta bölünür; aynı satır ikinci kez bağlanmaz", async () => {
    const s = await calistir(() => servis.olustur({ faturaSatirId: alisSatir, adet: 2, ad: "Forklift", sinif: "tasit", listeKodu: "6.7", faydaliOmur: 4, yontem: "normal", binekOto: false, binekVergili: false, binekSinirYok: false, acilis: false, acilisBirikmis: 0, uyarilariKabulEt: false }));
    expect(s.olusturuldu).toBe(true);
    const kartlar = await yonetim.demirbas.findMany({ where: { tenantId }, orderBy: { kod: "asc" } });
    expect(kartlar.map((k) => [k.kod, k.ad, k.edinmeBedeli.toFixed(2), k.edinmeTarihi.toISOString().slice(0, 10), k.tedarikciCariId])).toEqual([
      ["DMR-000001", "Forklift (1/2)", "60000.00", "2026-02-10", tedarikci], ["DMR-000002", "Forklift (2/2)", "60000.00", "2026-02-10", tedarikci],
    ]);
    [kart1, kart2] = kartlar.map((k) => k.id);
    await expect(calistir(() => servis.olustur({ faturaSatirId: alisSatir, adet: 1, ad: "X", sinif: "tasit", faydaliOmur: 4, yontem: "normal", binekOto: false, binekVergili: false, binekSinirYok: false, acilis: false, acilisBirikmis: 0, uyarilariKabulEt: true }))).rejects.toThrow(/zaten demirbaş açılmış/);
  });

  it("ilave bedel faturadan eklenir ve amortismana esas bedele girer", async () => {
    await calistir(() => servis.ilaveBedelEkle(kart1, { faturaSatirId: nakliyeSatir, aciklama: "Nakliye" }));
    const k = await calistir(() => servis.getir(kart1));
    expect(k.bedel.toFixed(2)).toBe("63000.00");
    expect(k.plan.map((p) => [p.yil, p.tutar.toFixed(2)])).toEqual([[2026, "15750.00"], [2027, "15750.00"], [2028, "15750.00"], [2029, "15750.00"]]);
  });

  it("doğrudan gider sınırının altındaki bedelde uyarı; kabul edilince kart açılır", async () => {
    const g = { ad: "Masa", sinif: "demirbas" as const, faydaliOmur: 5, yontem: "normal" as const, binekOto: false, binekVergili: false, binekSinirYok: false, edinmeTarihi: "2026-04-01", edinmeBedeli: 5000, adet: 1, acilis: false, acilisBirikmis: 0 };
    const uyari = await calistir(() => servis.olustur({ ...g, uyarilariKabulEt: false }));
    expect(uyari.olusturuldu).toBe(false);
    expect(uyari.uyarilar[0]).toMatch(/doğrudan gider sınırının \(12\.000 TL, VUK 313\) altında/);
    expect((await calistir(() => servis.olustur({ ...g, uyarilariKabulEt: true }))).olusturuldu).toBe(true);
  });

  it("açılış kartı birikmişin son yılını izleyen yıldan sürer; binek otoda ilk yıl kıst ve sınırı aşan kısım KKEG", async () => {
    const a = await calistir(() => servis.olustur({ ad: "Sunucu", sinif: "demirbas", listeKodu: "4.1", faydaliOmur: 4, yontem: "normal", binekOto: false, binekVergili: false, binekSinirYok: false, edinmeTarihi: "2024-06-01", edinmeBedeli: 40000, adet: 1, acilis: true, acilisBirikmis: 20000, acilisSonYil: 2025, uyarilariKabulEt: false }));
    acilisKart = a.olusturuldu ? a.idler[0] : "";
    const b = await calistir(() => servis.olustur({ ad: "Binek", sinif: "tasit", listeKodu: "6.1", faydaliOmur: 5, yontem: "normal", binekOto: true, binekVergili: false, binekSinirYok: false, edinmeTarihi: "2026-10-05", edinmeBedeli: 2000000, adet: 1, acilis: false, acilisBirikmis: 0, uyarilariKabulEt: false }));
    binek = b.olusturuldu ? b.idler[0] : "";
    const ak = await calistir(() => servis.getir(acilisKart));
    expect(ak.plan.map((p) => [p.yil, p.tutar.toFixed(2)])).toEqual([[2026, "10000.00"], [2027, "10000.00"]]);
    const bk = await calistir(() => servis.getir(binek));
    expect(bk.binekSiniri).toBe(1380000);
    expect([bk.plan[0].yil, bk.plan[0].tutar.toFixed(2), bk.plan[0].kkeg.toFixed(2)]).toEqual([2026, "100000.00", "31000.00"]);
    expect(bk.plan.at(-1)!.yil).toBe(2031);
    await expect(calistir(() => servis.olustur({ ad: "X", sinif: "tasit", faydaliOmur: 5, yontem: "azalan", binekOto: true, binekVergili: false, binekSinirYok: false, edinmeTarihi: "2026-01-01", edinmeBedeli: 900000, adet: 1, acilis: false, acilisBirikmis: 0, uyarilariKabulEt: true }))).rejects.toThrow(/azalan bakiyeler/);
  });

  it("2026 önizleme ve kesinleştirme; önceki yıl sonradan kesinleşmez, kesin kartın bedeli değişmez", async () => {
    const o = await calistir(() => amortisman.onizleme(2026));
    expect(o.eksikler).toEqual([]);
    // 15.750 + 15.000 + 1.000 (masa) + 10.000 (açılış) + 100.000 (binek)
    expect([o.satirlar.length, o.toplam.toFixed(2), o.toplamKkeg.toFixed(2)]).toEqual([5, "141750.00", "31000.00"]);
    const k = await calistir(() => amortisman.kesinlestir(2026), "yonetici");
    expect(k.toplam.toFixed(2)).toBe("141750.00");
    await expect(calistir(() => amortisman.kesinlestir(2026), "yonetici")).rejects.toThrow(/zaten kesinleşmiş/);
    await expect(calistir(() => amortisman.kesinlestir(2025), "yonetici")).rejects.toThrow(/önceki bir yıl sonradan kesinleştirilemez/);
    await expect(calistir(() => servis.guncelle(kart1, { faydaliOmur: 5 }))).rejects.toThrow(/Kesin amortismanı olan kartta faydaliOmur/);
    await expect(calistir(() => servis.ilaveBedelEkle(kart2, { tarih: "2026-05-01", tutar: 100, aciklama: "Montaj" }))).rejects.toThrow(/ilk amortisman kesinleşmeden önce/);
  });

  it("muhasebe: demirbaş alışı 254'e, yıl sonu amortismanı 770/257 fişi", async () => {
    const { fisler: f } = await fisler("2026-01-01", "2026-12-31");
    const alisFisi = f.find((x) => x.belgeNo === "ALS2026000000001")!;
    expect(ozet(alisFisi)).toEqual(["254 B 120000.00", "191 B 24000.00", "320.01.TED-1 A 144000.00"]);
    expect(ozet(f.find((x) => x.belgeNo === "NKL2026000000001")!)[0]).toBe("254 B 3000.00");
    const am = f.find((x) => x.kaynak.tur === "amortisman")!;
    expect(am.tarih).toBe("2026-12-31");
    expect(am.satirlar.filter((s) => s.alacak.gt(0)).map((s) => `${s.hesapKodu} ${s.alacak.toFixed(2)}`)).toEqual(["257 141750.00"]);
  });

  it("zimmet devrinde önceki zimmet kapanır; tutanak verisi okunur", async () => {
    const ilk = await calistir(() => servis.zimmetle(kart1, { konum: "Depo A", baslangic: "2026-03-01" }));
    await calistir(() => servis.zimmetle(kart1, { konum: "Depo B", baslangic: "2026-06-01" }));
    const z = await yonetim.demirbasZimmet.findMany({ where: { demirbasId: kart1 }, orderBy: { baslangic: "asc" } });
    expect(z.map((x) => [x.konum, x.bitis?.toISOString().slice(0, 10) ?? null])).toEqual([["Depo A", "2026-06-01"], ["Depo B", null]]);
    expect((await calistir(() => servis.zimmetTutanagiVerisi(ilk.id))).zimmet.demirbas.kod).toBe("DMR-000001");
  });

  it("satışla elden çıkış: birikmiş kapanır, fark kâr; satış faturası gelir yerine varlık hesabına; açık zimmet kapanır", async () => {
    const c = await calistir(() => servis.cikis(kart2, { tur: "satis", faturaSatirId: satisSatir, gerekce: "Kullanım dışı kaldı" }));
    // Bedel 60.000, birikmiş 15.000 → net 45.000; satış 50.000 → kâr 5.000
    expect([c.netDeger.toFixed(2), c.fark.toFixed(2)]).toEqual(["45000.00", "5000.00"]);
    const { fisler: f, kontroller } = await fisler("2027-01-01", "2027-12-31");
    expect(kontroller).toEqual([]);
    expect(ozet(f.find((x) => x.belgeNo === "SNC2027000000001")!)).toEqual(["120.01.MUS-1 B 60000.00", "254 A 50000.00", "391 A 10000.00"]);
    expect(ozet(f.find((x) => x.kaynak.tur === "demirbas")!)).toEqual(["257 B 15000.00", "254 A 10000.00", "679 A 5000.00"]);
    const o = await calistir(() => amortisman.onizleme(2027));
    expect(o.satirlar.map((s) => s.kod)).not.toContain("DMR-000002");
    await expect(calistir(() => amortisman.geriAl(2026, "deneme"), "yonetici")).rejects.toThrow(/elden çıkmış/);
  });

  it("bütçe tahakkuku: demirbaş alışı gider değil, amortisman gider; satışta yalnız kâr (DMR-13)", async () => {
    const t = (bas: string, bit: string) => prisma.tenantIslem(tenantId, (tx) => tahakkukOku(tx as never, tenantId, new Date(`${bas}T00:00:00Z`), new Date(`${bit}T00:00:00Z`)));
    const y26 = (await t("2026-01-01", "2026-12-31")).kalemler;
    expect(y26.filter((k) => k.anahtar === "hizmet_alis" || k.anahtar === "mal_alis")).toEqual([]);
    expect(y26.filter((k) => k.anahtar === "amortisman").reduce((a, k) => a + k.tutarTry, 0)).toBe(141750);
    const y27 = (await t("2027-01-01", "2027-12-31")).kalemler;
    expect(y27.map((k) => [k.anahtar, k.tutarTry])).toEqual([["satis:varlik_satisi", 5000]]);
  });

  it("kapalı dönemde çıkış yapılmaz; çıkış geri alınınca 2026 geri alınabilir", async () => {
    await expect(calistir(() => servis.cikis(kart1, { tur: "hurda", tarih: "2027-02-15", gerekce: "Arızalı" }))).rejects.toThrow(/mali dönemi kapalı/);
    await calistir(() => servis.cikisGeriAl(kart2, "yanlış satır"));
    expect((await calistir(() => amortisman.geriAl(2026, "yeniden hesap"), "yonetici")).geriAlindi).toBe(true);
    const d = await yonetim.amortismanDonemi.findMany({ where: { tenantId } });
    expect(d.map((x) => x.durum)).toEqual(["geri_alindi"]);
    const k = await calistir(() => servis.getir(kart1));
    expect(k.kesinYilVar).toBe(false);
  });
});
