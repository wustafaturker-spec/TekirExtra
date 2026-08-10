import { describe, expect, it, vi } from "vitest";
import { PazaryeriService } from "./pazaryeri.service";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1" }) }));

const siparis = {
  baglantiId: "11111111-1111-4111-8111-111111111111", hariciId: "PKT-42", siparisNo: "SP-42",
  siparisTarihi: "2026-08-10T12:00:00.000Z", musteriUnvani: "Ada Yılmaz", dovizCinsi: "TRY" as const,
  toplam: 240, satirlar: [{ hariciSatirId: "1", sku: "TS-RED-M", urunAdi: "Tişört", miktar: 2, birimFiyat: 120, kdvOrani: 20 }],
};

describe("PazaryeriService", () => {
  it("ayni harici siparisi ikinci kez olusturmaz", async () => {
    const mevcut = { id: "p1", hariciId: "PKT-42" };
    const create = vi.fn();
    const tx = {
      baglanti: { findFirst: vi.fn().mockResolvedValue({ id: siparis.baglantiId }) },
      pazaryeriSiparis: { findUnique: vi.fn().mockResolvedValue(mevcut), create },
    };
    const servis = new PazaryeriService({ tenantIslem: vi.fn((_id, fn) => fn(tx)) } as any);
    await expect(servis.iceAktar(siparis)).resolves.toEqual(mevcut);
    expect(create).not.toHaveBeenCalled();
  });

  it("SKU varyantla eslesince siparisi faturalanmaya hazir isaretler", async () => {
    const create = vi.fn().mockImplementation(({ data }) => data);
    const tx = {
      baglanti: { findFirst: vi.fn().mockResolvedValue({ id: siparis.baglantiId }) },
      pazaryeriSiparis: { findUnique: vi.fn().mockResolvedValue(null), create },
      stokVaryant: { findFirst: vi.fn().mockResolvedValue({ id: "v1", stokId: "s1" }) },
      stokKart: { findFirst: vi.fn() },
    };
    const servis = new PazaryeriService({ tenantIslem: vi.fn((_id, fn) => fn(tx)) } as any);
    const sonuc = await servis.iceAktar(siparis) as any;
    expect(sonuc.durum).toBe("faturalanmaya_hazir");
    expect(sonuc.satirlar.create[0]).toEqual(expect.objectContaining({ stokId: "s1", varyantId: "v1" }));
  });
});
