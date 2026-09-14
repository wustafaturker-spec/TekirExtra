import { describe, expect, it, afterEach, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { istekBaglami } from "../core/istek-baglami";
import { sifrele } from "../core/kripto";
import { BaglantilarService, baglantiOlusturSemasi } from "./baglantilar.service";

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
    const prisma = { tenantIslem: vi.fn(async (_t, cb) => cb({ baglanti: { findUnique: async () => kayit, update } })) } as never;
    const servis = new BaglantilarService(prisma);
    vi.spyOn(servis, "adapterCoz").mockReturnValue({ baglantiTest: async () => ({ basarili: true }) } as never);

    await baglamda(() => servis.test("b1"));

    expect(update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { durum: "pasif" } });
  });

  it("zaten aktif olan bağlantı başarılı testten sonra aktif kalır", async () => {
    const update = vi.fn().mockResolvedValue({});
    const kayit = { id: "b1", aile: "ebelge", saglayici: "nes", durum: "aktif",
      sifreliConfig: sifrele(JSON.stringify({ saglayici: "nes" })) };
    const prisma = { tenantIslem: vi.fn(async (_t, cb) => cb({ baglanti: { findUnique: async () => kayit, update } })) } as never;
    const servis = new BaglantilarService(prisma);
    vi.spyOn(servis, "adapterCoz").mockReturnValue({ baglantiTest: async () => ({ basarili: true }) } as never);

    await baglamda(() => servis.test("b1"));

    expect(update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { durum: "aktif" } });
  });

  it("başarısız test bağlantıyı hata durumuna alır", async () => {
    const update = vi.fn().mockResolvedValue({});
    const kayit = { id: "b1", aile: "ebelge", saglayici: "nes", durum: "aktif",
      sifreliConfig: sifrele(JSON.stringify({ saglayici: "nes" })) };
    const prisma = { tenantIslem: vi.fn(async (_t, cb) => cb({ baglanti: { findUnique: async () => kayit, update } })) } as never;
    const servis = new BaglantilarService(prisma);
    vi.spyOn(servis, "adapterCoz").mockReturnValue({ baglantiTest: async () => ({ basarili: false, mesaj: "olmadı" }) } as never);

    await baglamda(() => servis.test("b1"));

    expect(update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { durum: "hata" } });
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
