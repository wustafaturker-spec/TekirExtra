import { describe, expect, it, vi } from "vitest";
import { baglamlaCalistir } from "../core/istek-baglami";
import { CariBelgeService } from "./cari-belge.service";

vi.mock("../core/guvenlik/dosya-dogrulama", () => ({
  dosyaIceriginiDogrula: vi.fn().mockResolvedValue("application/pdf"),
}));

vi.mock("./pdf-metin-ayristirici", () => ({
  pdfMetniniAyikla: vi.fn().mockResolvedValue("ÖRNEK TİCARET A.Ş. VKN: 1234567890 Beyoğlu VD Garanti TR120006200000012345678901"),
}));

describe("CariBelgeService", () => {
  const baglam = { tenantId: "t1", userId: "u1", rol: "yonetici" as never };

  it("yetki denetimi izinli araçlarda cari_olustur yoksa hata fırlatır", async () => {
    const yurutucu = { izinliAraclar: vi.fn(() => [{ ad: "baska_arac" }]) };
    const servis = new CariBelgeService({} as never, {} as never, yurutucu as never);
    await baglamlaCalistir(baglam, async () => {
      expect(servis.yetkiVar()).toBe(false);
      expect(() => servis.yetkiDenetle()).toThrow(/izin vermiyor/);
    });
  });

  it("dijital PDF'te metin çıkarılır, VKN e-fatura sorgulanır ve onay talebi açılır", async () => {
    const prisma = {
      tenantIslem: vi.fn().mockImplementation((_t, cb) => cb({
        gibMukellef: {
          findMany: vi.fn().mockResolvedValue([
            { vknTckn: "1234567890", belgeTuru: "efatura", tur: "ozel", ilkKayitZamani: new Date() },
          ]),
        },
        gibMukellefSenkron: {
          findUnique: vi.fn().mockResolvedValue({
            sonSenkronAt: new Date(),
            kayitSayisi: 1000,
          }),
        },
        cariHesap: { findMany: vi.fn().mockResolvedValue([{ kod: "C-0001" }]) },
      })),
    };
    const ai = {
      cariBilgisiCikar: vi.fn().mockResolvedValue({
        dogrulama: {
          gecerli: true,
          veri: {
            unvan: "ÖRNEK TİCARET A.Ş.",
            vknTckn: "1234567890",
            vergiDairesi: "Beyoğlu",
            iban: "TR120006200000012345678901",
            bankaAdi: "Garanti BBVA",
          },
          uyarilar: [],
        },
        mevcutCari: null,
      }),
    };
    const yurutucu = {
      izinliAraclar: vi.fn(() => [{ ad: "cari_olustur" }]),
      yurut: vi.fn().mockResolvedValue({
        hata: false,
        talep: { id: "talep-cari-42" },
        icerik: "Onay talebi açıldı",
      }),
    };

    const servis = new CariBelgeService(prisma as never, ai as never, yurutucu as never);

    // Minimal PDF başlığı taşıyan tampon
    const dummyPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");

    await baglamlaCalistir(baglam, async () => {
      const sonuc = await servis.belgedenCari(
        { ad: "vergi-levhasi.pdf", buffer: dummyPdf },
        "musteri",
        true,
      );

      expect(sonuc.talepId).toBe("talep-cari-42");
      expect(sonuc.sonuc).toContain("Cari kartı onayınıza sunuldu");
      expect(sonuc.sonuc).toContain("ÖRNEK TİCARET A.Ş.");
      expect(sonuc.sonuc).toContain("talep=talep-cari-42");

      // cari_olustur girdisinde banka hesapları ve e-fatura bilgileri aktarılmış olmalı
      expect(yurutucu.yurut).toHaveBeenCalledWith(
        expect.objectContaining({
          ad: "cari_olustur",
          girdi: expect.objectContaining({
            kod: "C-0002",
            unvan: "ÖRNEK TİCARET A.Ş.",
            tip: "musteri",
            bankaHesaplari: [
              {
                iban: "TR120006200000012345678901",
                bankaAdi: "Garanti BBVA",
                paraBirimi: "TRY",
              },
            ],
            efaturaMukellefi: true,
            efaturaSenaryosu: "TICARI",
          }),
        }),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
