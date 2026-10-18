import { afterEach, describe, expect, it, vi } from "vitest";
import { AiTelemetriBakimService } from "./ai-telemetri-bakim.service";

function kur(gruplar: Array<{ basarili: boolean; _count: { _all: number }; _avg: { sureMs: number } }>, ayar: Record<string, number | string | null> = {}, buAyUsd = 0, tavanUsd: number | null = null) {
  const tx = {
    tenantAiAyari: { findUnique: vi.fn().mockResolvedValue({ telemetriSaklamaGun: 30, telemetriHataEsigiYuzde: 20, telemetriGecikmeEsigiMs: 5000, ...ayar }) },
    aiCagriIz: { deleteMany: vi.fn().mockResolvedValue({ count: 7 }), groupBy: vi.fn().mockResolvedValue(gruplar), aggregate: vi.fn().mockResolvedValue({ _sum: { maliyetUsd: { toNumber: () => buAyUsd } } }) },
    platformAiTavani: { findUnique: vi.fn().mockResolvedValue(tavanUsd === null ? null : { aylikTavanUsd: tavanUsd }) },
    aiOcrDenetim: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    aiAracIstegi: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
    ajanMesajGecmisi: { deleteMany: vi.fn().mockResolvedValue({ count: 4 }) },
    ajanOturumu: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    aiOnayTalebi: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    aiIcgoru: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    aiKullanim: { deleteMany: vi.fn().mockResolvedValue({ count: 5 }) },
  };
  const prisma = { tenantIslem: vi.fn((_tenant: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
  const bildirimler = { uret: vi.fn().mockResolvedValue({}), kapatEksikleri: vi.fn().mockResolvedValue(0) };
  return { service: new AiTelemetriBakimService(prisma as never, bildirimler as never), tx, bildirimler };
}

describe("AI telemetri bakımı", () => {
  it("saklama süresinden eski izleri siler ve eşik aşımında yöneticiyi uyarır", async () => {
    const k = kur([
      { basarili: true, _count: { _all: 8 }, _avg: { sureMs: 4000 } },
      { basarili: false, _count: { _all: 4 }, _avg: { sureMs: 9000 } },
    ]);
    const simdi = new Date("2026-10-14T10:00:00Z");
    const sonuc = await k.service.tenantBakim("t", simdi);
    expect(sonuc).toEqual({ silinen: 7, silinenIdempotency: 3, silinenSohbetMesaji: 0, silinenOturum: 0, silinenOnay: 0, silinenKullanim: 5, toplam: 12, hataOrani: 33, ortalamaSureMs: 5667 });
    expect(k.tx.aiCagriIz.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t", createdAt: { lt: new Date("2026-09-14T10:00:00Z") } } });
    expect(k.tx.aiAracIstegi.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t", durum: "tamamlandi", tamamlandiAt: { lt: new Date("2026-10-07T10:00:00Z") } } });
    expect(k.tx.ajanMesajGecmisi.deleteMany).not.toHaveBeenCalled();
    expect(k.tx.ajanOturumu.deleteMany).not.toHaveBeenCalled();
    expect(k.tx.aiOnayTalebi.deleteMany).not.toHaveBeenCalled();
    expect(k.bildirimler.uret).toHaveBeenCalledTimes(2);
    expect(k.bildirimler.kapatEksikleri).toHaveBeenCalledWith("yapay_zeka", expect.arrayContaining(["yapay_zeka:telemetri:hata_orani", "yapay_zeka:telemetri:gecikme"]), ["yapay_zeka:telemetri:", "yapay_zeka:butce:"]);
  });

  it("kısa telemetri süresinde bu ayın bütçe izlerini ve son 30 gün sayaçlarını korur", async () => {
    const k = kur([], { telemetriSaklamaGun: 7, aylikMaliyetButcesiUsd: 100 });
    await k.service.tenantBakim("t", new Date("2026-10-14T10:00:00Z"));
    expect(k.tx.aiCagriIz.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t", createdAt: { lt: new Date("2026-09-30T21:00:00Z") } } });
    expect(k.tx.aiKullanim.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t", gun: { lt: new Date("2026-09-13T10:00:00Z") } } });
  });

  it("sonuçlanmış onayları oluşturma yerine karar tarihine göre temizler", async () => {
    const k = kur([], { sohbetSaklamaGun: 7 });
    const simdi = new Date("2026-10-14T10:00:00Z");
    await k.service.tenantBakim("t", simdi);
    expect(k.tx.aiOnayTalebi.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t", durum: { in: ["onaylandi", "reddedildi", "suresi_doldu", "hata"] }, kararAt: { lt: new Date("2026-07-16T10:00:00Z") } } });
    expect(k.tx.aiOnayTalebi.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t", durum: "bekliyor", gecerlilikSonu: { lte: simdi } }, data: { durum: "suresi_doldu", kararAt: simdi } });
    expect(k.tx.aiIcgoru.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t", hesaplandiAt: { lt: new Date(simdi.getTime() - 90 * 86_400_000) } } });
  });

  it("örnek sayısı 10'dan azsa uyarı üretmez ve eski uyarıları kapatır", async () => {
    const k = kur([{ basarili: false, _count: { _all: 9 }, _avg: { sureMs: 120000 } }]);
    await k.service.tenantBakim("t");
    expect(k.bildirimler.uret).not.toHaveBeenCalled();
    expect(k.bildirimler.kapatEksikleri).toHaveBeenCalledWith("yapay_zeka", [], ["yapay_zeka:telemetri:", "yapay_zeka:butce:"]);
  });

  describe("aylık bütçe uyarıları (AI-29)", () => {
    afterEach(() => vi.unstubAllEnvs());
    const fiyatli = { girisTokenMilyonUsd: 0.3, cikisTokenMilyonUsd: 2.5, apiKey: "enc:v1:x", saglayici: "gemini" };
    const simdi = new Date("2026-10-14T10:00:00Z");

    it("%80'de uyarı, ay anahtarıyla", async () => {
      const k = kur([], { ...fiyatli, aylikMaliyetButcesiUsd: 10 }, 8.5);
      await k.service.tenantBakim("t", simdi);
      expect(k.bildirimler.uret).toHaveBeenCalledTimes(1);
      expect(k.bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ onem: "uyari", birlesimAnahtari: "yapay_zeka:butce:80:2026-10", roller: ["yonetici"] }));
      expect(k.bildirimler.kapatEksikleri).toHaveBeenCalledWith("yapay_zeka", ["yapay_zeka:butce:80:2026-10"], ["yapay_zeka:telemetri:", "yapay_zeka:butce:"]);
    });

    it("bütçe dolunca yalnız kritik bildirim; %80 uyarısı kapanır", async () => {
      const k = kur([], { ...fiyatli, aylikMaliyetButcesiUsd: 10 }, 10.2);
      await k.service.tenantBakim("t", simdi);
      expect(k.bildirimler.uret).toHaveBeenCalledTimes(1);
      expect(k.bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ onem: "kritik", baslik: "AI bütçesi doldu", birlesimAnahtari: "yapay_zeka:butce:100:2026-10" }));
    });

    it("bütçe varken fiyat yoksa 'ölçülemiyor' bildirimi", async () => {
      const k = kur([], { apiKey: "enc:v1:x", saglayici: "gemini", aylikMaliyetButcesiUsd: 10 });
      await k.service.tenantBakim("t", simdi);
      expect(k.bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ baslik: "AI bütçesi ölçülemiyor", birlesimAnahtari: "yapay_zeka:butce:fiyat" }));
    });

    it("platform anahtarında tavan platformdan gelir, kiracı fiyatı yok sayılır", async () => {
      vi.stubEnv("AI_PROVIDER", "gemini");
      vi.stubEnv("AI_GIRIS_TOKEN_MILYON_USD", "0.3");
      vi.stubEnv("AI_CIKIS_TOKEN_MILYON_USD", "2.5");
      vi.stubEnv("AI_PLATFORM_AYLIK_TAVAN_USD", "50");
      const k = kur([], { saglayici: "varsayilan", telemetriSaklamaGun: 7 }, 5, 5);
      await k.service.tenantBakim("t", simdi);
      expect(k.tx.platformAiTavani.findUnique).toHaveBeenCalled();
      expect(k.bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ birlesimAnahtari: "yapay_zeka:butce:100:2026-10", aciklama: expect.stringContaining("platform tavanı") }));
      // Tavan varken bu ayın izleri silinmez.
      expect(k.tx.aiCagriIz.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t", createdAt: { lt: new Date("2026-09-30T21:00:00Z") } } });
    });

    it("bütçe ve tavan yoksa bütçe bildirimi yok", async () => {
      const k = kur([], fiyatli, 1000);
      await k.service.tenantBakim("t", simdi);
      expect(k.bildirimler.uret).not.toHaveBeenCalled();
      expect(k.tx.aiCagriIz.aggregate).not.toHaveBeenCalled();
    });
  });
});
