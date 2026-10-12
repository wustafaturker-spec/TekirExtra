import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpService } from "./mcp.service";
import { Prisma } from "@prisma/client";

describe("McpService - Model Context Protocol (MCP) Sunucu Entegrasyonu", () => {
  let service: McpService;
  let mockPrisma: any;
  let mockRaporService: any;
  const mockTenantId = "11111111-1111-1111-1111-111111111111";

  const mockTx = {
    cariHesap: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    cariHareket: {
      findMany: vi.fn(),
    },
    stokKart: {
      findMany: vi.fn(),
    },
    kasa: { findMany: vi.fn() },
    bankaHesap: { findMany: vi.fn() },
    kasaBankaHareket: { findMany: vi.fn() },
    fatura: { findMany: vi.fn() },
    masraf: { findMany: vi.fn() },
  };

  beforeEach(() => {
    mockPrisma = {
      tenantIslem: vi.fn((_tenantId, callback) => callback(mockTx)),
    };
    mockRaporService = {
      yoneticiBrifingiUret: vi.fn().mockResolvedValue({
        finansalSaglikSkoru: 90,
        saglikDurumu: "Mükemmel",
        yoneticiNotu: "Şirket finansal performansı güçlüdür.",
      }),
    };
    service = new McpService(mockPrisma, mockRaporService);
  });

  it("1. initialize: Protokol sürümünü ve sunucu yeteneklerini dönmelidir", async () => {
    const res = await service.istegiIsle(mockTenantId, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    expect(res.result.protocolVersion).toBe("2024-11-05");
    expect(res.result.serverInfo.name).toContain("TekirExtra");
    expect(res.result.capabilities.tools).toBeDefined();
    expect(res.result.capabilities.resources).toBeDefined();
  });

  it("2. tools/list: Tüm 8 kurumsal aracı JSON Schema ile listelemelidir", async () => {
    const res = await service.istegiIsle(mockTenantId, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    expect(res.result.tools.length).toBe(8);
    const toolAdlari = res.result.tools.map((t: any) => t.name);
    expect(toolAdlari).toContain("bakiye_sorgula");
    expect(toolAdlari).toContain("stok_sorgula");
    expect(toolAdlari).toContain("teklif_taslagi_hazirla");
    expect(toolAdlari).toContain("teklif_onayla");
    expect(toolAdlari).toContain("belge_gonder");
  });

  it("3. tools/call (stok_sorgula): İstenen stok kartını sorgulayıp text content dönmelidir", async () => {
    mockTx.stokKart.findMany.mockResolvedValue([
      {
        id: "stok-1",
        kod: "A4-01",
        ad: "A4 Fotokopi Kağıdı",
        anaBirim: "koli",
        satisFiyati: new Prisma.Decimal(120),
        mevcutMiktar: new Prisma.Decimal(150),
      },
    ]);

    const res = await service.istegiIsle(mockTenantId, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "stok_sorgula",
        arguments: { urunAdi: "A4" },
      },
    });

    expect(res.result.content[0].type).toBe("text");
    expect(res.result.content[0].text).toContain("A4 Fotokopi Kağıdı");
    expect(res.result.content[0].text).toContain("150");
  });

  it("4. resources/list: Finansal ve operasyonel semantik kaynakları listelemelidir", async () => {
    const res = await service.istegiIsle(mockTenantId, {
      jsonrpc: "2.0",
      id: 4,
      method: "resources/list",
    });

    expect(res.result.resources.length).toBeGreaterThanOrEqual(5);
    const uriler = res.result.resources.map((r: any) => r.uri);
    expect(uriler).toContain("tekirextra://finans/cfo-brifingi");
    expect(uriler).toContain("tekirextra://finans/ciro-kar");
    expect(uriler).toContain("tekirextra://cari/riskli-alacaklar");
  });

  it("5. resources/read: CFO brifingi kaynağını başarıyla okuyup JSON dönmelidir", async () => {
    const res = await service.istegiIsle(mockTenantId, {
      jsonrpc: "2.0",
      id: 5,
      method: "resources/read",
      params: { uri: "tekirextra://finans/cfo-brifingi" },
    });

    expect(res.result.contents[0].uri).toBe("tekirextra://finans/cfo-brifingi");
    expect(res.result.contents[0].text).toContain("finansal performans");
  });
});
