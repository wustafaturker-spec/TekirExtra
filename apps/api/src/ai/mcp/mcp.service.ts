import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../core/prisma.service";
import {
  araciBakiyeSorgula,
  araciStokSorgula,
  araciTeklifTaslagiHazirla,
  araciTeklifOnayla,
  araciBelgeGonder,
  araciCariEkstreGonder,
  araciOdemeHatirlatmasiYap,
  araciCrmGorevOlustur,
} from "../ajan/ai-ajan.tools";
import {
  semantikCiroVeKarlilik,
  semantikEnCokSatanMusteriler,
  semantikVadesiGecmisAlacaklar,
  semantikMasrafKirilimi,
  semantikNakitDurumu,
} from "../rapor/ai-rapor.semantik";
import { AiRaporService } from "../rapor/ai-rapor.service";
import { JsonRpcRequest, JsonRpcResponse, McpTool, McpResource, McpPrompt } from "./mcp.types";

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly raporService: AiRaporService,
  ) {}

  /**
   * JSON-RPC 2.0 İsteğini işler ve MCP yanıtı üretir
   */
  async istegiIsle(tenantId: string, istek: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = istek.id ?? null;

    try {
      switch (istek.method) {
        case "initialize":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: { listChanged: false },
                resources: { subscribe: false, listChanged: false },
                prompts: { listChanged: false },
              },
              serverInfo: {
                name: "TekirExtra ERP & Finans MCP Server",
                version: "1.0.0",
              },
            },
          };

        case "notifications/initialized":
          return { jsonrpc: "2.0", id, result: {} };

        case "ping":
          return { jsonrpc: "2.0", id, result: "pong" };

        case "tools/list":
          return {
            jsonrpc: "2.0",
            id,
            result: { tools: this.araclariListele() },
          };

        case "tools/call":
          return {
            jsonrpc: "2.0",
            id,
            result: await this.aracCalistir(tenantId, istek.params?.name, istek.params?.arguments || {}),
          };

        case "resources/list":
          return {
            jsonrpc: "2.0",
            id,
            result: { resources: this.kaynaklariListele() },
          };

        case "resources/read":
          return {
            jsonrpc: "2.0",
            id,
            result: await this.kaynakOku(tenantId, istek.params?.uri),
          };

        case "prompts/list":
          return {
            jsonrpc: "2.0",
            id,
            result: { prompts: this.sablonlariListele() },
          };

        default:
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: `Bilinmeyen MCP metodu: ${istek.method}`,
            },
          };
      }
    } catch (hata: any) {
      this.logger.error(`MCP işlem hatası: ${istek.method}`, hata);
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: hata instanceof Error ? hata.message : "Dahili sunucu hatası",
        },
      };
    }
  }

  // ─── TOOLS (FONKSİYONLAR) ────────────────────────────────────────────────

  private araclariListele(): McpTool[] {
    return [
      {
        name: "bakiye_sorgula",
        description: "Bir cari müşterinin veya tedarikçinin güncel borç, alacak, net bakiye ve risk limitini sorgular.",
        inputSchema: {
          type: "object",
          properties: {
            unvan: { type: "string", description: "Cari hesap ünvanı veya arama kelimesi (örn: Yılmaz Ticaret)" },
            vknTckn: { type: "string", description: "Vergi veya TC kimlik numarası (isteğe bağlı)" },
          },
          required: ["unvan"],
        },
      },
      {
        name: "stok_sorgula",
        description: "Bir ürünün depolardaki mevcut stok miktarını, birimini ve satış fiyatını sorgular.",
        inputSchema: {
          type: "object",
          properties: {
            urunAdi: { type: "string", description: "Ürün adı veya stok kodu (örn: A4 Kağıt)" },
          },
          required: ["urunAdi"],
        },
      },
      {
        name: "teklif_taslagi_hazirla",
        description: "Müşteriye yeni bir satış teklifi taslağı oluşturur (KDV ve toplam hesaplanır, veritabanına taslak olarak işlenir).",
        inputSchema: {
          type: "object",
          properties: {
            cariAdi: { type: "string", description: "Teklif verilecek müşteri ünvanı" },
            urunAdi: { type: "string", description: "Teklif edilecek ürün adı" },
            miktar: { type: "number", description: "Ürün miktarı (örn: 50)" },
            birimFiyat: { type: "number", description: "Birim satış fiyatı TL (isteğe bağlı, girilmezse liste fiyatı alınır)" },
            vadeGun: { type: "number", description: "Vade günü (örn: 30, 60)" },
          },
          required: ["cariAdi", "urunAdi", "miktar"],
        },
      },
      {
        name: "teklif_onayla",
        description: "Hazırlanmış bir taslak teklifi onaylar ve kesinleştirir.",
        inputSchema: {
          type: "object",
          properties: {
            teklifNo: { type: "string", description: "Onaylanacak teklif numarası (örn: TKF-2026-0001; boş bırakılırsa son taslak onaylanır)" },
          },
        },
      },
      {
        name: "belge_gonder",
        description: "Onaylanmış bir teklifi veya faturayı PDF olarak müşterinin e-postasına veya WhatsApp'ına iletir.",
        inputSchema: {
          type: "object",
          properties: {
            belgeNo: { type: "string", description: "Belge veya teklif numarası" },
            kanal: { type: "string", enum: ["EMAIL", "WHATSAPP"], description: "Gönderim kanalı" },
            alici: { type: "string", description: "Hedef e-posta adresi veya telefon numarası" },
          },
          required: ["belgeNo", "kanal"],
        },
      },
      {
        name: "cari_ekstre_gonder",
        description: "Bir müşteriye veya tedarikçiye son dönem cari hesap ekstresini PDF formatında e-posta ile gönderir.",
        inputSchema: {
          type: "object",
          properties: {
            cariAdi: { type: "string", description: "Ekstresi gönderilecek cari ünvanı" },
            eposta: { type: "string", description: "Gönderilecek e-posta adresi (boşsa carideki kayıtlı e-posta kullanılır)" },
            ay: { type: "number", description: "Kaç aylık ekstre (varsayılan: 6)" },
          },
          required: ["cariAdi"],
        },
      },
      {
        name: "odeme_hatirlatmasi_yap",
        description: "Vadesi geçmiş faturası olan müşterilere nazik bir ödeme hatırlatması hazırlar.",
        inputSchema: {
          type: "object",
          properties: {
            cariAdi: { type: "string", description: "Hatırlatma yapılacak cari ünvanı (boşsa tüm vadesi geçenler listelenir)" },
          },
        },
      },
      {
        name: "crm_gorev_olustur",
        description: "TekirExtra CRM sisteminde yeni bir müşteri görüşmesi, toplantı veya takip görevi açar.",
        inputSchema: {
          type: "object",
          properties: {
            cariAdi: { type: "string", description: "İlgili müşteri adı" },
            baslik: { type: "string", description: "Görev başlığı" },
            aciklama: { type: "string", description: "Görev detay açıklaması" },
            oncelik: { type: "string", enum: ["dusuk", "normal", "yuksek", "acil"], description: "Öncelik derecesi" },
          },
          required: ["cariAdi", "baslik"],
        },
      },
    ];
  }

  private async aracCalistir(tenantId: string, name: string, args: Record<string, any>) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      let sonuc: any;

      switch (name) {
        case "bakiye_sorgula":
          sonuc = await araciBakiyeSorgula(tx, tenantId, {
            cariAdi: args.cariAdi || args.unvan || "",
          });
          break;
        case "stok_sorgula":
          sonuc = await araciStokSorgula(tx, tenantId, {
            urunAdi: args.urunAdi,
          });
          break;
        case "teklif_taslagi_hazirla":
          sonuc = await araciTeklifTaslagiHazirla(tx, tenantId, {
            cariAdi: args.cariAdi,
            urunAdi: args.urunAdi,
            miktar: Number(args.miktar),
            birimFiyat: args.birimFiyat ? Number(args.birimFiyat) : undefined,
            vadeGun: args.vadeGun ? Number(args.vadeGun) : undefined,
          });
          break;
        case "teklif_onayla":
          sonuc = await araciTeklifOnayla(tx, tenantId, { teklifNo: args.teklifNo });
          break;
        case "belge_gonder":
          sonuc = await araciBelgeGonder(tx, tenantId, {
            belgeTuru: args.belgeTuru === "fatura" ? "fatura" : "teklif",
            belgeNo: args.belgeNo,
            kanal: args.kanal === "EMAIL" ? "EMAIL" : "WHATSAPP",
            alici: args.alici,
          });
          break;
        case "cari_ekstre_gonder":
          sonuc = await araciCariEkstreGonder(tx, tenantId, {
            cariAdi: args.cariAdi,
            kanal: args.kanal === "EMAIL" ? "EMAIL" : "WHATSAPP",
            alici: args.alici || args.eposta,
          });
          break;
        case "odeme_hatirlatmasi_yap":
          sonuc = await araciOdemeHatirlatmasiYap(tx, tenantId, {
            cariAdi: args.cariAdi,
            kanal: args.kanal === "EMAIL" ? "EMAIL" : "WHATSAPP",
          });
          break;
        case "crm_gorev_olustur":
          sonuc = await araciCrmGorevOlustur(tx, tenantId, "system", {
            cariAdi: args.cariAdi,
            baslik: args.baslik,
            aciklama: args.aciklama,
          });
          break;
        default:
          throw new Error(`Tanımsız MCP aracı: ${name}`);
      }

      return {
        content: [
          {
            type: "text",
            text: typeof sonuc === "string" ? sonuc : JSON.stringify(sonuc, null, 2),
          },
        ],
      };
    });
  }

  // ─── RESOURCES (SALT-OKUNUR BAĞLAM KAYNAKLARI) ──────────────────────────

  private kaynaklariListele(): McpResource[] {
    return [
      {
        uri: "tekirextra://finans/cfo-brifingi",
        name: "AI CFO Yönetici Brifingi & Finansal Sağlık Skoru",
        mimeType: "application/json",
        description: "Şirketin 0-100 sağlık skoru, aylık ciro, nakit mevcudu ve stratejik tavsiyeleri.",
      },
      {
        uri: "tekirextra://finans/ciro-kar",
        name: "Aylık Ciro ve Brüt Kâr Analizi",
        mimeType: "application/json",
        description: "Son 30 günün fatura matrahları, SMM maliyeti ve brüt kâr marjı dökümü.",
      },
      {
        uri: "tekirextra://cari/riskli-alacaklar",
        name: "Vadesi Geçmiş Alacaklar ve Riskli Müşteriler",
        mimeType: "application/json",
        description: "0-30, 31-60, 61+ gün vadesi geçmiş alacak yaşlandırma listesi.",
      },
      {
        uri: "tekirextra://cari/en-cok-satanlar",
        name: "En Yüksek Satış Yapılan İlk 5 Müşteri",
        mimeType: "application/json",
        description: "Ciro büyüklüğüne göre en aktif müşteriler ve payları.",
      },
      {
        uri: "tekirextra://kasa-banka/likidite",
        name: "Kasa ve Banka Hesapları Nakit Mevcudu",
        mimeType: "application/json",
        description: "Şirketin tüm kasa ve bankalarındaki anlık TRY ve döviz likiditesi.",
      },
    ];
  }

  private async kaynakOku(tenantId: string, uri?: string) {
    if (!uri) throw new Error("URI parametresi zorunludur.");

    let veri: any;

    if (uri === "tekirextra://finans/cfo-brifingi") {
      veri = await this.raporService.yoneticiBrifingiUret(tenantId);
    } else {
      veri = await this.prisma.tenantIslem(tenantId, async (tx) => {
        switch (uri) {
          case "tekirextra://finans/ciro-kar":
            return semantikCiroVeKarlilik(tx, tenantId);
          case "tekirextra://cari/riskli-alacaklar":
            return semantikVadesiGecmisAlacaklar(tx, tenantId);
          case "tekirextra://cari/en-cok-satanlar":
            return semantikEnCokSatanMusteriler(tx, tenantId);
          case "tekirextra://kasa-banka/likidite":
            return semantikNakitDurumu(tx, tenantId);
          default:
            throw new Error(`Bilinmeyen kaynak URI: ${uri}`);
        }
      });
    }

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(veri, null, 2),
        },
      ],
    };
  }

  // ─── PROMPTS (ŞABLONLAR) ────────────────────────────────────────────────

  private sablonlariListele(): McpPrompt[] {
    return [
      {
        name: "sabah_finans_brifingi",
        description: "Şirket yöneticisi için dünün satışlarını ve bugünün tahsilat hedeflerini özetleyen şablon.",
      },
      {
        name: "riskli_alacak_analizi",
        description: "Vadesi geçen müşterileri ve alınması gereken aksiyonları analiz eden şablon.",
      },
    ];
  }
}
