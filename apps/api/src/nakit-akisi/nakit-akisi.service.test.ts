import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NakitAkisiService } from "./nakit-akisi.service";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", rol: "muhasebe" }) }));

const g = (tarih: string) => new Date(`${tarih}T00:00:00.000Z`);

/** Her kaynaktan en az bir satır: kalem üretme kuralları gerçek satırla sınanır (NAK-01…NAK-10). */
function kurulum() {
  const tx = {
    kasa: { findMany: vi.fn().mockResolvedValue([{ id: "k1", dovizCinsi: "TRY" }]) },
    bankaHesap: { findMany: vi.fn().mockResolvedValue([{ id: "b1", dovizCinsi: "USD" }]) },
    kasaBankaHareket: {
      groupBy: vi.fn().mockResolvedValue([
        { kasaId: "k1", bankaHesapId: null, tip: "tahsilat", _sum: { tutar: 1500, tutarTry: 1500 } },
        { kasaId: "k1", bankaHesapId: null, tip: "tediye", _sum: { tutar: 500, tutarTry: 500 } },
        { kasaId: null, bankaHesapId: "b1", tip: "tahsilat", _sum: { tutar: 100, tutarTry: 3000 } },
      ]),
    },
    fatura: {
      findMany: vi.fn().mockResolvedValue([
        { id: "f1", no: "TKR1", tip: "satis", tarih: g("2026-09-01"), vadeTarihi: g("2026-09-20"), genelToplam: 1200, kur: 1, dovizCinsi: "TRY", cariId: "c1", cari: { unvan: "Müşteri A" }, durum: "kesin", kapamalar: [{ tutar: 200 }], iadeKapamalari: [] },
        { id: "f2", no: "ALS1", tip: "alis", tarih: g("2026-09-01"), vadeTarihi: g("2026-09-15"), genelToplam: 500, kur: 1, dovizCinsi: "TRY", cariId: "c9", cari: { unvan: "Tedarikçi" }, durum: "kesin", kapamalar: [], iadeKapamalari: [] },
        { id: "f3", no: "TKR2", tip: "satis", tarih: g("2026-09-01"), vadeTarihi: g("2026-09-10"), genelToplam: 100, kur: 1, dovizCinsi: "TRY", cariId: "c1", cari: { unvan: "Müşteri A" }, durum: "kesin", kapamalar: [{ tutar: 100 }], iadeKapamalari: [] },
      ]),
    },
    cekSenet: {
      findMany: vi.fn().mockResolvedValue([
        { id: "cs1", tur: "cek", yon: "alinan", portfoyNo: "P1", cekNo: "123", vadeTarihi: g("2026-09-18"), tutar: 300, dovizCinsi: "TRY", kur: 1, borclu: "Keşideci", cariId: null, cari: null },
        { id: "cs2", tur: "senet", yon: "verilen", portfoyNo: "P2", cekNo: null, vadeTarihi: g("2026-09-25"), tutar: 200, dovizCinsi: "TRY", kur: 1, borclu: "Biz", cariId: null, cari: null },
      ]),
    },
    masraf: {
      findMany: vi.fn().mockResolvedValue([
        { id: "m1", belgeNo: "FŞ-1", saticiUnvan: "Kırtasiye", tarih: g("2026-09-12"), vadeTarihi: null, toplam: 150, odenenTutar: 50, dovizCinsi: "TRY", cariId: null, cari: null, kategori: { ad: "Ofis" } },
      ]),
    },
    kiraSozlesme: {
      findMany: vi.fn().mockResolvedValue([
        { id: "ks1", baslik: "Depo", kirayaVeren: "Ev sahibi", odemeGunu: 15, matrah: 1000, kdvOrani: 20, stopajOrani: 20, dovizCinsi: "TRY", baslangicTarihi: g("2026-01-01"), bitisTarihi: null, cariId: null, cari: null, masraflar: [] },
        // Eylül kira masrafı kayıtlı: sözleşme o ay için ayrıca sayılmaz.
        { id: "ks2", baslik: "Ofis", kirayaVeren: "Ev sahibi 2", odemeGunu: 20, matrah: 2000, kdvOrani: 0, stopajOrani: 0, dovizCinsi: "TRY", baslangicTarihi: g("2026-01-01"), bitisTarihi: null, cariId: null, cari: null, masraflar: [{ kiraDonemi: g("2026-09-01") }] },
      ]),
    },
    // KRD-07: ödenmemiş kredi taksiti vade gününde çıkar; gecikmiş olan bugüne çekilir.
    bankaKrediTaksiti: {
      findMany: vi.fn().mockResolvedValue([
        { id: "kt1", sira: 3, vadeTarihi: g("2026-09-25"), anapara: new Prisma.Decimal(900), faiz: new Prisma.Decimal(100), bsmv: new Prisma.Decimal(5), kkdf: new Prisma.Decimal(0), kredi: { id: "kr", ad: "Ticari kredi", dovizCinsi: "TRY" } },
      ]),
    },
    // KSB-10: kart borcu ekstrenin son ödeme gününde çıkar (kesim 23, son ödeme 3).
    krediKarti: {
      findMany: vi.fn().mockResolvedValue([{
        id: "kk", ad: "Şirket kartı", sonDortHane: "1234", dovizCinsi: "TRY", limit: 50000, hesapKesimGunu: 23, sonOdemeGunu: 3, asgariOdemeOrani: null, aktif: true, ekstreler: [],
        hareketler: [{
          id: "h1", tip: "harcama", tarih: g("2026-08-30"), tutar: 750, aciklama: "Laptop", taksitSayisi: 3, geriAlinanHareketId: null, ekstreId: null,
          taksitler: [1, 2, 3].map((sira) => ({ id: `t${sira}`, sira, vadeTarihi: g(["2026-08-30", "2026-09-30", "2026-10-30"][sira - 1]), tutar: 250, ekstreId: null })),
        }],
      }]),
    },
    personelTatilGunu: { findMany: vi.fn().mockResolvedValue([]) },
    personelBordro: {
      findMany: vi.fn((args: { where: { durum?: { in?: string[] } } }) =>
        Promise.resolve(
          args.where.durum?.in
            ? [{ id: "pb1", donemYil: 2026, donemAy: 8, odenecekTutar: 3000, odenenTutar: 1000, odemeTarihi: null, personel: { ad: "Ali", soyad: "Veli" } }]
            : [{ odenecekTutar: 3000, odemeTarihi: g("2026-09-05") }],
        ),
      ),
      findFirst: vi.fn().mockResolvedValue({ donemYil: 2026, donemAy: 8 }),
    },
    tekrarlayanFatura: {
      findMany: vi.fn().mockResolvedValue([
        { id: "tf1", ad: "Bakım", siklik: "haftalik", aralik: 1, sonrakiTarih: g("2026-09-14"), bitisTarihi: null, sablonFatura: { tip: "satis", genelToplam: 100, kur: 1, dovizCinsi: "TRY", cariId: "c2", cari: { unvan: "Müşteri B", varsayilanVadeGun: 0 } } },
      ]),
    },
    bankaOdemeTalimati: {
      findMany: vi.fn().mockResolvedValue([{ id: "ot1", no: "OT2026-000001", aliciUnvan: "Tedarikçi", tutar: 10, dovizCinsi: "EUR", aciklama: "Avans", odemeTarihi: g("2026-09-01"), cariId: null }]),
    },
    // ENT-07: ALS1'in 200 TL'si onaylı talimatta; fatura kalemi 300 kalır.
    bankaOdemeTalimatiFatura: { groupBy: vi.fn().mockResolvedValue([{ faturaId: "f2", _sum: { tutar: 200 } }]) },
    cariHesap: {
      findMany: vi.fn().mockResolvedValue([
        { id: "c1", karaListe: false, riskLimiti: null, hareketler: [] },
        { id: "c2", karaListe: false, riskLimiti: null, hareketler: [] },
      ]),
    },
  };
  const prisma = { tenantIslem: vi.fn((_t: string, cb: (tx: unknown) => unknown) => cb(tx)) };
  const doviz = { kurlariGetir: vi.fn().mockResolvedValue({ kurTarihi: "2026-09-10", kurlar: { USD: 40, EUR: 45 } }) };
  return { tx, doviz, service: new NakitAkisiService(prisma as never, doviz as never) };
}

