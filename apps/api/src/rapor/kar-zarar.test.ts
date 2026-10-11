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
