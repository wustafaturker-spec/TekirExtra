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

  it("hazir siparisi taslak satis faturasina donusturur", async () => {
    const update = vi.fn().mockResolvedValue({});
    const tx = { pazaryeriSiparis: {
      findUnique: vi.fn().mockResolvedValue({ id: "p1", siparisNo: "SP-42", siparisTarihi: new Date("2026-08-10"), dovizCinsi: "TRY", faturaId: null,
        satirlar: [{ stokId: "s1", varyantId: null, miktar: { toString: () => "2" }, birimFiyat: { toString: () => "120" }, kdvOrani: { toString: () => "20" } }] }),
      update, updateMany: vi.fn(),
    } };
    const faturaOlustur = vi.fn().mockResolvedValue({ id: "f1" });
    const servis = new PazaryeriService({ tenantIslem: vi.fn((_id, fn) => fn(tx)) } as any, { olustur: faturaOlustur } as any);
    const sonuc = await servis.faturalastir([{ siparisId: "p1", cariId: "c1" }]);
    expect(sonuc).toEqual(expect.objectContaining({ basarili: 1, hatali: 0 }));
    expect(faturaOlustur).toHaveBeenCalledWith(expect.objectContaining({ tip: "satis", cariId: "c1" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ faturaId: "f1", durum: "faturalandi" }) }));
  });
});
