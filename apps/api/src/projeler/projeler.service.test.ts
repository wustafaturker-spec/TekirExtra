import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../core/istek-baglami";
import { ProjelerService } from "./projeler.service";

function baglamda<T>(fn: () => Promise<T>): Promise<T> {
  return istekBaglami.run(
    { deger: { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" } },
    fn,
  );
}

describe("ProjelerService finansal özet", () => {
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

  it("tahakkuk toplamına kasa hareketlerini ikinci kez eklemez", async () => {
    const tx = {
      faturaSatir: {
        aggregate: vi.fn()
          .mockResolvedValueOnce({ _sum: { toplamTutar: 1_000 } })
          .mockResolvedValueOnce({ _sum: { toplamTutar: 400 } }),
      },
      masraf: { aggregate: vi.fn().mockResolvedValue({ _sum: { toplam: 100 } }) },
      gelirKaydi: { aggregate: vi.fn().mockResolvedValue({ _sum: { netTutarTry: 200 } }) },
      kasaBankaHareket: {
        groupBy: vi.fn().mockResolvedValue([
          { tip: "tahsilat", _sum: { tutarTry: 1_200 } },
          { tip: "tediye", _sum: { tutarTry: 500 } },
        ]),
      },
    };
    const prisma = { tenantIslem: vi.fn((_tenantId, cb) => cb(tx)) };
    const service = new ProjelerService(prisma as never);

    const sonuc = await baglamda(() => (service as any).projeFinansOzeti("proje-1"));

    expect(sonuc).toMatchObject({
      esas: "tahakkuk",
      toplamGelir: "1200.00",
      toplamGider: "500.00",
      netKarZarar: "700.00",
      nakitOzet: { tahsilat: "1200.00", tediye: "500.00", netNakitAkisi: "700.00" },
    });
  });

  it("analitik kırılımda satış ve alış faturalarını yönlerine göre ayırır", async () => {
    const tx = {
      faturaSatir: {
        aggregate: vi.fn()
          .mockResolvedValueOnce({ _sum: { toplamTutar: 900 } })
          .mockResolvedValueOnce({ _sum: { toplamTutar: 300 } }),
      },
      masraf: { aggregate: vi.fn().mockResolvedValue({ _sum: { toplam: 50 } }) },
      gelirKaydi: { aggregate: vi.fn().mockResolvedValue({ _sum: { netTutarTry: 100 } }) },
    };
    const prisma = { tenantIslem: vi.fn((_tenantId, cb) => cb(tx)) };
    const service = new ProjelerService(prisma as never);

    const [sonuc] = await baglamda(() =>
      (service as any).analitikYevmiyeKirilimlari("proje-1", [
        { id: "k-1", tip: "her_ikisi", butceTutari: 1_000 },
      ]),
    );

    expect(sonuc).toMatchObject({
      gerceklesenGelir: "1000.00",
      gerceklesenGider: "350.00",
      netTutar: "650.00",
      gerceklesenTutar: "650.00",
    });
  });
});
