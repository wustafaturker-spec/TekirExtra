import { describe, expect, it, afterEach, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { istekBaglami } from "../core/istek-baglami";
import { coz, sifrele } from "../core/kripto";
import { BaglantilarService, baglantiGuncelleSemasi, baglantiOlusturSemasi } from "./baglantilar.service";

// Şifreli config yazıp okuyabilmek için testlik sabit anahtar.
process.env.BAGLANTI_SIFRELEME_ANAHTARI ??= "0".repeat(64);

function baglamda<T>(fn: () => Promise<T>): Promise<T> {
  return istekBaglami.run({ deger: { tenantId: "tenant-1", userId: "user-1", rol: "yonetici" } }, fn);
}

function txIle(saglayici: string, config: Record<string, unknown>) {
  return {
    baglanti: {
      findFirst: vi.fn().mockResolvedValue({ saglayici, sifreliConfig: sifrele(JSON.stringify({ saglayici, ...config })) }),
    },
  } as never;
}

describe("BaglantilarService adapter güvenliği", () => {
  const onceki = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = onceki;
    delete process.env.ALLOW_MOCK_ENTEGRATIONS;
  });

  it("production ortamında gerçek adapter olmayan sağlayıcıyı engeller", () => {
    process.env.NODE_ENV = "production";
    const servis = new BaglantilarService({} as never);
    expect(() => servis.adapterCoz("foriba")).toThrow(BadRequestException);
  });

  it("geliştirme ortamında mock adapter kullanımını korur", () => {
    process.env.NODE_ENV = "development";
    const servis = new BaglantilarService({} as never);
    expect(servis.adapterCoz("foriba")).toBeDefined();
  });
});

describe("BaglantilarService numaralandırma sahibi", () => {
  const servis = new BaglantilarService({} as never);

  it("otomatik seri tanımlıysa numarayı sağlayıcıya bırakır", async () => {
    const sonuc = await baglamda(() =>
      servis.numaralandirma(txIle("nes", { apiAnahtari: "a", servisAdresi: "https://x", belgeSeriOneki: "K07" })),
    );
    expect(sonuc).toEqual({ saglayiciAtar: true, seriOneki: "K07" });
  });

  it("seri öneki yoksa numarayı kendi sayacımız atar", async () => {
    // NES yetenekli olsa da önek yoksa firma otomatik olmayan seri kullanıyordur.
    const sonuc = await baglamda(() => servis.numaralandirma(txIle("nes", { apiAnahtari: "a" })));
    expect(sonuc).toEqual({ saglayiciAtar: false });
  });

  it("numarayı bizden bekleyen sağlayıcıda devir olmaz", async () => {
    // Sovos numarayı UBL içinde hazır ister; devretmek seriyi bozardı.
    const sonuc = await baglamda(() => servis.numaralandirma(txIle("sovos", { belgeSeriOneki: "K07" })));
    expect(sonuc).toEqual({ saglayiciAtar: false });
  });

  it("aktif e-belge bağlantısı yoksa devir olmaz", async () => {
    const tx = { baglanti: { findFirst: vi.fn().mockResolvedValue(null) } } as never;
    await expect(baglamda(() => servis.numaralandirma(tx))).resolves.toEqual({ saglayiciAtar: false });
  });
});

describe("BaglantilarService bağlantı testi", () => {
  it("başarılı test pasif bağlantıyı aktifleştirmez", async () => {
    // İkinci bir e-Belge bağlantısını test etmek, tek aktif sağlayıcı kuralını
    // atlayarak iki aktif kayıt doğuruyordu.
    const update = vi.fn().mockResolvedValue({});
    const kayit = { id: "b1", aile: "ebelge", saglayici: "nes", durum: "pasif",
      sifreliConfig: sifrele(JSON.stringify({ saglayici: "nes" })) };
    const prisma = { tenantIslem: vi.fn(async (_t, cb) => cb({ baglanti: { findUnique: async () => kayit, update }, auditLog: { create: vi.fn() } })) } as never;
    const servis = new BaglantilarService(prisma);
    vi.spyOn(servis, "adapterCoz").mockReturnValue({ baglantiTest: async () => ({ basarili: true }) } as never);

    await baglamda(() => servis.test("b1"));

    expect(update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { durum: "pasif" } });
  });

  it("zaten aktif olan bağlantı başarılı testten sonra aktif kalır", async () => {
    const update = vi.fn().mockResolvedValue({});
    const kayit = { id: "b1", aile: "ebelge", saglayici: "nes", durum: "aktif",
      sifreliConfig: sifrele(JSON.stringify({ saglayici: "nes" })) };
    const prisma = { tenantIslem: vi.fn(async (_t, cb) => cb({ baglanti: { findUnique: async () => kayit, update }, auditLog: { create: vi.fn() } })) } as never;
    const servis = new BaglantilarService(prisma);
    vi.spyOn(servis, "adapterCoz").mockReturnValue({ baglantiTest: async () => ({ basarili: true }) } as never);

    await baglamda(() => servis.test("b1"));

    expect(update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { durum: "aktif" } });
  });

  it("başarısız test bağlantıyı hata durumuna alır", async () => {
    const update = vi.fn().mockResolvedValue({});
    const kayit = { id: "b1", aile: "ebelge", saglayici: "nes", durum: "aktif",
      sifreliConfig: sifrele(JSON.stringify({ saglayici: "nes" })) };
    const prisma = { tenantIslem: vi.fn(async (_t, cb) => cb({ baglanti: { findUnique: async () => kayit, update }, auditLog: { create: vi.fn() } })) } as never;
    const servis = new BaglantilarService(prisma);
    vi.spyOn(servis, "adapterCoz").mockReturnValue({ baglantiTest: async () => ({ basarili: false, mesaj: "olmadı" }) } as never);

    await baglamda(() => servis.test("b1"));

    expect(update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { durum: "hata" } });
  });
});

