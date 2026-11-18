import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../../core/istek-baglami";
import { SenaryoAiProvider } from "../saglayici/mock-ai.provider";
import { AJAN_ARACLARI } from "./araclar";
import { AiAjanService, eylemMetni, taslakMetni } from "./ai-ajan.service";
import { AracYurutucu } from "./arac-yurutucu";

const KIMLIK = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222" };
const CARI_ID = "3f2b6c1e-8d4a-4c2b-9a1e-5b7c8d9e0f12";
const FATURA_ID = "4e3a2b1c-0d9e-4f7a-8b5c-4d3e2f1a0b9c";
const BELGE_ID = "7a1d2e3f-4b5c-4d6e-8f70-81920a1b2c3d";
const STOK_ID = "9b8a7c6d-5e4f-4a2b-8c0d-e9f8a7b6c5d4";

describe("P-14a Ekran Eylemleri ve Bağlamı Bilen Asistan", () => {
  describe("taslakMetni ve eylemMetni güvenlik ve izolasyon", () => {
    it("kaydedilmemiş form taslağını güvenilmeyen veri olarak etiketler ve temizler", () => {
      const taslak = {
        cariId: CARI_ID,
        tip: "satis",
        satirlar: [
          { stokId: STOK_ID, miktar: 10, birimFiyat: 150.5 },
          { stokId: "22222222-2222-2222-2222-222222222222", miktar: 2, birimFiyat: 45 },
        ],
      };
      const metin = taslakMetni(taslak);
      expect(metin).toContain("KAYDEDİLMEMİŞ FORM TASLAĞI (GÜVENİLMEYEN İSTEMCİ VERİSİ)");
      expect(metin).toContain("doğrulanmamıştır");
      expect(metin).toContain(CARI_ID);
      expect(metin).toContain("150.5");
    });

    it("boş veya tanımsız taslakta boş metin döner", () => {
      expect(taslakMetni(undefined)).toBe("");
      expect(taslakMetni({})).toBe("");
    });

    it("ekran eylemini talimata dönüştürür", () => {
      const eylem = eylemMetni("fatura_fiyat_sapmasi");
      expect(eylem).toContain("KULLANICI EKRAN EYLEMİ: \"fatura_fiyat_sapmasi\"");
      expect(eylem).toContain("fatura_fiyat_sapmasi");
    });
  });

  describe("cari_durumu aracı", () => {
    it("carinin yaşlandırma, bakiye ve risk analizi göstergelerini döner", async () => {
      const arac = AJAN_ARACLARI.find((a) => a.ad === "cari_durumu")!;
      expect(arac).toBeDefined();
      expect(arac.sinif).toBe("okuma");

      const uc = {
        cagir: vi.fn().mockResolvedValue({
          gostergeler: {
            bakiyeTry: "125000.00",
            vadesiGecmisTry: "35000.00",
            riskKullanimOrani: 85,
            odemeDavranisi: "kismen_gec",
            tahminiGecikmeGun: 12,
            guven: "orta",
          },
          bulgular: [
            { kod: "RISK_YUKSEK", onem: "uyari", mesaj: "Risk kullanım oranı %85 seviyesinde" },
          ],
          toplamBulgu: 1,
        }),
      };

      const sonuc = await arac.calistir({ uc: uc as never, kaynak: "asistan", arac: arac.ad }, { cariId: CARI_ID });
      expect(uc.cagir).toHaveBeenCalledWith(expect.objectContaining({ yol: "GET /cari/:id/durum" }), [CARI_ID], expect.anything());
      expect(sonuc.gostergeler.bakiyeTry).toBe("125000.00");
      expect(sonuc.gostergeler.riskKullanimOrani).toBe(85);
      expect(sonuc.bulgular).toHaveLength(1);
    });
  });

  describe("fatura_fiyat_sapmasi aracı", () => {
    it("faturadaki kalemlerin birim fiyatlarını tavsiye fiyatlarla karşılaştırıp sapmayı hesaplar", async () => {
      const arac = AJAN_ARACLARI.find((a) => a.ad === "fatura_fiyat_sapmasi")!;
      expect(arac).toBeDefined();
      expect(arac.sinif).toBe("okuma");

      const uc = {
        cagir: vi.fn(async (u: { yol: string }, args: unknown[]) => {
          if (u.yol === "GET /fatura/:id") {
            return {
              id: FATURA_ID,
              no: "FTR202600000001",
              tip: "satis",
              dovizCinsi: "TRY",
              kur: "1",
              cariId: CARI_ID,
              cari: { unvan: "Örnek Müşteri A.Ş." },
              genelToplam: "1180.00",
              satirlar: [
                {
                  id: "satir-1",
                  stokId: STOK_ID,
                  stok: { ad: "A4 Fotokopi Kağıdı" },
                  miktar: 10,
                  birimFiyat: "80.00",
                  birim: "koli",
                },
                {
                  id: "satir-2",
                  stokId: "88888888-8888-8888-8888-888888888888",
                  stok: { ad: "Tükenmez Kalem" },
                  miktar: 20,
                  birimFiyat: "15.00",
                  birim: "adet",
                },
              ],
            };
          }
          if (u.yol === "GET /stok/:id/tavsiye-fiyat") {
            const stokId = args[0] as string;
            if (stokId === STOK_ID) return { birimFiyat: "100.00", cevrilebilir: true };
            return { birimFiyat: "12.00", cevrilebilir: true };
          }
          return {};
        }),
      };

      const sonuc = await arac.calistir({ uc: uc as never, kaynak: "asistan", arac: arac.ad }, { faturaId: FATURA_ID });
      expect(sonuc.faturaNo).toBe("FTR202600000001");
      expect(sonuc.cariUnvan).toBe("Örnek Müşteri A.Ş.");
      expect(sonuc.kalemAnalizleri).toHaveLength(2);

      // Kalem 1: Satış 80 TL, Tavsiye 100 TL -> %-20 sapma, -200 TL parasal sapma (düşük)
      const k1 = sonuc.kalemAnalizleri[0];
      expect(k1.faturaBirimFiyat).toBe(80);
      expect(k1.tavsiyeBirimFiyat).toBe(100);
      expect(k1.sapmaYuzdesi).toBe(-20);
      expect(k1.parasalSapma).toBe(-200);
      expect(k1.durum).toBe("dusuk");

      // Kalem 2: Satış 15 TL, Tavsiye 12 TL -> %+25 sapma, +60 TL parasal sapma (yüksek)
      const k2 = sonuc.kalemAnalizleri[1];
      expect(k2.faturaBirimFiyat).toBe(15);
      expect(k2.tavsiyeBirimFiyat).toBe(12);
      expect(k2.sapmaYuzdesi).toBe(25);
      expect(k2.parasalSapma).toBe(60);
      expect(k2.durum).toBe("yuksek");

      // Toplam net parasal sapma = -200 + 60 = -140
      expect(sonuc.toplamParasalSapma).toBe(-140);
    });
  });

  describe("teklif_revize_et aracı", () => {
    it("onaylanmış teklifin revizyonu için onay talebi önizlemesi hazırlar ve revize eder", async () => {
      const arac = AJAN_ARACLARI.find((a) => a.ad === "teklif_revize_et")!;
      expect(arac).toBeDefined();
      expect(arac.sinif).toBe("onay");

      const uc = {
        cagir: vi.fn(async (u: { yol: string }) => {
          if (u.yol === "GET /belgeler/:id") {
            return {
              id: BELGE_ID,
              no: "TKF-2026-001",
              tur: "teklif",
              revizyonNo: 0,
              durum: "onaylandi",
              cari: { unvan: "Hedef İnşaat" },
              genelToplam: "45000.00",
              dovizCinsi: "TRY",
            };
          }
          if (u.yol === "POST /belgeler/:id/revize") {
            return {
              id: "yeni-revizyon-id",
              no: "TKF-2026-001",
              revizyonNo: 1,
              durum: "taslak",
              dovizCinsi: "TRY",
              genelToplam: "45000.00",
            };
          }
          return {};
        }),
      };

      const ozet = await arac.ozetle!({ uc: uc as never, kaynak: "asistan", arac: arac.ad }, { belgeId: BELGE_ID, gerekce: "Fiyat güncellemesi" });
      expect(ozet).toContain("TKF-2026-001");
      expect(ozet).toContain("Revizyon 0 → 1");
      expect(ozet).toContain("Fiyat güncellemesi");

      const onizleme = await arac.onizle!({ uc: uc as never, kaynak: "asistan", arac: arac.ad }, { belgeId: BELGE_ID });
      expect(onizleme).toMatchObject({
        eylem: "Teklif Revizyonu",
        degisiklikler: [
          { alan: "durum", once: "onaylandi", sonra: "revize_edildi" },
          { alan: "revizyonNo", once: 0, sonra: 1 },
        ],
      });

      const sonuc = await arac.calistir({ uc: uc as never, kaynak: "asistan", arac: arac.ad }, { belgeId: BELGE_ID });
      expect(uc.cagir).toHaveBeenCalledWith(expect.objectContaining({ yol: "POST /belgeler/:id/revize" }), [BELGE_ID], expect.anything());
      expect(sonuc.revizyonNo).toBe(1);
      expect(sonuc.durum).toBe("taslak");
      expect(sonuc.adres).toBe("/panel/belgeler?odak=yeni-revizyon-id");
    });
  });

  describe("AiAjanService ekran eylemleri entegrasyonu", () => {
    it("taslak ve eylem parametrelerini sistem talimatına güvenli şekilde ekler", async () => {
      const saglayici = new SenaryoAiProvider([
        { metin: "Fiyat sapması analizi tamamlandı.", aracCagrilari: [] },
      ]);
      const tx = {
        user: { findFirst: vi.fn().mockResolvedValue({ adSoyad: "Ali Muhasebe" }) },
        ajanOturumu: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "oturum-1", userId: KIMLIK.userId }),
          update: vi.fn(),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        ajanMesajGecmisi: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: "mesaj-1" }), update: vi.fn() },
      };
      const prisma = { tenantIslem: vi.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
      const ekranUc = {
        cagir: vi.fn().mockResolvedValue({
          id: FATURA_ID,
          no: "FTR2026-99",
          tip: "satis",
          durum: "taslak",
          cari: { unvan: "Kaya Ltd" },
          genelToplam: "2500.00",
          dovizCinsi: "TRY",
        }),
      };

      const service = new AiAjanService(
        prisma as never,
        new AracYurutucu({ yetkiliMi: () => true, cagir: vi.fn() } as never, { olustur: vi.fn() } as never),
        ekranUc as never,
      );
      service.saglayiciBul = async () => ({ saglayici, ozelTalimatlar: null });

      await istekBaglami.run({ deger: { ...KIMLIK, rol: "satis" as never } }, () =>
        service.mesajiIsle(
          "Fiyat sapmasını açıkla",
          undefined,
          {
            kayit: { tur: "fatura", id: FATURA_ID },
            eylem: "fatura_fiyat_sapmasi",
            taslak: { duzenlenenKalemSayisi: 3, ozelIskonto: "15" },
            sayfa: "/panel/fatura",
          },
        ),
      );

      const sistem = saglayici.girdiler[0].sistemRol as string;
      expect(sistem).toContain("EKRAN BAĞLAMI");
      expect(sistem).toContain("FTR2026-99");
      expect(sistem).toContain("KAYDEDİLMEMİŞ FORM TASLAĞI (GÜVENİLMEYEN İSTEMCİ VERİSİ)");
      expect(sistem).toContain("\"ozelIskonto\": \"15\"");
      expect(sistem).toContain("KULLANICI EKRAN EYLEMİ: \"fatura_fiyat_sapmasi\"");
    });
  });

  describe("P-12 E-postadan fiyatlı teklif ve gönderim onayı", () => {
    it("belge_eposta_gonder hedef durumuna alıcı, konu ve ek sürümünü bağlar", async () => {
      const arac = AJAN_ARACLARI.find((a) => a.ad === "belge_eposta_gonder")!;
      expect(arac).toBeDefined();
      expect(arac.sinif).toBe("onay");

      const uc = {
        cagir: vi.fn(async (u: { yol: string }) => {
          if (u.yol === "GET /belgeler/:id") {
            return {
              id: BELGE_ID,
              no: "TKF-2026-001",
              tur: "teklif",
              yon: "satis",
              durum: "onaylandi",
              revizyonNo: 2,
              cariId: CARI_ID,
              genelToplam: "4500.00",
              dovizCinsi: "TRY",
              updatedAt: "2026-11-18T10:00:00.000Z",
              satirlar: [{ stokId: STOK_ID, miktar: 5, birimFiyat: "900.00" }],
            };
          }
          if (u.yol === "GET /cari/:id") {
            return { id: CARI_ID, unvan: "Müşteri Sanayi", eposta: "muhasebe@musteri.com" };
          }
          return {};
        }),
      };

      const hedef = await arac.hedefDurumu!({ uc: uc as never, kaynak: "asistan", arac: arac.ad }, { belgeId: BELGE_ID }) as Record<string, unknown>;
      expect(hedef.alici).toBe("muhasebe@musteri.com");
      expect(hedef.konu).toContain("TKF-2026-001/2");
      expect(hedef.ekSurumu).toContain("rev.2");

      const onizleme = await arac.onizle!({ uc: uc as never, kaynak: "asistan", arac: arac.ad }, { belgeId: BELGE_ID });
      expect(onizleme.eylem).toBe("belge_eposta_gonder");
      expect(onizleme.etkiler?.join(" ")).toContain("muhasebe@musteri.com");
      expect(onizleme.etkiler?.join(" ")).toContain("rev.2");
    });
  });
});
