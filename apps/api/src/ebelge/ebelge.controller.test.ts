import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { EbelgeController } from "./ebelge.controller";

describe("EbelgeController.gelenFiyatAnalizi", () => {
  const stokId = "11111111-1111-4111-8111-111111111111";
  it("yalnız doğrulanmış eşleştirmeleri iletir", async () => {
    const servis = { gelenFiyatAnalizi: vi.fn().mockResolvedValue({ satirlar: [] }) };
    const c = new EbelgeController(servis as never, {} as never, {} as never, {} as never);
    await c.gelenFiyatAnalizi(stokId, { satirEslesmeleri: [{ siraNo: 1, stokId }] });
    expect(servis.gelenFiyatAnalizi).toHaveBeenCalledWith(stokId, [{ siraNo: 1, stokId }]);
  });
  it("istemci tutarını, tekrar eden eşleştirmeyi ve sınır aşımını servise göndermez", async () => {
    const servis = { gelenFiyatAnalizi: vi.fn() };
    const c = new EbelgeController(servis as never, {} as never, {} as never, {} as never);
    const e = { siraNo: 1, stokId };
    for (const govde of [{ satirEslesmeleri: [e], matrah: 1 }, { satirEslesmeleri: [e, e] },
      { satirEslesmeleri: Array.from({ length: 101 }, (_, i) => ({ ...e, siraNo: i + 1 })) }]) {
      await expect(c.gelenFiyatAnalizi(stokId, govde)).rejects.toThrow("Geçersiz fiyat analizi");
    }
    expect(servis.gelenFiyatAnalizi).not.toHaveBeenCalled();
  });
  it("muhasebe rolü ve e-Fatura uygulama kapısı gerektirir", () => {
    expect(Reflect.getMetadata("roller", EbelgeController.prototype.gelenFiyatAnalizi)).toEqual(["muhasebe"]);
    expect(Reflect.getMetadata("ebelgeUygulamasi", EbelgeController.prototype.gelenFiyatAnalizi)).toEqual(["efatura"]);
  });
});

/**
 * Gönderim ucunun kapısı. Sihirbazın `gonderilebilir` bayrağı yalnız bağlantı,
 * kimlik ve tarih kontrollerini anlatır; türe özel eksikler (ihracat, internet
 * satışı) kendi listelerinde döner. Uç bu listelere bakmazsa eksik belge
 * kuyruğa girer, hata orada patlar ve kullanıcı gönderildi sanır — 2026-09-18'de
 * uygulama çalıştırılırken tam olarak bu oldu.
 */
describe("EbelgeController.gonder", () => {
  const kur = (wizard: Record<string, unknown>) => {
    const ebelge = {
      wizardBilgisi: vi.fn().mockResolvedValue(wizard),
      ihracatBilgisiniKaydet: vi.fn().mockResolvedValue(undefined),
      internetSatisiniKaydet: vi.fn().mockResolvedValue(undefined),
      earsivGonderimSekliniKaydet: vi.fn().mockResolvedValue(undefined),
    };
    const kuyruk = { kuyrugaEkle: vi.fn().mockResolvedValue({ isId: "is-1", durum: "waiting" }) };
    const controller = new EbelgeController(ebelge as never, kuyruk as never, {} as never);
    return { controller, ebelge, kuyruk };
  };

  it("eksiksiz faturayı kuyruğa alır", async () => {
    const { controller, kuyruk } = kur({ gonderilebilir: true, internetSatisi: { engeller: [] } });

    await expect(controller.gonder("f1", { earsivGonderimSekli: "elektronik" })).resolves.toMatchObject({ isId: "is-1" });
    expect(kuyruk.kuyrugaEkle).toHaveBeenCalledWith("f1");
  });

  it("internet satışı eksikse kuyruğa almaz, sebebi söyler", async () => {
    const { controller, kuyruk } = kur({
      gonderilebilir: true,
      internetSatisi: { engeller: [{ alan: "webAdresi", mesaj: "Satışın yapıldığı web adresi girilmelidir" }] },
    });

    await expect(controller.gonder("f1", { internetSatisi: { internetSatisi: true } })).rejects.toThrow(
      new BadRequestException("Satışın yapıldığı web adresi girilmelidir"),
    );
    expect(kuyruk.kuyrugaEkle).not.toHaveBeenCalled();
  });

  it("ihracat eksikse kuyruğa almaz", async () => {
    const { controller, kuyruk } = kur({
      gonderilebilir: true,
      ihracat: { engeller: [{ alan: "teslimTarihi", mesaj: "Fiili ihracat tarihi girilmelidir" }] },
    });

    await expect(controller.gonder("f1", {})).rejects.toThrow("Fiili ihracat tarihi girilmelidir");
    expect(kuyruk.kuyrugaEkle).not.toHaveBeenCalled();
  });

  it("türe özel alanlar önce kaydedilir; eksik listesi kaydedilmiş hâle göre üretilir", async () => {
    const { controller, ebelge } = kur({ gonderilebilir: true, internetSatisi: { engeller: [] } });

    await controller.gonder("f1", { ihracat: { teslimSarti: "FOB" }, internetSatisi: { internetSatisi: false } });

    expect(ebelge.ihracatBilgisiniKaydet).toHaveBeenCalledWith("f1", { teslimSarti: "FOB" });
    expect(ebelge.internetSatisiniKaydet).toHaveBeenCalledWith("f1", { internetSatisi: false });
    const kayitSirasi = ebelge.ihracatBilgisiniKaydet.mock.invocationCallOrder[0];
    expect(kayitSirasi).toBeLessThan(ebelge.wizardBilgisi.mock.invocationCallOrder[0]);
  });
});

describe("EbelgeController.onizle (L)", () => {
  const kur = (wizard: Record<string, unknown>) => {
    const ebelge = {
      wizardBilgisi: vi.fn().mockResolvedValue(wizard),
      ihracatBilgisiniKaydet: vi.fn().mockResolvedValue(undefined),
      internetSatisiniKaydet: vi.fn().mockResolvedValue(undefined),
      earsivGonderimSekliniKaydet: vi.fn().mockResolvedValue(undefined),
      onizle: vi.fn().mockResolvedValue({ destekleniyor: true, basarili: true, html: "<html/>" }),
    };
    const kuyruk = { kuyrugaEkle: vi.fn() };
    return { controller: new EbelgeController(ebelge as never, kuyruk as never, {} as never), ebelge, kuyruk };
  };

  it("seçimleri kaydedip önizler, kuyruğa hiçbir şey almaz", async () => {
    const { controller, ebelge, kuyruk } = kur({ gonderilebilir: true, internetSatisi: { engeller: [] } });
    await expect(controller.onizle("f1", { earsivGonderimSekli: "kagit" })).resolves.toMatchObject({ basarili: true });
    expect(ebelge.earsivGonderimSekliniKaydet).toHaveBeenCalledWith("f1", "kagit");
    expect(ebelge.onizle).toHaveBeenCalledWith("f1");
    expect(kuyruk.kuyrugaEkle).not.toHaveBeenCalled();
  });

  it("eksik varken önizlemeye gitmez", async () => {
    const { controller, ebelge } = kur({
      gonderilebilir: true,
      iade: { engeller: [{ mesaj: "İade edilen en az bir fatura seçilmeli ya da numarasıyla girilmelidir" }] },
    });
    await expect(controller.onizle("f1", {})).rejects.toThrow("İade edilen en az bir fatura");
    expect(ebelge.onizle).not.toHaveBeenCalled();
  });
});
