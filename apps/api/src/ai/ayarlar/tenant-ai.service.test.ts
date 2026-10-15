import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import { TenantAiService } from "./tenant-ai.service";
import { istekBaglami } from "../../core/istek-baglami";
import { hassasCoz } from "../../personel/personel-hassas";

describe("TenantAiService - BYOK, Kurallar ve Otonom Görevler", () => {
  let service: TenantAiService;
  let mockPrisma: any;
  const mockTenantId = "11111111-1111-1111-1111-111111111111";

  const mockTx = {
    aiKullanim: { aggregate: vi.fn().mockResolvedValue({ _sum: { cagri: 0 } }), upsert: vi.fn() },
    aiCagriIz: { groupBy: vi.fn().mockResolvedValue([]) },
    tenantAiAyari: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    tenantAiGorev: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };

  beforeEach(() => {
    mockPrisma = {
      tenantIslem: vi.fn((_tenantId, callback) => callback(mockTx)),
    };
    service = new TenantAiService(mockPrisma, {} as never);
    vi.stubEnv("BAGLANTI_SIFRELEME_ANAHTARI", "a".repeat(64));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("1. Ayar Getirme: Kayıtlı API anahtarını güvenlik için maskelemelidir", async () => {
    mockTx.tenantAiAyari.findUnique.mockResolvedValue({
      id: "ayar-1",
      tenantId: mockTenantId,
      saglayici: "openai",
      apiKey: "sk-1234567890abcdef12345678",
      modelAdi: "gpt-4o-mini",
      baseUrl: null,
      ozelTalimatlar: "Kaya Ltd'ye teklif verme.",
    });

    const sonuc = await service.ayarGetir(mockTenantId);

    expect(sonuc.saglayici).toBe("openai");
    expect(sonuc.hasApiKey).toBe(true);
    expect(sonuc.apiKey).toBe("••••5678"); // AI-11: yalnız son 4 karakter
    expect(sonuc.ozelTalimatlar).toBe("Kaya Ltd'ye teklif verme.");
  });

  it("2. Ayar Kaydetme: BYOK ve şirket kurallarını upsert ile kaydetmelidir", async () => {
    mockTx.tenantAiAyari.findUnique.mockResolvedValue(null);
    mockTx.tenantAiAyari.upsert.mockResolvedValue({
      tenantId: mockTenantId,
      saglayici: "anthropic",
      apiKey: "sk-ant-123",
      modelAdi: "claude-3-5-sonnet",
      ozelTalimatlar: "50.000 TL üzeri harcamada onay iste",
    });

    const kayit = await service.ayarKaydet(mockTenantId, {
      saglayici: "anthropic",
      apiKey: "sk-ant-123",
      modelAdi: "claude-3-5-sonnet",
      ozelTalimatlar: "50.000 TL üzeri harcamada onay iste",
    });

    expect(mockTx.tenantAiAyari.upsert).toHaveBeenCalled();
    // AI-11: anahtar şifreli saklanır, düz metin veritabanına gitmez.
    const saklanan = mockTx.tenantAiAyari.upsert.mock.calls[0][0].create.apiKey as string;
    expect(saklanan.startsWith("enc:v1:")).toBe(true);
    expect(saklanan).not.toContain("sk-ant-123");
    expect(hassasCoz(saklanan)).toBe("sk-ant-123");
    expect(kayit.saglayici).toBe("anthropic");
  });

  it("6. Ayar kaydı yerel/özel ağ adresini reddeder", async () => {
    for (const baseUrl of ["http://api.example.com/v1", "https://169.254.169.254", "https://localhost:11434", "https://postgres", "https://[::1]/v1"]) {
      await expect(service.ayarKaydet(mockTenantId, { saglayici: "openai", apiKey: "sk-x", baseUrl })).rejects.toThrow(/Sağlayıcı adresi/);
    }
  });

  it("7. Maske geri gelirse mevcut anahtar korunur", async () => {
    const { hassasSifrele } = await import("../../personel/personel-hassas");
    mockTx.tenantAiAyari.findUnique.mockResolvedValue({ tenantId: mockTenantId, apiKey: hassasSifrele("sk-gercek-1234") });
    mockTx.tenantAiAyari.upsert.mockClear();
    await service.ayarKaydet(mockTenantId, { saglayici: "openai", apiKey: "••••1234" });
    expect(hassasCoz(mockTx.tenantAiAyari.upsert.mock.calls[0][0].update.apiKey)).toBe("sk-gercek-1234");
  });

  it("8. Yalnız sınır kaydı sağlayıcıyı ve anahtarı değiştirmez", async () => {
    mockTx.tenantAiAyari.findUnique.mockResolvedValue({ tenantId: mockTenantId, saglayici: "gemini", apiKey: "enc:v1:x" });
    mockTx.tenantAiAyari.upsert.mockClear();
    await service.ayarKaydet(mockTenantId, { gunlukCagriSiniri: 50 });
    const update = mockTx.tenantAiAyari.upsert.mock.calls[0][0].update;
    expect(update).not.toHaveProperty("saglayici");
    expect(update).not.toHaveProperty("apiKey");
    expect(update.gunlukCagriSiniri).toBe(50);
  });

  it("9. Fiyatları ve aylık bütçeyi saklar; fiyatlar olmadan bütçe tanımlanamaz", async () => {
    mockTx.tenantAiAyari.findUnique.mockResolvedValue(null);
    await expect(service.ayarKaydet(mockTenantId, { aylikMaliyetButcesiUsd: 50 })).rejects.toThrow(/token fiyatlarını da tanımlayın/);
    await service.ayarKaydet(mockTenantId, { girisTokenMilyonUsd: 0.15, cikisTokenMilyonUsd: 0.6, aylikMaliyetButcesiUsd: 50 });
    expect(mockTx.tenantAiAyari.upsert.mock.calls.at(-1)?.[0].create).toMatchObject({
      girisTokenMilyonUsd: 0.15, cikisTokenMilyonUsd: 0.6, aylikMaliyetButcesiUsd: 50,
    });
    await expect(service.ayarKaydet(mockTenantId, { girisTokenMilyonUsd: -1 })).rejects.toThrow(/0 ile 1.000.000/);
  });

  it("sohbet saklama ayarı açıkça etkinleşir, null ile kapanır ve kısmi güncellemede korunur", async () => {
    mockTx.tenantAiAyari.findUnique.mockResolvedValue({ saglayici: "mock", sohbetSaklamaGun: 30 });
    for (const sohbetSaklamaGun of [0, 6, 366, 7.5, NaN]) {
      await expect(service.ayarKaydet(mockTenantId, { sohbetSaklamaGun })).rejects.toThrow(/Sohbet saklama/);
    }
    await service.ayarKaydet(mockTenantId, { sohbetSaklamaGun: 7 });
    expect(mockTx.tenantAiAyari.upsert.mock.calls.at(-1)?.[0].update).toMatchObject({ sohbetSaklamaGun: 7 });
    await service.ayarKaydet(mockTenantId, { gunlukCagriSiniri: 50 });
    expect(mockTx.tenantAiAyari.upsert.mock.calls.at(-1)?.[0].update).not.toHaveProperty("sohbetSaklamaGun");
    await service.ayarKaydet(mockTenantId, { sohbetSaklamaGun: null });
    expect(mockTx.tenantAiAyari.upsert.mock.calls.at(-1)?.[0].update).toMatchObject({ sohbetSaklamaGun: null });
  });
});
