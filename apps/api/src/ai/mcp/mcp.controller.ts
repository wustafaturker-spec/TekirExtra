import { Body, Controller, Delete, Get, Headers, HttpCode, HttpException, Post, Res, UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../../auth/public.decorator";
import { baglamKur } from "../../core/istek-baglami";
import { AracYurutucu } from "../ajan/arac-yurutucu";
import { aracTanimi } from "../ajan/araclar";
import { McpAnahtarService } from "./mcp-anahtar.service";

interface JsonRpcIstek {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const SUNUCU_BILGISI = { name: "TekirExtra", version: "1.0.0" };
const DESTEKLENEN_SURUM = "2025-06-18";
const TALIMAT =
  "TekirExtra ön muhasebe verisine kullanıcının yetkisiyle erişirsin. Okuma ve taslak açma doğrudan yapılır; " +
  "onay gerektiren işlemler (onaylama, kesinleştirme, gönderim, ödeme, kart değişikliği, iptal) yalnız onay talebi açar ve " +
  "kullanıcı TekirExtra panelinden onaylayınca çalışır — bunları yapılmış gibi bildirme. Kayıt silinemez.";

/**
 * AI-09: MCP sunucusu (Streamable HTTP, yalnız istek–yanıt; sunucudan akış yok).
 * Her istek kullanıcının MCP erişim anahtarıyla gelir; kimlik ve rol anahtardan
 * çözülür ve istek bağlamına kurulur. Araçlar ve kurallar asistanla aynıdır
 * (AracYurutucu); onaya tabi işlemler panel onay listesine düşer.
 */
@Controller("mcp")
@Public()
export class McpController {
  constructor(
    private readonly anahtarlar: McpAnahtarService,
    private readonly yurutucu: AracYurutucu,
  ) {}

  @Post()
  async istek(@Headers("authorization") yetki: string | undefined, @Body() govde: unknown, @Res({ passthrough: true }) res: Response) {
    const anahtar = yetki?.replace(/^Bearer\s+/i, "").trim();
    const kimlik = anahtar ? await this.anahtarlar.dogrula(anahtar) : null;
    if (!kimlik) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="TekirExtra MCP"');
      throw new UnauthorizedException("Geçerli bir MCP erişim anahtarı gerekli (Asistan ve Onaylar → MCP erişim anahtarları).");
    }
    baglamKur({ tenantId: kimlik.tenantId, userId: kimlik.userId, rol: kimlik.rol });

    const istekler = Array.isArray(govde) ? (govde as JsonRpcIstek[]) : [govde as JsonRpcIstek];
    const yanitlar = [];
    for (const i of istekler) {
      const y = await this.isle(i, kimlik.rol);
      if (y) yanitlar.push(y);
    }
    // Yalnız bildirim/yanıt içeren istekler 202 ile gövdesiz döner (Streamable HTTP).
    if (!yanitlar.length) {
      res.status(202);
      return undefined;
    }
    return Array.isArray(govde) ? yanitlar : yanitlar[0];
  }

  /** Sunucudan akış (SSE) sunulmuyor. */
  @Get()
  @HttpCode(405)
  akis() {
    return { message: "Bu MCP sunucusu yalnız POST istek–yanıt destekler." };
  }

  @Delete()
  @HttpCode(405)
  oturumKapat() {
    return { message: "Oturum tutulmuyor." };
  }

  private async isle(i: JsonRpcIstek, rol: Parameters<AracYurutucu["izinliAraclar"]>[0]) {
    const bildirim = i?.id === undefined || i?.id === null;
    const yanit = (sonuc: unknown) => ({ jsonrpc: "2.0", id: i.id ?? null, result: sonuc });
    const hata = (code: number, message: string) => ({ jsonrpc: "2.0", id: i?.id ?? null, error: { code, message } });
    if (!i || i.jsonrpc !== "2.0" || typeof i.method !== "string") return hata(-32600, "Geçersiz JSON-RPC isteği");
    if (bildirim) return null;

    switch (i.method) {
      case "initialize":
        return yanit({
          protocolVersion: typeof i.params?.protocolVersion === "string" ? i.params.protocolVersion : DESTEKLENEN_SURUM,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SUNUCU_BILGISI,
          instructions: TALIMAT,
        });
      case "ping":
        return yanit({});
      case "tools/list":
        return yanit({
          tools: this.yurutucu.izinliAraclar(rol).map((a) => {
            const t = aracTanimi(a);
            return { name: t.ad, description: t.aciklama, inputSchema: t.girdiSemasi };
          }),
        });
      case "tools/call": {
        const ad = typeof i.params?.name === "string" ? i.params.name : "";
        const izinli = new Map(this.yurutucu.izinliAraclar(rol).map((a) => [a.ad, a]));
        try {
          const sonuc = await this.yurutucu.yurut({ ad, girdi: i.params?.arguments ?? {} }, izinli, { kaynak: "mcp" });
          return yanit({ content: [{ type: "text", text: sonuc.icerik }], isError: Boolean(sonuc.hata) });
        } catch (e) {
          return hata(-32603, e instanceof HttpException ? e.message : "Araç çalıştırılamadı");
        }
      }
      default:
        return hata(-32601, `Desteklenmeyen yöntem: ${i.method}`);
    }
  }
}
