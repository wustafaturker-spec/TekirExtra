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
        toplam: new Prisma.Decimal(240),
        satirlar: [{ stokId: "s1", varyantId: null, miktar: new Prisma.Decimal(2), birimFiyat: new Prisma.Decimal(120), kdvOrani: new Prisma.Decimal(20), stok: { anaBirim: "adet", kdvOrani: new Prisma.Decimal(10) } }] }),
      update, updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    }, cariHesap: { findFirst: vi.fn().mockResolvedValue({ id: "c1" }) } };
    const faturaOlustur = vi.fn().mockResolvedValue({ id: "f1" });
    const servis = new PazaryeriService({ tenantIslem: vi.fn((_id, fn) => fn(tx)) } as any, { olustur: faturaOlustur } as any);
    const sonuc = await servis.faturalastir([{ siparisId: "p1", cariId: "c1" }]);
    expect(sonuc).toEqual(expect.objectContaining({ basarili: 1, hatali: 0 }));
    // PZR-01: 2 × 120 TL KDV dahil (%20) → net birim 100, fatura toplamı 240 (288 değil).
    expect(faturaOlustur).toHaveBeenCalledWith(expect.objectContaining({ tip: "satis", cariId: "c1", satirlar: [expect.objectContaining({ birimFiyat: "100.0000", kdvOrani: "20" })] }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ faturaId: "f1", durum: "faturalandi" }) }));
  });

  it("PZR-01/03: toplam tutmazsa fatura açılmaz; oran gelmediyse stok kartının oranı kullanılır", async () => {
    const yap = (toplam: number, kdvOrani: Prisma.Decimal | null) => {
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });
      const tx = { pazaryeriSiparis: {
        findUnique: vi.fn().mockResolvedValue({ id: "p1", siparisNo: "SP-42", siparisTarihi: new Date("2026-08-10"), dovizCinsi: "TRY", durum: "faturalanmaya_hazir", faturaId: null, toplam: new Prisma.Decimal(toplam),
          satirlar: [{ stokId: "s1", varyantId: null, miktar: new Prisma.Decimal(1), birimFiyat: new Prisma.Decimal(110), kdvOrani, stok: { anaBirim: "adet", kdvOrani: new Prisma.Decimal(10) } }] }),
        update: vi.fn(), updateMany,
      }, cariHesap: { findFirst: vi.fn().mockResolvedValue({ id: "c1" }) } };
      const olustur = vi.fn().mockResolvedValue({ id: "f1" });
      return { servis: new PazaryeriService({ tenantIslem: vi.fn((_id, fn) => fn(tx)) } as any, { olustur } as any), olustur, updateMany };
    };
    const tamam = yap(110, null);
    expect(await tamam.servis.faturalastir([{ siparisId: "p1", cariId: "c1" }])).toEqual(expect.objectContaining({ basarili: 1 }));
    expect(tamam.olustur).toHaveBeenCalledWith(expect.objectContaining({ satirlar: [expect.objectContaining({ birimFiyat: "100.0000", kdvOrani: "10" })] }));

    const tutmaz = yap(132, null); // KDV hariç yorumlansaydı 110 + %20 = 132 olurdu
    const sonuc = await tutmaz.servis.faturalastir([{ siparisId: "p1", cariId: "c1" }]);
    expect(sonuc).toEqual(expect.objectContaining({ basarili: 0, hatali: 1 }));
    expect(sonuc.sonuclar[0].hata).toContain("Tutar uyuşmuyor");
    expect(tutmaz.olustur).not.toHaveBeenCalled();
    expect(tutmaz.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "hata" }) }));
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

  it("PZR-06: faturalı ya da sınıflandırılmamış kesinti giderleştirilmez, hareket açılmaz", async () => {
    for (const [sinif, beklenen] of [["faturali", /e-Faturadan alış/], ["siniflandirilmamis", /Yalnız stopaj/]] as const) {
      const create = vi.fn();
      const tx = {
        kasa: { findFirst: vi.fn().mockResolvedValue({ dovizCinsi: "TRY" }) }, bankaHesap: { findFirst: vi.fn() },
        pazaryeriKesinti: { findMany: vi.fn().mockResolvedValue([{ id: "k1", durum: "bekliyor", sinif, tur: "Commission", siparisNo: null, aciklama: null, tarih: new Date("2026-08-10"), tutar: new Prisma.Decimal(24), dovizCinsi: "TRY" }]), updateMany: vi.fn(), update: vi.fn() },
        kasaBankaHareket: { create },
      };
      const servis = new PazaryeriService({ tenantIslem: vi.fn((_id, fn) => fn(tx)) } as any, {} as any);
      await expect(servis.kesintileriGiderlestir({ kesintiIds: ["11111111-1111-4111-8111-111111111111"], kasaId: "22222222-2222-4222-8222-222222222222", kur: 1 })).rejects.toThrow(beklenen);
      expect(create).not.toHaveBeenCalled();
    }
  });

  it("PZR-06: içe aktarılan kesinti sınıflanır; ceza doğrudan faturasız durumda başlar", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "k1" });
    const tx = { baglanti: { findFirst: vi.fn().mockResolvedValue({ id: siparis.baglantiId }) }, pazaryeriKesinti: { upsert } };
    const servis = new PazaryeriService({ tenantIslem: vi.fn((_id, fn) => fn(tx)) } as any, {} as any);
    await servis.kesintiIceAktar({ baglantiId: siparis.baglantiId, hariciId: "f-1", tur: "Commission", tarih: "2026-08-10", tutar: 24, dovizCinsi: "TRY" });
    await servis.kesintiIceAktar({ baglantiId: siparis.baglantiId, hariciId: "f-2", tur: "Late shipment penalty", tarih: "2026-08-10", tutar: 10, dovizCinsi: "TRY" });
    expect(upsert.mock.calls[0][0].create).toEqual(expect.objectContaining({ sinif: "faturali", durum: "bekliyor" }));
    expect(upsert.mock.calls[1][0].create).toEqual(expect.objectContaining({ sinif: "ceza", durum: "faturasiz" }));
    expect(upsert.mock.calls[0][0].update).not.toHaveProperty("sinif");
  });

  it("bekleyen kesintiyi kaynak referansli tediye giderine donusturur", async () => {
    const hareketCreate = vi.fn().mockResolvedValue({ id: "h1" });
    const kesintiUpdate = vi.fn().mockResolvedValue({});
    const kesintiUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      kasa: { findFirst: vi.fn().mockResolvedValue({ dovizCinsi: "TRY" }) },
      bankaHesap: { findFirst: vi.fn() },
      pazaryeriKesinti: { findMany: vi.fn().mockResolvedValue([{ id: "k1", durum: "bekliyor", sinif: "stopaj", tur: "stopaj", siparisNo: "SP-42", aciklama: null, tarih: new Date("2026-08-10"), tutar: new Prisma.Decimal(24), dovizCinsi: "TRY" }]), updateMany: kesintiUpdateMany, update: kesintiUpdate },
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
