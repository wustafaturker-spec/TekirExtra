import { Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, HttpException, Optional, Post, Res, UnauthorizedException } from "@nestjs/common";
import { AbonelikErisimService } from "../../core/abonelik-erisim.service";
import type { Response } from "express";
import { Public } from "../../auth/public.decorator";
import { baglamKur } from "../../core/istek-baglami";
import { aktifBaglam } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
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
    private readonly prisma: PrismaService,
    @Optional() private readonly erisim?: AbonelikErisimService,
  ) {}

  @Post()
  async istek(@Headers("authorization") yetki: string | undefined, @Headers("idempotency-key") idempotencyKey: string | undefined, @Body() govde: unknown, @Res({ passthrough: true }) res: Response) {
    const anahtar = yetki?.replace(/^Bearer\s+/i, "").trim();
    const kimlik = anahtar ? await this.anahtarlar.dogrula(anahtar) : null;
    if (!kimlik) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="TekirExtra MCP"');
      throw new UnauthorizedException("Geçerli bir MCP erişim anahtarı gerekli (Asistan ve Onaylar → MCP erişim anahtarları).");
    }
    baglamKur({ tenantId: kimlik.tenantId, userId: kimlik.userId, rol: kimlik.rol, ...(kimlik.ozelRol ? { ozelRol: kimlik.ozelRol } : {}) });
    const moduller = this.erisim ? await this.erisim.modulleriGetir(kimlik.tenantId) : null;
    if (moduller && !moduller.includes("yapay_zeka")) throw new ForbiddenException("Yapay zekâ ve MCP abonelik paketinizde kapalı.");
    aktifBaglam().paketModulleri = moduller;

    const istekler = Array.isArray(govde) ? (govde as JsonRpcIstek[]) : [govde as JsonRpcIstek];
    const yanitlar = [];
    for (const i of istekler) {
      const y = await this.isle(i, kimlik.rol, idempotencyKey);
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

  private async isle(i: JsonRpcIstek, rol: Parameters<AracYurutucu["izinliAraclar"]>[0], idempotencyKey?: string) {
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
        const arac = izinli.get(ad);
        const yanEtkili = arac && arac.sinif !== "okuma";
        if (yanEtkili && !idempotencyKey?.trim()) return hata(-32602, "Taslak ve onay araçlarında Idempotency-Key başlığı zorunludur.");
        if (idempotencyKey && !/^[A-Za-z0-9._:-]{8,100}$/.test(idempotencyKey)) return hata(-32602, "Idempotency-Key 8-100 karakter olmalı; yalnız harf, rakam, nokta, alt çizgi, iki nokta ve tire içermelidir.");
        const girdiOzeti = createHash("sha256").update(JSON.stringify({ jsonRpcId: i.id, ad, arguments: i.params?.arguments ?? {} })).digest("hex");
        let ayrildi = false;
        try {
          if (yanEtkili && idempotencyKey) {
            const onceki = await this.idempotencyAyir(idempotencyKey, ad, girdiOzeti);
            if (onceki) return onceki;
            ayrildi = true;
          }
          const sonuc = await this.yurutucu.yurut({ ad, girdi: i.params?.arguments ?? {} }, izinli, { kaynak: "mcp" });
          const cevap = yanit({ content: [{ type: "text", text: sonuc.icerik }], isError: Boolean(sonuc.hata) });
          if (yanEtkili && idempotencyKey) await this.idempotencyTamamla(idempotencyKey, cevap);
          return cevap;
        } catch (e) {
          const cevap = hata(-32603, e instanceof HttpException ? e.message : "Araç çalıştırılamadı");
          if (ayrildi && idempotencyKey) await this.idempotencyTamamla(idempotencyKey, cevap);
          return cevap;
        }
      }
      default:
        return hata(-32601, `Desteklenmeyen yöntem: ${i.method}`);
    }
  }

  private async idempotencyAyir(anahtar: string, arac: string, girdiOzeti: string): Promise<unknown | null> {
    const { tenantId, userId } = aktifBaglam();
    try {
      await this.prisma.tenantIslem(tenantId, (tx) => tx.aiAracIstegi.create({
        data: { tenantId, userId, kaynak: "mcp", istekAnahtari: anahtar, arac, girdiOzeti },
      }));
      return null;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
      const onceki = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiAracIstegi.findUnique({
        where: { tenantId_userId_kaynak_istekAnahtari: { tenantId, userId, kaynak: "mcp", istekAnahtari: anahtar } },
      }));
      if (!onceki || onceki.arac !== arac || onceki.girdiOzeti !== girdiOzeti) throw new HttpException("Idempotency-Key farklı bir araç veya girdi için daha önce kullanılmış.", 409);
      if (onceki.durum !== "tamamlandi" || !onceki.sonuc) throw new HttpException("Bu istek halen işleniyor; aynı anahtarla kısa süre sonra tekrar deneyin.", 409);
      return onceki.sonuc;
    }
  }

  private async idempotencyTamamla(anahtar: string, sonuc: unknown): Promise<void> {
    const { tenantId, userId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) => tx.aiAracIstegi.update({
      where: { tenantId_userId_kaynak_istekAnahtari: { tenantId, userId, kaynak: "mcp", istekAnahtari: anahtar } },
      data: { durum: "tamamlandi", sonuc: JSON.parse(JSON.stringify(sonuc)) as Prisma.InputJsonValue, tamamlandiAt: new Date() },
    }));
  }
}
