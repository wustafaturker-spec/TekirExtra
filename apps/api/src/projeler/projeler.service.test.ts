import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { istekBaglami } from "../core/istek-baglami";
import { ProjelerService } from "./projeler.service";

function baglamda<T>(fn: () => Promise<T>): Promise<T> {
  return istekBaglami.run(
    { deger: { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" } },
    fn,
  );
}

describe("ProjelerService finansal özet", () => {
  const D = (d: string | number) => new Prisma.Decimal(d);
  const satir = (tip: string, matrah: number, kur = 1, projeAltKirilimId: string | null = null) =>
    ({ projeId: "proje-1", projeAltKirilimId, matrah: D(matrah), fatura: { tip, kur: D(kur) } });
  const tx = (ek: Record<string, unknown> = {}) => ({
    faturaSatir: {
      findMany: vi.fn().mockResolvedValue([
        satir("satis", 1_000), // KDV hariç matrah; KDV'li toplam hesaba girmez
        satir("satis", 100, 30), // 100 USD × 30 = 3.000 TL
        satir("satis_iade", 200), // iade gelirden düşer
        satir("alis", 400),
        satir("alis_iade", 50),
      ]),
    },
    masraf: { findMany: vi.fn().mockResolvedValue([{ projeId: "proje-1", projeAltKirilimId: null, matrah: D(100), kur: D(1) }]) },
    gelirKaydi: { findMany: vi.fn().mockResolvedValue([{ projeId: "proje-1", projeAltKirilimId: null, brutTutar: D(10), kur: D(20) }]) },
    kasaBankaHareket: {
      groupBy: vi.fn().mockResolvedValue([
        { projeId: "proje-1", tip: "tahsilat", _sum: { tutarTry: D(1_200) } },
        { projeId: "proje-1", tip: "tediye", _sum: { tutarTry: D(500) } },
      ]),
    },
    ...ek,
  });

  it("proje formu için yalnız aktif cari ve kullanıcı seçeneklerini döndürür", async () => {
    const tx = {
      cariHesap: { findMany: vi.fn().mockResolvedValue([{ id: "c-1", kod: "C1", unvan: "Cari" }]) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: "u-1", adSoyad: "Kullanıcı", eposta: "k@example.com" }]) },
    };
    const prisma = { tenantIslem: vi.fn((_tenantId, cb) => cb(tx)) };
    const service = new ProjelerService(prisma as never);

    const sonuc = await baglamda(() => service.secenekler());

    expect(sonuc.cariler).toHaveLength(1);
    expect(sonuc.kullanicilar).toHaveLength(1);
    expect(tx.cariHesap.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { aktif: true } }));
    expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { aktif: true } }));
  });

  it("KDV hariç, TL'ye çevrilmiş tutarlarla hesaplar; iadeleri düşer, kasa hareketlerini toplama katmaz", async () => {
    const islem = tx();
    const service = new ProjelerService({ tenantIslem: vi.fn((_t, cb) => cb(islem)) } as never);

    const sonuc = await baglamda(() => (service as any).projeFinansOzeti("proje-1"));

    // Gelir: 1.000 + 3.000 − 200 + 200 (10 USD faiz × 20) = 4.000; gider: 400 − 50 + 100 = 450.
    expect(sonuc).toMatchObject({
      esas: "tahakkuk",
      toplamGelir: "4000.00",
      toplamGider: "450.00",
      netKarZarar: "3550.00",
      nakitOzet: { tahsilat: "1200.00", tediye: "500.00", netNakitAkisi: "700.00" },
      detay: { satisFaturaGeliri: "4000.00", satisIadesi: "200.00", alisIadesi: "50.00" },
    });
    // Yalnız kesinleşmiş faturalar sayılır (taslak kârı şişirmez).
    expect(islem.faturaSatir.findMany.mock.calls[0][0].where.fatura.durum).toBe("kesin");
  });

  it("analitik kırılımda satış ve alış faturalarını yönlerine göre ayırır", async () => {
    const islem = tx({
      faturaSatir: { findMany: vi.fn().mockResolvedValue([satir("satis", 900, 1, "k-1"), satir("alis", 300, 1, "k-1")]) },
      masraf: { findMany: vi.fn().mockResolvedValue([{ projeId: "proje-1", projeAltKirilimId: "k-1", matrah: D(50), kur: D(1) }]) },
      gelirKaydi: { findMany: vi.fn().mockResolvedValue([{ projeId: "proje-1", projeAltKirilimId: "k-1", brutTutar: D(100), kur: D(1) }]) },
    });
    const service = new ProjelerService({ tenantIslem: vi.fn((_t, cb) => cb(islem)) } as never);

    const [sonuc] = await baglamda(() =>
      (service as any).analitikYevmiyeKirilimlari("proje-1", [{ id: "k-1", tip: "her_ikisi", butceTutari: D(1_000) }]),
    );

    expect(sonuc).toMatchObject({ gerceklesenGelir: "1000.00", gerceklesenGider: "350.00", netTutar: "650.00", gerceklesenTutar: "650.00", kullanimOrani: 65 });
  });
});