describe("NakitAkisiService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T09:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("başlangıç bakiyesini hesap bazında hareketlerden ve güncel kurla hesaplar (NAK-01, NAK-10)", async () => {
    const sonuc = await kurulum().service.tahmin(30);
    // Kasa 1500 - 500 = 1000 TL; USD hesap 100 × 40 = 4000 TL (tarihsel 3000 değil).
    expect(sonuc.baslangicBakiye).toBe(5000);
    expect(sonuc.hesapSayisi).toBe(2);
    expect(sonuc.kur).toEqual({ tarih: "2026-09-10", kurlar: { USD: 40, EUR: 45 } });
    expect(sonuc.uyarilar).toEqual([]);
  });

  it("her kaynaktan doğru yön, tutar ve tarihte kalem üretir", async () => {
    const { kalemler } = await kurulum().service.tahmin(30);
    const bul = (aciklama: string) => kalemler.filter((k) => k.aciklama.includes(aciklama));

    expect(bul("TKR1")).toMatchObject([{ kaynak: "fatura", yon: "giris", tutar: 1000, vade: "2026-09-20" }]);
    expect(bul("TKR2")).toEqual([]); // tamamen ödenmiş
    // 500 TL faturanın 200 TL'si onaylı ödeme talimatında (ENT-07); iki kez sayılmaz.
    expect(bul("ALS1")).toMatchObject([{ kaynak: "fatura", yon: "cikis", tutar: 300 }]);
    expect(bul("Çek P1")).toMatchObject([{ kaynak: "cek_senet", yon: "giris", tutar: 300 }]);
    expect(bul("Senet P2")).toMatchObject([{ kaynak: "cek_senet", yon: "cikis", tutar: 200 }]);
    expect(bul("Ofis · FŞ-1")).toMatchObject([{ kaynak: "masraf", yon: "cikis", tutar: 100, vade: "2026-09-12" }]);
    expect(bul("Kira · Depo")).toMatchObject([{ kaynak: "kira", yon: "cikis", tutar: 1000, vade: "2026-09-15" }]);
    expect(bul("Kira · Ofis")).toEqual([]); // Eylül masrafı kayıtlı, Ekim ödemesi ufuk dışı
    // Açık dönem (kesim 23.09) 3 Ekim cumartesi → 5 Ekim. Sonraki taksitler kendi
    // ekstrelerinin son ödeme gününde (3 Kasım, 3 Aralık) çıkar; 30 günlük ufkun dışında.
    expect(bul("Ticari kredi").map((k: { vade: string; tutar: number; kaynak: string }) => [k.kaynak, k.vade, k.tutar])).toEqual([["kredi_taksit", "2026-09-25", 1005]]);
    expect(bul("Şirket kartı").map((k: { vade: string; tutar: number; kaynak: string }) => [k.kaynak, k.vade, k.tutar])).toEqual([["kart_ekstre", "2026-10-05", 250]]);
    expect(bul("Ödeme talimatı")).toMatchObject([{ kaynak: "odeme_talimati", yon: "cikis", tutar: 450, vade: "2026-09-11" }]);
  });

  it("açık bordronun kalanını, sonraki ayları da son dönemin tekrarı olarak üretir (NAK-07)", async () => {
    const { kalemler } = await kurulum().service.tahmin(30);
    const bordrolar = kalemler.filter((k) => k.kaynak === "bordro");

    expect(bordrolar).toHaveLength(2);
    // Ödeme tarihi yok: dönem sonu (31.08) geçmiş, bugüne alınır.
    expect(bordrolar[0]).toMatchObject({ tutar: 2000, vade: "2026-08-31", tahmin: false });
    expect(bordrolar[0].tarihler.baz.tarih).toBe("2026-09-11");
    expect(bordrolar[1]).toMatchObject({ tutar: 3000, vade: "2026-10-05", tahmin: true });
  });

  it("tekrarlayan faturayı ufuk içindeki her üretim tarihinde tahmin kalemi yapar (NAK-08)", async () => {
    const { kalemler } = await kurulum().service.tahmin(30);
    const tekrarlar = kalemler.filter((k) => k.kaynak === "tekrarlayan_fatura");

    expect(tekrarlar.map((k) => k.vade)).toEqual(["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"]);
    expect(tekrarlar.every((k) => k.tahmin && k.yon === "giris")).toBe(true);
  });

  it("kur alınamazsa belge kuruyla çevirir, belge kuru olmayan dövizli kalemi atlar ve söyler", async () => {
    const { service, doviz } = kurulum();
    doviz.kurlariGetir.mockRejectedValue(new Error("TCMB kapalı"));
    const sonuc = await service.tahmin(30);

    expect(sonuc.kur).toBeNull();
    // USD hesap tarihsel TL karşılığıyla: 1000 + 3000.
    expect(sonuc.baslangicBakiye).toBe(4000);
    expect(sonuc.kalemler.some((k) => k.kaynak === "odeme_talimati")).toBe(false);
    expect(sonuc.uyarilar).toHaveLength(2);
  });
});