describe("BaglantilarService seri denetimi (EBLG-97)", () => {
  const IRS_OTOMATIK = [{ tur: "eirsaliye", seri: "IRS", otomatik: true, aktif: true }, { tur: "eirsaliye", seri: "GBZ", otomatik: false, aktif: true }];
  function kur(config: Record<string, unknown>) {
    const update = vi.fn().mockResolvedValue({ id: "b1", aile: "ebelge", saglayici: "nes", durum: "aktif", sifreliConfig: sifrele(JSON.stringify({ saglayici: "nes", ...config })) });
    const updateMany = vi.fn();
    const kayit = { id: "b1", aile: "ebelge", saglayici: "nes", durum: "pasif", sifreliConfig: sifrele(JSON.stringify({ saglayici: "nes", ...config })) };
    const tx = {
      baglanti: { findUnique: async () => kayit, update, updateMany },
      auditLog: { create: vi.fn() },
      tenant: { findUnique: async () => ({ vkn: "1234567802", efaturaMukellefi: true, earsivMukellefi: true, eirsaliyeMukellefi: true }) },
      gibMukellef: { findFirst: async () => null, count: async () => 0 },
      gibMukellefSenkron: { findFirst: async () => null },
    };
    const prisma = { tenantIslem: vi.fn(async (_t, cb) => cb(tx)) } as never;
    const servis = new BaglantilarService(prisma);
    vi.spyOn(servis, "adapterCoz").mockReturnValue({ baglantiTest: async () => ({ basarili: true, mesaj: "NES REST bağlantısı doğrulandı" }), seriTanimlari: async () => IRS_OTOMATIK } as never);
    return { servis, update };
  }

  it("otomatik e-İrsaliye serisiyle bağlantıyı etkinleştirmez", async () => {
    const { servis, update } = kur({ eirsaliyeSeriOneki: "IRS" });
    await expect(baglamda(() => servis.aktifEt("b1"))).rejects.toThrow(/IRS entegratörde otomatik numaralı/);
    expect(update).not.toHaveBeenCalled();
  });

  it("elle numaralı seriyle etkinleştirir", async () => {
    const { servis, update } = kur({ eirsaliyeSeriOneki: "GBZ" });
    await baglamda(() => servis.aktifEt("b1"));
    expect(update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { durum: "aktif" } });
  });

  it("bağlantı testi seri hatasını başarısızlık olarak bildirir", async () => {
    const { servis } = kur({});
    const sonuc = await baglamda(() => servis.test("b1"));
    expect(sonuc).toMatchObject({ basarili: false, mesaj: expect.stringContaining("e-İrsaliye seri öneki girilmemiş") });
  });
});

