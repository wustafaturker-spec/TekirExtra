import { describe, expect, it, vi } from "vitest";
import {
  dosyaTurunuBelirle,
  magicBytesMimeBelirle,
  AZAMI_TOPLU_ADET,
  AZAMI_DOSYA_BOYUTU,
  belgeDosyasiniDogrula,
} from "./dosya-dogrulayici";
import {
  belgeAlanKanitlariniOlustur,
  belgeCaprazDogrula,
} from "./belge-kanit-dogrulayici";
import type { FisFaturaOcrSonuc } from "../ai.semalar";

describe("P-09 Belge Doğrulayıcı (dosya-dogrulayici)", () => {
  it("magic bytes ile gerçek PDF, JPEG, PNG ve WEBP tespit edilir", () => {
    const pdfBuf = Buffer.from("%PDF-1.4 header dummy content");
    expect(magicBytesMimeBelirle(pdfBuf)).toBe("application/pdf");

    const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(magicBytesMimeBelirle(jpegBuf)).toBe("image/jpeg");

    const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(magicBytesMimeBelirle(pngBuf)).toBe("image/png");

    const webpBuf = Buffer.from("RIFF....WEBPVP8 ");
    expect(magicBytesMimeBelirle(webpBuf)).toBe("image/webp");
  });

  it("sahte uzantılı veya geçersiz dosyaları reddeder", () => {
    const sahte = Buffer.from("This is just a text file disguised as pdf");
    expect(() => magicBytesMimeBelirle(sahte)).toThrow(/Desteklenmeyen dosya türü/);
  });

  it("15 MB boyut sınırını aşan dosyayı reddeder", async () => {
    const buyuk = Buffer.alloc(AZAMI_DOSYA_BOYUTU + 1024);
    await expect(belgeDosyasiniDogrula(buyuk)).rejects.toThrow(/azami izin verilen 15 MB/);
  });
});

describe("P-09 Alan Kanıtları ve Çapraz Doğrulama (belge-kanit-dogrulayici)", () => {
  const ornekFis: FisFaturaOcrSonuc = {
    belgeTuru: "FIS",
    belgeNo: "A-00123",
    tarih: "2026-11-15",
    saticiUnvan: "Migros Ticaret A.Ş.",
    saticiVknTckn: "6220084501",
    saticiVergiDairesi: "Kadıköy",
    saticiAdres: null,
    saticiTelefon: null,
    saticiEposta: null,
    saticiIban: null,
    paraBirimi: "TRY",
    toplamMatrah: 100,
    toplamKdv: 20,
    genelToplam: 120,
    kdvKirilimi: [{ oran: 20, matrah: 100, kdvTutari: 20 }],
    kalemler: [],
    guvenSkoru: 0.95,
    plaka: null,
    litre: null,
    odemeSekli: "nakit",
    kartSonDort: null,
  };

  it("metin içerisinden satıcı ve tutar için sayfa ve alıntı kanıtları çıkarır", () => {
    const hamMetin = "Fiş No: A-00123 Migros Ticaret A.Ş. Toplam KDV: 20.00 GENEL TOPLAM: 120.00";
    const kanitlar = belgeAlanKanitlariniOlustur(ornekFis, hamMetin);

    expect(kanitlar.saticiUnvan).toBeDefined();
    expect(kanitlar.saticiUnvan.alinti).toContain("Migros Ticaret");
    expect(kanitlar.genelToplam).toBeDefined();
    expect(kanitlar.genelToplam.guven).toBe(0.95);
  });

  it("matematiksel ve KDV tutarsızlığı olduğunda çelişki üretir ve aktarımı engeller", () => {
    const tutarsiz: FisFaturaOcrSonuc = {
      ...ornekFis,
      toplamMatrah: 100,
      toplamKdv: 20,
      genelToplam: 250, // Fark 130 TL!
    };

    const dogrulama = belgeCaprazDogrula(tutarsiz, null, "ESLESMEDI");
    expect(dogrulama.gecerli).toBe(false);
    expect(dogrulama.celiskiler.length).toBeGreaterThan(0);
    expect(dogrulama.celiskiler[0]).toContain("Tutar uyuşmazlığı");
  });

  it("satıcı ünvanı eksik veya genel toplam sıfır/negatif olduğunda çelişki üretir", () => {
    const eksik: FisFaturaOcrSonuc = {
      ...ornekFis,
      saticiUnvan: "",
      genelToplam: 0,
    };

    const dogrulama = belgeCaprazDogrula(eksik, null, "ESLESMEDI");
    expect(dogrulama.gecerli).toBe(false);
    expect(dogrulama.celiskiler).toContain("Satıcı ünvanı zorunludur.");
    expect(dogrulama.celiskiler).toContain("Genel toplam sıfır veya negatif olamaz.");
  });

  it("tutarlı ve geçerli belgede çelişki olmaz, eşleşme durumu tam sunulur", () => {
    const cari = { id: "cari-1", unvan: "Migros Ticaret A.Ş.", kod: "CAR-001" };
    const dogrulama = belgeCaprazDogrula(ornekFis, cari, "TAM_VKN");

    expect(dogrulama.gecerli).toBe(true);
    expect(dogrulama.matematikselUyumlu).toBe(true);
    expect(dogrulama.celiskiler).toHaveLength(0);
    expect(dogrulama.eslesmeKesinligi).toBe("TAM_VKN");
    expect(dogrulama.eslesenCari?.id).toBe("cari-1");
  });
});

