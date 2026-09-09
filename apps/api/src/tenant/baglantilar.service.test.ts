import { describe, expect, it, afterEach, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { istekBaglami } from "../core/istek-baglami";
import { sifrele } from "../core/kripto";
import { BaglantilarService } from "./baglantilar.service";

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