describe("BaglantilarService güncelleme (EBLG-01b)", () => {
  const ESKI = { kullaniciAdi: "test01@nes.com.tr", apiAnahtari: "gizli-anahtar", belgeSeriOneki: "K07", earsivSeriOneki: "SNC", testOrtami: true };

  function kurulum(saglayici = "nes", config: Record<string, unknown> = ESKI) {
    const update = vi.fn().mockImplementation(({ data }: { data: { sifreliConfig: string; durum: string } }) => ({
      id: "b1", aile: "ebelge", saglayici, durum: data.durum, sifreliConfig: data.sifreliConfig,
    }));
    const tx = {
      baglanti: {
        findUnique: vi.fn().mockResolvedValue({ id: "b1", aile: "ebelge", saglayici, durum: "aktif", sifreliConfig: sifrele(JSON.stringify({ saglayici, ...config })) }),
        update,
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = { tenantIslem: (_tenantId: string, fn: (t: typeof tx) => unknown) => fn(tx) };
    const saklanan = () => JSON.parse(coz(update.mock.calls[0][0].data.sifreliConfig)) as Record<string, unknown>;
    const denetim = () => tx.auditLog.create.mock.calls.map((c) => c[0].data);
    return { servis: new BaglantilarService(prisma as never), saklanan, denetim };
  }

  it("güncelleme denetim izine yazılır; değişen gizli alan değeriyle yazılmaz (yönetim P1-4)", async () => {
    const { servis, denetim } = kurulum();
    await baglamda(() => servis.guncelle("b1", { config: { kullaniciAdi: "yeni@nes.com.tr", belgeSeriOneki: "K08", earsivSeriOneki: "SNC", testOrtami: true } }));
    expect(denetim()).toEqual([{
      tenantId: "tenant-1", userId: "user-1", islem: "baglanti_guncellendi", varlik: "baglanti", varlikId: "b1",
      detay: { aile: "ebelge", saglayici: "nes", degisiklikler: { kullaniciAdi: { eski: "•••", yeni: "•••" }, belgeSeriOneki: { eski: "K07", yeni: "K08" } } },
    }]);
    expect(JSON.stringify(denetim())).not.toContain("yeni@nes.com.tr");
  });

  it("boş bırakılan gizli alanları korur, gönderilen gizli olmayan alanları olduğu gibi yazar", async () => {
    const { servis, saklanan } = kurulum();
    await baglamda(() => servis.guncelle("b1", { config: { belgeSeriOneki: "K08", earsivSeriOneki: "SNC", testOrtami: true } }));

    expect(saklanan()).toEqual({
      saglayici: "nes", kullaniciAdi: "test01@nes.com.tr", apiAnahtari: "gizli-anahtar",
      belgeSeriOneki: "K08", earsivSeriOneki: "SNC", testOrtami: true,
    });
  });

  it("gönderilmeyen gizli olmayan alan bilerek temizlenmiştir; yazılan gizli değer eskisinin yerine geçer", async () => {
    const { servis, saklanan } = kurulum();
    await baglamda(() => servis.guncelle("b1", { config: { apiAnahtari: "yeni-anahtar", earsivSeriOneki: "SNC", testOrtami: true } }));

    expect(saklanan().belgeSeriOneki).toBeUndefined();
    expect(saklanan().apiAnahtari).toBe("yeni-anahtar");
    expect(saklanan().kullaniciAdi).toBe("test01@nes.com.tr");
  });

  it("görünüm gizli olmayan ayarları taşır, gizli değerleri taşımaz", async () => {
    const { servis } = kurulum("sovos", { kullaniciAdi: "sovos-kullanici", parola: "gizli-parola", servisAdresi: "https://sovos.test/einvoice.svc", postaKutusuEtiketi: "urn:mail:pk@firma.test" });
    const sonuc = await baglamda(() => servis.guncelle("b1", { config: { servisAdresi: "https://sovos.test/einvoice.svc", postaKutusuEtiketi: "urn:mail:pk@firma.test" } }));

    expect(sonuc.ayarlar).toEqual({ servisAdresi: "https://sovos.test/einvoice.svc", postaKutusuEtiketi: "urn:mail:pk@firma.test" });
    expect(JSON.stringify(sonuc)).not.toContain("gizli-parola");
    expect(JSON.stringify(sonuc)).not.toContain("sovos-kullanici");
  });

  it("tasarım seçimini düzenlemede korur ve görünümde gösterir (EBLG-99)", async () => {
    const { servis, saklanan } = kurulum("nes", { ...ESKI, efaturaTasarimi: "TEKIR_EFATURA" });
    const sonuc = await baglamda(() => servis.guncelle("b1", { config: { belgeSeriOneki: "K07", earsivSeriOneki: "SNC", testOrtami: true } }));

    expect(saklanan().efaturaTasarimi).toBe("TEKIR_EFATURA");
    expect(sonuc.tasarimlar).toEqual({ efaturaTasarimi: "TEKIR_EFATURA" });
  });

  it("güncelleme gövdesinde kullanıcı adı zorunlu değildir", () => {
    expect(baglantiGuncelleSemasi.safeParse({ config: { belgeSeriOneki: "K07" } }).success).toBe(true);
  });
});

describe("BaglantilarService seri önekleri", () => {
  // GİB e-Fatura ve e-Arşiv serilerinin farklı olmasını ister; aynı önek
  // girilirse belge şematron kontrolünde reddediliyor (NES, 2026-09-10).
  const govde = (config: Record<string, unknown>) => ({
    aile: "ebelge", saglayici: "nes",
    config: { kullaniciAdi: "test", apiAnahtari: "a", testOrtami: true, ...config },
  });

  it("e-Arşiv serisi e-Fatura serisiyle aynıysa kabul etmez", () => {
    const sonuc = baglantiOlusturSemasi.safeParse(govde({ belgeSeriOneki: "K07", earsivSeriOneki: "K07" }));

    expect(sonuc.success).toBe(false);
    expect(sonuc.error!.issues[0].message).toContain("farklı olmalıdır");
  });

  it("farklı seriler geçerlidir", () => {
    expect(baglantiOlusturSemasi.safeParse(govde({ belgeSeriOneki: "K07", earsivSeriOneki: "SNC" })).success).toBe(true);
  });
});
