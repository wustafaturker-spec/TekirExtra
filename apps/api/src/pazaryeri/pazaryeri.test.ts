import { describe, expect, it, vi } from "vitest";
import { PazaryeriService } from "./pazaryeri.service";
import { Prisma } from "@prisma/client";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1" }) }));

const siparis = {
  baglantiId: "11111111-1111-4111-8111-111111111111", hariciId: "PKT-42", siparisNo: "SP-42",
  siparisTarihi: "2026-08-10T12:00:00.000Z", musteriUnvani: "Ada Yılmaz", dovizCinsi: "TRY" as const,
  toplam: 240, satirlar: [{ hariciSatirId: "1", sku: "TS-RED-M", urunAdi: "Tişört", miktar: 2, birimFiyat: 120, kdvOrani: 20 }],
};

describe("PazaryeriService", () => {
  it("ayni harici siparisi ikinci kez olusturmaz ve guncel bilgileri isler", async () => {
    const mevcut = { id: "p1", hariciId: "PKT-42", faturaId: null };
    const create = vi.fn(); const update = vi.fn().mockResolvedValue({ ...mevcut, musteriUnvani: siparis.musteriUnvani });
    const tx = {
      baglanti: { findFirst: vi.fn().mockResolvedValue({ id: siparis.baglantiId }) },
      pazaryeriSiparis: { findUnique: vi.fn().mockResolvedValue(mevcut), create, update },
    };
    const servis = new PazaryeriService({ tenantIslem: vi.fn((_id, fn) => fn(tx)) } as any);
    await expect(servis.iceAktar(siparis)).resolves.toEqual(expect.objectContaining({ id: "p1" }));
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ musteriUnvani: "Ada Yılmaz" }) }));
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
      findUnique: vi.fn().mockResolvedValue({ id: "p1", siparisNo: "SP-42", siparisTarihi: new Date("2026-08-10"), dovizCinsi: "TRY", durum: "faturalanmaya_hazir", faturaId: null,
        satirlar: [{ stokId: "s1", varyantId: null, miktar: { toString: () => "2" }, birimFiyat: { toString: () => "120" }, kdvOrani: { toString: () => "20" } }] }),
      update, updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    }, cariHesap: { findFirst: vi.fn().mockResolvedValue({ id: "c1" }) } };
    const faturaOlustur = vi.fn().mockResolvedValue({ id: "f1" });
    const servis = new PazaryeriService({ tenantIslem: vi.fn((_id, fn) => fn(tx)) } as any, { olustur: faturaOlustur } as any);
    const sonuc = await servis.faturalastir([{ siparisId: "p1", cariId: "c1" }]);
    expect(sonuc).toEqual(expect.objectContaining({ basarili: 1, hatali: 0 }));
    expect(faturaOlustur).toHaveBeenCalledWith(expect.objectContaining({ tip: "satis", cariId: "c1" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ faturaId: "f1", durum: "faturalandi" }) }));
  });

  it("komisyon kaydini yalnizca bir kez ice aktarir ve tekrarinda bilgileri gunceller", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "k1" });
    const tx = { baglanti: { findFirst: vi.fn().mockResolvedValue({ id: siparis.baglantiId }) }, pazaryeriKesinti: { upsert } };
    const servis = new PazaryeriService({ tenantIslem: vi.fn((_id, fn) => fn(tx)) } as any, {} as any);
    await servis.kesintiIceAktar({ baglantiId: siparis.baglantiId, hariciId: "fee-1", tur: "komisyon", tarih: "2026-08-10", tutar: 24, dovizCinsi: "TRY" });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_baglantiId_hariciId: { tenantId: "t1", baglantiId: siparis.baglantiId, hariciId: "fee-1" } }, update: expect.objectContaining({ tur: "komisyon" }),
    }));
  });

  it("bekleyen kesintiyi kaynak referansli tediye giderine donusturur", async () => {
    const hareketCreate = vi.fn().mockResolvedValue({ id: "h1" });
    const kesintiUpdate = vi.fn().mockResolvedValue({});
    const kesintiUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      kasa: { findFirst: vi.fn().mockResolvedValue({ dovizCinsi: "TRY" }) },
      bankaHesap: { findFirst: vi.fn() },
      pazaryeriKesinti: { findMany: vi.fn().mockResolvedValue([{ id: "k1", durum: "bekliyor", tur: "komisyon", siparisNo: "SP-42", aciklama: null, tarih: new Date("2026-08-10"), tutar: new Prisma.Decimal(24), dovizCinsi: "TRY" }]), updateMany: kesintiUpdateMany, update: kesintiUpdate },
      kasaBankaHareket: { create: hareketCreate },
    };
    const servis = new PazaryeriService({ tenantIslem: vi.fn((_id, fn) => fn(tx)) } as any, {} as any);
    const sonuc = await servis.kesintileriGiderlestir({ kesintiIds: ["11111111-1111-4111-8111-111111111111"], kasaId: "22222222-2222-4222-8222-222222222222", kur: 1 });
    expect(sonuc).toEqual({ giderlestirilen: 1 });
    expect(hareketCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ tip: "tediye", kaynakTur: "pazaryeri_kesinti", kaynakRef: "k1", tutarTry: new Prisma.Decimal(24) }) });
    expect(kesintiUpdateMany).toHaveBeenCalledWith({ where: { id: "k1", durum: "bekliyor", hareketId: null }, data: { durum: "giderlesti" } });
    expect(kesintiUpdate).toHaveBeenCalledWith({ where: { id: "k1" }, data: { hareketId: "h1" } });
  });
});
