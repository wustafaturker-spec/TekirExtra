import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import { TenantAiService } from "./tenant-ai.service";

describe("TenantAiService - BYOK, Kurallar ve Otonom Görevler", () => {
  let service: TenantAiService;
  let mockPrisma: any;
  const mockTenantId = "11111111-1111-1111-1111-111111111111";

  const mockTx = {
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
    service = new TenantAiService(mockPrisma);
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
    expect(sonuc.apiKey).toBe("sk-1...5678"); // Maskelenmiş olmalı
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
    expect(kayit.saglayici).toBe("anthropic");
  });

  it("3. Otonom Görev Oluşturma: Zamanlanmış rapor görevini kaydetmelidir", async () => {
    mockTx.tenantAiGorev.create.mockResolvedValue({
      id: "gorev-1",
      ad: "Sabah Finans Brifingi",
      tetikleyici: "ZAMANLANMIS",
      zamanlamaCron: "09:00",
      gorevTalimati: "Dünkü ciroyu ve bugünkü tahsilatları özetle",
      kanal: "WHATSAPP",
      hedefKimlik: "05321234567",
      aktif: true,
    });

    const yeniGorev = await service.gorevOlustur(mockTenantId, {
      ad: "Sabah Finans Brifingi",
      tetikleyici: "ZAMANLANMIS",
      zamanlamaCron: "09:00",
      gorevTalimati: "Dünkü ciroyu ve bugünkü tahsilatları özetle",
      kanal: "WHATSAPP",
      hedefKimlik: "05321234567",
    });

    expect(yeniGorev.ad).toBe("Sabah Finans Brifingi");
    expect(yeniGorev.kanal).toBe("WHATSAPP");
  });

  it("4. Görev Çalıştırma: Görev talimatını yapay zeka ile yürüterek yönetici raporu üretmelidir", async () => {
    mockTx.tenantAiGorev.findUnique.mockResolvedValue({
      id: "gorev-1",
      ad: "Günlük Finans Özeti",
      tetikleyici: "ZAMANLANMIS",
      gorevTalimati: "Günlük satış ve nakit durumunu özetle",
      kanal: "WHATSAPP",
      hedefKimlik: "05321112233",
    });

    mockTx.tenantAiAyari.findUnique.mockResolvedValue({
      tenantId: mockTenantId,
      saglayici: "mock",
      ozelTalimatlar: "Kaya Ltd'ye iskonto yapma",
    });

    mockTx.tenantAiGorev.update.mockResolvedValue({ id: "gorev-1" });
    vi.stubEnv("AI_PROVIDER", "mock");

    const sonuc = await service.gorevCalistir(mockTenantId, "gorev-1");

    expect(sonuc.ad).toBe("Günlük Finans Özeti");
    expect(sonuc.raporIcerigi.length).toBeGreaterThan(0);
    expect(mockTx.tenantAiGorev.update).toHaveBeenCalled();
  });

  it("5. Sağlayıcı tanımsızsa görev örnek metin üretmez, 503 ile reddedilir", async () => {
    vi.stubEnv("AI_PROVIDER", "");
    mockTx.tenantAiGorev.findUnique.mockResolvedValue({ id: "gorev-1", ad: "Özet", gorevTalimati: "Özetle", kanal: "PANEL" });
    mockTx.tenantAiAyari.findUnique.mockResolvedValue(null);
    mockTx.tenantAiGorev.update.mockClear();

    await expect(service.gorevCalistir(mockTenantId, "gorev-1")).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockTx.tenantAiGorev.update).not.toHaveBeenCalled();
  });

  it("6. Ayar kaydı yerel/özel ağ adresini reddeder", async () => {
    for (const baseUrl of ["http://api.example.com/v1", "https://169.254.169.254", "https://localhost:11434", "https://postgres", "https://[::1]/v1"]) {
      await expect(service.ayarKaydet(mockTenantId, { saglayici: "openai", apiKey: "sk-x", baseUrl })).rejects.toThrow(/Sağlayıcı adresi/);
    }
  });
});
