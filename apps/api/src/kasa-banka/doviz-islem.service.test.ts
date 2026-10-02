import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { DovizIslemService } from "./doviz-islem.service";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }) }));
// TCMB alış: 1 USD = 41 TL.
vi.mock("../doviz/kur-coz", () => ({ kurZorunlu: vi.fn(async () => new Prisma.Decimal(41)) }));

const D = (v: string | number) => new Prisma.Decimal(v);

function kur(hesaplar: Record<string, { ad: string; dovizCinsi: string }>) {
  let sira = 0;
  const tx = {
    kasa: { findUnique: vi.fn(async ({ where }) => ({ ...hesaplar[where.id], aktif: true })) },
    bankaHesap: { findUnique: vi.fn(async ({ where }) => ({ ...hesaplar[where.id], aktif: true })) },
    kasaBankaHareket: { create: vi.fn(async ({ data }) => ({ id: `h${++sira}`, ...data })), update: vi.fn() },
    gelirKategori: { upsert: vi.fn().mockResolvedValue({ id: "gk" }) },
    gelirKaydi: { create: vi.fn(async ({ data }) => ({ id: "gelir", ...data })) },
    masrafKategori: { findFirst: vi.fn().mockResolvedValue({ id: "mk" }), create: vi.fn() },
    masraf: { create: vi.fn(async ({ data }) => ({ id: `masraf-${data.kategoriId}-${data.toplam}`, ...data })) },
    dovizIslemi: { create: vi.fn(async ({ data }) => data) },
  };
  const service = new DovizIslemService({} as any, { tarihDogrula: vi.fn() } as any, {} as any);
  return { tx, service };
}

const hesaplar = { usd: { ad: "Ziraat USD", dovizCinsi: "USD" }, tl: { ad: "Ziraat TL", dovizCinsi: "TRY" }, usd2: { ad: "İş USD", dovizCinsi: "USD" } };

describe("DovizIslemService (P1-2a)", () => {
  it("bozdurmada TCMB üstündeki tutarı kambiyo kârı olarak gelire yazar", async () => {
    const { tx, service } = kur(hesaplar);
    const islem = await service.olusturTx(tx as any, "t1", { kaynakBankaHesapId: "usd", hedefBankaHesapId: "tl", cikanTutar: "1000", girenTutar: "41250", tarih: "2026-10-02", masrafHesabi: "cikan" });
    expect(tx.kasaBankaHareket.create.mock.calls[0][0].data).toMatchObject({ tip: "virman_gidis", dovizCinsi: "USD", kaynakTur: "doviz_islem" });
    expect(tx.kasaBankaHareket.create.mock.calls[0][0].data.tutarTry.toFixed(2)).toBe("41000.00");
    expect(tx.kasaBankaHareket.create.mock.calls[1][0].data).toMatchObject({ tip: "virman_gelis", dovizCinsi: "TRY" });
    expect(tx.gelirKaydi.create.mock.calls[0][0].data.netTutar.toFixed(2)).toBe("250.00");
    expect(tx.masraf.create).not.toHaveBeenCalled();
    expect(islem).toMatchObject({ kambiyoGelirId: "gelir", kambiyoMasrafId: null });
    expect(islem.farkTry.toFixed(2)).toBe("250.00");
  });

  it("alımda fazla ödenen tutarı ödenmiş kambiyo zararı masrafı yapar; banka masrafını ayrı ödeme fişiyle yazar", async () => {
    const { tx, service } = kur(hesaplar);
    const islem = await service.olusturTx(tx as any, "t1", { kaynakBankaHesapId: "tl", hedefBankaHesapId: "usd", cikanTutar: "41500", girenTutar: "1000", tarih: "2026-10-02", masrafTutar: "25", masrafHesabi: "cikan" });
    const [zarar, banka] = tx.masraf.create.mock.calls.map((c) => c[0].data);
    expect(zarar).toMatchObject({ odemeDurumu: "odendi", kaynakTur: "doviz_islem", dovizCinsi: "TRY" });
    expect(zarar.toplam.toFixed(2)).toBe("500.00");
    expect(zarar.hareketId).toBeUndefined();
    expect(banka.toplam.toFixed(2)).toBe("25.00");
    expect(tx.kasaBankaHareket.create.mock.calls[2][0].data).toMatchObject({ tip: "tediye", bankaHesapId: "tl" });
    expect(islem.farkTry.toFixed(2)).toBe("-500.00");
    expect(islem.bankaMasrafId).toBeTruthy();
  });

  it("aynı dövizdeki hesaplar arasında işlem yapmaz", async () => {
    const { tx, service } = kur(hesaplar);
    await expect(service.olusturTx(tx as any, "t1", { kaynakBankaHesapId: "usd", hedefBankaHesapId: "usd2", cikanTutar: "1", girenTutar: "1", tarih: "2026-10-02", masrafHesabi: "cikan" })).rejects.toThrow(/virman kullanın/);
  });
});
