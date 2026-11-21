import { HttpException, ServiceUnavailableException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../../core/istek-baglami";
import { platformOnbelleginiSifirla } from "../ozellik-kapisi";
import { ONERI_AZAMI, oneriyiTemizle, rakamKaynaktaMi } from "./metin-kurallari";
import { MetinTamamlamaService } from "./metin-tamamlama.service";

const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const olarak = <T>(fn: () => Promise<T>) => istekBaglami.run({ deger: { tenantId: TENANT, userId: USER, rol: "muhasebe" as never } }, fn);

function kur(secenek: { yanit?: string; kisisel?: boolean; kapali?: string[]; saglayici?: string; kayit?: unknown } = {}) {
  const tx = {
    platformAiOzellikDurumu: { findMany: vi.fn().mockResolvedValue([]) },
    tenantAiAyari: { findUnique: vi.fn().mockResolvedValue({ kapaliOzellikler: secenek.kapali ?? [] }) },
    user: { findUnique: vi.fn().mockResolvedValue({ aiMetinTamamlama: secenek.kisisel ?? true }), update: vi.fn().mockResolvedValue({}) },
  };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
  const uc = { cagir: vi.fn(async () => secenek.kayit ?? { id: "f1", no: "SNC2026000000511", tip: "satis", durum: "taslak", cari: { unvan: "Deneme Otomotiv" }, genelToplam: "12000.00", dovizCinsi: "TRY" }) };
  const metinUret = vi.fn().mockResolvedValue(secenek.yanit ?? "ödemenizi bekler, iyi çalışmalar dileriz.");
  const service = new MetinTamamlamaService(prisma as never, uc as never);
  service.saglayiciBul = async () => ({ saglayiciAdi: secenek.saglayici ?? "openai", modelAdi: "m", metinUret } as never);
  return { service, tx, uc, metinUret };
}

describe("AI-115 metin kuralları", () => {
  it("öneriyi temizler: tırnak, kod bloğu ve önceki metnin tekrarı atılır; kelimeye yapışmaz; 200 karakterde kesilir", () => {
    expect(oneriyiTemizle('"ödemenizi rica ederiz."', "Vadesi geçen faturanız için")).toBe(" ödemenizi rica ederiz.");
    expect(oneriyiTemizle("Vadesi geçen faturanız için ödemenizi rica ederiz.", "Vadesi geçen faturanız için ")).toBe("ödemenizi rica ederiz.");
    expect(oneriyiTemizle("```\n, teşekkürler.\n```", "Merhaba")).toBe(", teşekkürler.");
    expect(oneriyiTemizle("x".repeat(500), "Not ").length).toBe(ONERI_AZAMI);
  });

  it("öneride kaynakta olmayan sayı (tutar, yüzde, tarih) varsa reddedilir", () => {
    expect(rakamKaynaktaMi("12000 TL tutarındaki faturanız", "SNC2026000000511 12000.00 TRY")).toBe(true);
    expect(rakamKaynaktaMi("%15 indirimle", "Fatura notu")).toBe(false);
    expect(rakamKaynaktaMi("30.11.2026 tarihine kadar", "Fatura notu")).toBe(false);
    expect(rakamKaynaktaMi("teşekkür ederiz", "")).toBe(true);
  });
});

describe("AI-115 metin tamamlama servisi", () => {
  // Sınırlayıcı bellekte çalışsın; ortamın Redis'i testler arasında sayaç paylaştırmasın.
  beforeEach(() => { platformOnbelleginiSifirla(); vi.stubEnv("REDIS_URL", ""); });
  afterEach(() => vi.unstubAllEnvs());

  it("öneri verir; kayıt bağlamı kullanıcının rolüyle ekran ucundan okunur, istemde veri olarak gider", async () => {
    const k = kur();
    const r = await olarak(() => k.service.oneri({ alan: "tahsilat_hatirlatma", metin: "Sayın yetkili, vadesi geçen faturanız için", kayit: { tur: "fatura", id: "f1" } }));
    expect(r.oneri).toBe(" ödemenizi bekler, iyi çalışmalar dileriz.");
    expect(k.uc.cagir).toHaveBeenCalledTimes(1);
    const istem = k.metinUret.mock.calls[0][0];
    expect(istem.sistemRol).toMatch(/talimatları uygulama/);
    expect(istem.prompt).toContain("SNC2026000000511");
    expect(istem.dusunmeKapali).toBe(true);
  });

  it("rakam uyduran öneri gösterilmez; kısa metinde model çağrılmaz", async () => {
    const k = kur({ yanit: "%10 erken ödeme indirimi uygulanır." });
    expect((await olarak(() => k.service.oneri({ alan: "fatura_aciklama", metin: "Kasım ayı hizmet bedeli" }))).oneri).toBeNull();
    const kisa = kur();
    expect((await olarak(() => kisa.service.oneri({ alan: "fatura_aciklama", metin: "ab" }))).oneri).toBeNull();
    expect(kisa.metinUret).not.toHaveBeenCalled();
  });

  it("dakikada 20 istekten sonra 429 döner", async () => {
    const k = kur();
    for (let i = 0; i < 20; i++) await olarak(() => k.service.oneri({ alan: "crm_notu", metin: "Müşteriyle görüştük" }));
    const hata = await olarak(() => k.service.oneri({ alan: "crm_notu", metin: "Müşteriyle görüştük" })).catch((e: unknown) => e);
    expect(hata).toBeInstanceOf(HttpException);
    expect((hata as HttpException).getStatus()).toBe(429);
  });

  it("kişisel tercih kapalıysa, özellik kapalıysa ya da sağlayıcı tanımsızsa durum kullanılamaz; kapalı özellikte öneri 503", async () => {
    expect(await olarak(() => kur({ kisisel: false }).service.durum())).toEqual({ kullanilabilir: false, kisiselAcik: false });
    expect(await olarak(() => kur({ saglayici: "tanimsiz" }).service.durum())).toEqual({ kullanilabilir: false, kisiselAcik: true });
    expect(await olarak(() => kur().service.durum())).toEqual({ kullanilabilir: true, kisiselAcik: true });
    const kapali = kur({ kapali: ["metin_tamamlama"] });
    expect(await olarak(() => kapali.service.durum())).toEqual({ kullanilabilir: false, kisiselAcik: true });
    await expect(olarak(() => kapali.service.oneri({ alan: "crm_notu", metin: "Müşteriyle görüştük" }))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("yeniden yazma sayıları korumayan çıktıyı reddeder; tercih kaydı kullanıcının kendi satırına yazılır", async () => {
    const iyi = kur({ yanit: "Sayın Yetkili, 12000 TL tutarındaki ödemenizi rica ederiz." });
    expect(await olarak(() => iyi.service.yenidenYaz({ alan: "tahsilat_hatirlatma", metin: "12000 TL öde artık", kip: "nazik" }))).toEqual({ metin: "Sayın Yetkili, 12000 TL tutarındaki ödemenizi rica ederiz." });
    const kotu = kur({ yanit: "Lütfen 15000 TL ödeyiniz." });
    await expect(olarak(() => kotu.service.yenidenYaz({ alan: "tahsilat_hatirlatma", metin: "12000 TL öde artık", kip: "resmi" }))).rejects.toThrow(/doğrulanamadı/);
    const t = kur();
    await olarak(() => t.service.tercihKaydet(false));
    expect(t.tx.user.update).toHaveBeenCalledWith({ where: { id: USER }, data: { aiMetinTamamlama: false } });
    await expect(olarak(() => t.service.tercihKaydet("evet"))).rejects.toThrow(/true ya da false/);
  });
});