describe("P-09 Belge Kuyruk Servisi (BelgeKuyrukService)", () => {
  it("çelişkili belge aktarılmak istendiğinde BadRequestException fırlatır", async () => {
    const { BelgeKuyrukService } = await import("./belge-kuyruk.service");
    const mockPrisma = {
      tenantIslem: vi.fn(async (_t, cb) => {
        const tx = {
          belgeOcrKaydi: {
            findUnique: vi.fn(async () => ({
              id: "belge-1",
              durum: "INCELENECEK",
              cikarilanVeri: { genelToplam: 100 },
              kullaniciDuzeltmesi: null,
              dogrulamaSonucu: {
                celiskiler: ["Tutar uyuşmazlığı: Matrah + KDV toplamı tutmuyor"],
              },
            })),
          },
        };
        return cb(tx);
      }),
    };

    const servis = new BelgeKuyrukService(
      mockPrisma as any,
      {} as any,
      {} as any,
    );

    await expect(
      servis.belgeAktar("tenant-1", "user-1", "belge-1", { hedef: "MASRAF" }),
    ).rejects.toThrow(/Belgedeki çelişkiler giderilmeden aktarım yapılamaz/);
  });

  it("düzeltme yapıldığında orijinal çıkarım korunur ve çelişkiler çözülürse durum ONAYLANDI olur", async () => {
    const { BelgeKuyrukService } = await import("./belge-kuyruk.service");
    let guncellenenVeri: any = null;

    const mockPrisma = {
      tenantIslem: vi.fn(async (_t, cb) => {
        const tx = {
          belgeOcrKaydi: {
            findUnique: vi.fn(async () => ({
              id: "belge-1",
              durum: "INCELENECEK",
              cikarilanVeri: {
                saticiUnvan: "Migros",
                toplamMatrah: 100,
                toplamKdv: 20,
                genelToplam: 250, // Hatalıydı
              },
              kullaniciDuzeltmesi: null,
            })),
            update: vi.fn(async ({ data }) => {
              guncellenenVeri = data;
              return { id: "belge-1", ...data };
            }),
          },
          cariHesap: {
            findUnique: vi.fn(async () => null),
          },
        };
        return cb(tx);
      }),
    };

    const servis = new BelgeKuyrukService(
      mockPrisma as any,
      {} as any,
      {} as any,
    );

    const sonuc = await servis.belgeDuzelt("tenant-1", "belge-1", {
      genelToplam: 120, // Kullanıcı düzeltti (100 + 20 = 120)
    });

    expect(sonuc.durum).toBe("ONAYLANDI");
    expect(guncellenenVeri.kullaniciDuzeltmesi).toEqual({ genelToplam: 120 });
    expect(guncellenenVeri.dogrulamaSonucu.celiskiler).toHaveLength(0);
  });

  it("onaylı belge Masraf taslağına başarıyla aktarılır ve durum ISLENDI yapılır", async () => {
    const { BelgeKuyrukService } = await import("./belge-kuyruk.service");
    let masrafData: any = null;
    let belgeUpdateData: any = null;

    const mockPrisma = {
      tenantIslem: vi.fn(async (_t, cb) => {
        const tx = {
          belgeOcrKaydi: {
            findUnique: vi.fn(async () => ({
              id: "belge-1",
              durum: "ONAYLANDI",
              ekId: "ek-1",
              cikarilanVeri: {
                belgeTuru: "FIS",
                saticiUnvan: "Migros",
                toplamMatrah: 100,
                toplamKdv: 20,
                genelToplam: 120,
                tarih: "2026-11-15",
              },
              kullaniciDuzeltmesi: null,
              dogrulamaSonucu: { celiskiler: [] },
            })),
            update: vi.fn(async ({ data }) => {
              belgeUpdateData = data;
              return { id: "belge-1", ...data };
            }),
          },
          masrafKategori: {
            findFirst: vi.fn(async () => ({ id: "kat-1" })),
          },
          masraf: {
            create: vi.fn(async ({ data }) => {
              masrafData = data;
              return { id: "masraf-99", ...data };
            }),
          },
          ek: {
            update: vi.fn(async () => ({})),
          },
        };
        return cb(tx);
      }),
    };

    const servis = new BelgeKuyrukService(
      mockPrisma as any,
      {} as any,
      {} as any,
    );

    const sonuc = await servis.belgeAktar("tenant-1", "user-1", "belge-1", {
      hedef: "MASRAF",
    });

    expect(sonuc.basarili).toBe(true);
    expect(sonuc.masrafId).toBe("masraf-99");
    expect(masrafData.saticiUnvan).toBe("Migros");
    expect(belgeUpdateData.durum).toBe("ISLENDI");
    expect(belgeUpdateData.olusanKayitlar).toEqual({ masrafIdler: ["masraf-99"] });
  });
});
