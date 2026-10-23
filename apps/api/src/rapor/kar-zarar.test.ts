import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { SatisSatiri } from "../stok/satis-ozeti";
import type { TahakkukKalemi } from "./tahakkuk";
import { karZararHesapla } from "./kar-zarar";

const D = (n: number) => new Prisma.Decimal(n);
const kalem = (anahtar: string, tutarTry: number, tarih = "2026-10-05"): TahakkukKalemi => ({
  id: `${anahtar}-${tarih}-${tutarTry}`, tarih, tur: anahtar.startsWith("satis:") || anahtar.startsWith("gelir_kategori:") || anahtar === "alis_iadesi" ? "gelir" : "gider",
  anahtar, anaKategori: "", altKategori: "", belgeNo: "", cariUnvan: "", aciklama: "", tutarTry, dovizCinsi: "TRY", tutar: tutarTry,
});
const satir = (ciro: number, maliyet: number, ek: Partial<SatisSatiri> = {}): SatisSatiri => ({
  faturaId: "f", faturaNo: "", tarih: new Date("2026-10-05"), cariUnvan: "", tip: "satis", stokId: "s", kod: "S", ad: "Ürün", stokTip: "urun",
  mevcutMiktar: D(0), miktar: D(1), ciro: D(ciro), maliyet: D(maliyet), hareketPaylari: [], ...ek,
});

describe("kâr tanımı (RPR-12)", () => {
  it("net satış − SMM + diğer gelirler − giderler; mal alışı ve alış iadesi kâra girmez", () => {
    const kz = karZararHesapla(
      [
        kalem("satis:ticari_satis", 10_000), kalem("satis_iadesi", 1_000), kalem("satis:kira_geliri", 500), kalem("gelir_kategori:faiz", 200),
        kalem("mal_alis", 50_000), kalem("alis_iadesi", 3_000),
        kalem("hizmet_alis", 800), kalem("masraf_kategori:kira", 1_200), kalem("personel", 2_000),
      ],
      [satir(10_000, 6_000), satir(-1_000, -600, { tip: "satis_iade" })],
    );
    expect(kz).toMatchObject({
      netSatis: 9_000, smm: 5_400, brutKar: 3_600, digerGelirler: 700,
      hizmetAlislari: 800, masraflar: 1_200, personel: 2_000, faaliyetGiderleri: 4_000, netKar: 300,
    });
  });

  it("maliyeti sıfır mal satışını sayar; hizmet satışını saymaz", () => {
    const kz = karZararHesapla([kalem("satis:ticari_satis", 3_000)], [satir(1_000, 0), satir(1_500, 0, { stokTip: "hizmet" }), satir(500, 200)]);
    expect(kz.maliyetsizSatis).toEqual({ satir: 1, ciro: 1_000 });
  });
});

describe("Kâr/Zarar Özeti raporu (RPR-12)", () => {
  it("ödemeleri değil SMM'yi düşer ve aya göre kırar", async () => {
    vi.resetModules();
    vi.doMock("./kar-zarar", async (orijinal) => ({
      ...(await orijinal<typeof import("./kar-zarar")>()),
      karZararVerisi: vi.fn().mockResolvedValue({
        kalemler: [kalem("satis:ticari_satis", 10_000, "2026-09-10"), kalem("mal_alis", 40_000, "2026-09-12"), kalem("satis:ticari_satis", 5_000, "2026-10-02"), kalem("masraf_kategori:x", 1_000, "2026-10-03")],
        satirlar: [satir(10_000, 7_000, { tarih: new Date("2026-09-10") }), satir(5_000, 3_000, { tarih: new Date("2026-10-02") })],
        uyarilar: [],
      }),
    }));
    await import("../fatura/fatura.raporlar");
    const { raporTanimiAl } = await import("../core/raporlar/rapor-kayit");
    const tanim = raporTanimiAl("genel.kar-zarar-ozeti")!;
    const satirlar = await tanim.calistir({ filtreler: { baslangic: "2026-09-01", bitis: "2026-10-31" } }, { tenantId: "t1", tx: {} as never });
    expect(satirlar).toEqual([
      expect.objectContaining({ grup: "2026-09", netSatis: "10000.00", smm: "7000.00", brutKar: "3000.00", netKar: "3000.00" }),
      expect.objectContaining({ grup: "2026-10", netSatis: "5000.00", smm: "3000.00", faaliyetGiderleri: "1000.00", netKar: "1000.00" }),
    ]);
    vi.doUnmock("./kar-zarar");
  });
});

describe("satış raporları (RPR-13)", () => {
  it("Dönemsel Özet satış ve alışı ayrı sütunda, iadeleri düşülmüş verir", async () => {
    await import("../fatura/fatura.raporlar");
    const { raporTanimiAl } = await import("../core/raporlar/rapor-kayit");
    const ft = (tip: string, matrah: number, kur = 1) => ({ tip, tarih: new Date("2026-10-05"), toplamMatrah: D(matrah), kur: D(kur), cari: { unvan: "A" } });
    const tx = { fatura: { findMany: vi.fn().mockResolvedValue([ft("satis", 1000), ft("satis", 10, 40), ft("satis_iade", 100), ft("alis", 600), ft("alis_iade", 50)]) } };
    const [satir] = await raporTanimiAl("fatura.donemsel-ozet")!.calistir({ filtreler: {} }, { tenantId: "t1", tx: tx as never });
    expect(satir).toMatchObject({ satis: "1400.00", satisIade: "100.00", netSatis: "1300.00", alis: "600.00", alisIade: "50.00", netAlis: "550.00", belgeSayisi: 5 });
  });

  it("maliyeti bilinmeyen satış marja girmez ve ayrı sütunda; hiç bilinmiyorsa marj boş", async () => {
    const { bilinenMarj, maliyetBilinmiyor } = await import("../stok/satis-ozeti");
    expect(maliyetBilinmiyor(satir(1000, 0))).toBe(true);
    expect(maliyetBilinmiyor(satir(1000, 0, { stokTip: "hizmet" }))).toBe(false);
    expect(maliyetBilinmiyor(satir(-100, 0, { tip: "satis_iade" }))).toBe(false);
    // 3.000 ciro: 1.000'i maliyetsiz; bilinen 2.000 ciro, 1.500 maliyet → %25
    expect(bilinenMarj(D(3000), D(1500), D(1000))).toBe(25);
    expect(bilinenMarj(D(1000), D(0), D(1000))).toBeNull();
  });
});

describe("demirbaş kâr/zararda (DMR-13)", () => {
  it("amortisman faaliyet gideri, çıkış zararı faaliyet dışı gider; ikisi de net kârı düşürür", () => {
    const kz = karZararHesapla([kalem("satis:ticari_satis", 10_000), kalem("amortisman", 1_000), kalem("demirbas_cikis_zarari", 200), kalem("satis:varlik_satisi", 50)], [satir(10_000, 6_000)]);
    expect(kz).toMatchObject({ brutKar: 4_000, amortisman: 1_000, faaliyetGiderleri: 1_000, digerGiderler: 200, digerGelirler: 50, netKar: 2_850 });
  });
});
