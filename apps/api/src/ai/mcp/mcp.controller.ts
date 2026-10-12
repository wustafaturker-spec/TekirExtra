import { Controller, Get, Post, Body, Req, Res, Query, Headers, HttpStatus } from "@nestjs/common";
import { Response, Request } from "express";
import { McpService } from "./mcp.service";
import { JsonRpcRequest } from "./mcp.types";
import { PrismaService } from "../../core/prisma.service";
import { aktifBaglam } from "../../core/istek-baglami";
import { Public } from "../../auth/public.decorator";

// Aktif SSE İstemci Bağlantıları
const sseBaglantilari = new Map<string, Response>();

@Controller("mcp")
export class McpController {
  constructor(
    private readonly mcpService: McpService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 1. MCP Server-Sent Events (SSE) Bağlantı Noktası
   * Claude Desktop veya Cursor buraya bağlanır
   */
  @Get("sse")
  @Public()
  async sseBaglan(
    @Req() req: Request,
    @Res() res: Response,
    @Query("token") token?: string,
  ) {
    const sessionId = Math.random().toString(36).substring(2, 15);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    sseBaglantilari.set(sessionId, res);

    // İlk 'endpoint' olayını gönder (İstemci mesajlarını nereye göndereceğini öğrenir)
    res.write(`event: endpoint\ndata: /api/v1/mcp/messages?sessionId=${sessionId}\n\n`);

    req.on("close", () => {
      sseBaglantilari.delete(sessionId);
      res.end();
    });
  }

  /**
   * 2. SSE İstemcilerinden Gelen JSON-RPC Mesaj Alıcısı
   */
  @Post("messages")
  @Public()
  async sseMesajiAl(
    @Query("sessionId") sessionId: string,
    @Body() body: JsonRpcRequest,
    @Headers("authorization") authHeader?: string,
    @Query("token") token?: string,
  ) {
    const tenantId = await this.tenantIdCoz(authHeader || token);
    const yanit = await this.mcpService.istegiIsle(tenantId, body);

    // Eğer SSE istemcisi bağlıysa yanıtı SSE üzerinden gönder
    const sseIstemci = sessionId ? sseBaglantilari.get(sessionId) : null;
    if (sseIstemci) {
      sseIstemci.write(`event: message\ndata: ${JSON.stringify(yanit)}\n\n`);
    }

    return yanit;
  }

  /**
   * 3. Doğrudan Durumsuz (Stateless) JSON-RPC 2.0 Uç Noktası
   * Cursor veya REST tabanlı harici ajanlar için
   */
  @Post("rpc")
  @Public()
  async rpcCalistir(
    @Body() body: JsonRpcRequest,
    @Headers("authorization") authHeader?: string,
    @Query("token") token?: string,
  ) {
    const tenantId = await this.tenantIdCoz(authHeader || token);
    return this.mcpService.istegiIsle(tenantId, body);
  }

  /**
   * 4. Claude Desktop & Cursor Hazır Konfigürasyon Bloğu
   */
  @Get("konfigurasyon")
  async konfigurasyonGetir() {
    let tenantId: string;
    try {
      tenantId = aktifBaglam().tenantId;
    } catch {
      const ilk = await this.prisma.tenant.findFirst({ select: { id: true } });
      tenantId = ilk?.id || "default-tenant-id";
    }

    const apiUrl = process.env.APP_URL ? process.env.APP_URL.replace("3100", "3001") : "http://localhost:3001";

    return {
      mcpSunucuAdi: "TekirExtra ERP & Finans",
      sunucuUrl: `${apiUrl}/mcp/sse`,
      rpcUrl: `${apiUrl}/mcp/rpc`,
      claudeDesktopConfig: {
        mcpServers: {
          tekirextra: {
            url: `${apiUrl}/mcp/sse?token=${tenantId}`,
          },
        },
      },
    };
  }

  // ─── YARDIMCI METODLAR ──────────────────────────────────────────────────

  private async tenantIdCoz(auth?: string): Promise<string> {
    try {
      const baglam = aktifBaglam();
      if (baglam?.tenantId) return baglam.tenantId;
    } catch {
      // Bağlam yoksa devam et
    }

    if (auth) {
      const token = auth.startsWith("Bearer ") ? auth.replace("Bearer ", "").trim() : auth.trim();

      // 1. Doğrudan UUID mi?
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
        return token;
      }

      // 2. JWT token mi? Payloader'dan tenantId çöz
      try {
        const parcalar = token.split(".");
        if (parcalar.length === 3) {
          const payload = JSON.parse(Buffer.from(parcalar[1], "base64url").toString("utf8"));
          if (payload.tenantId) {
            return payload.tenantId;
          }
        }
      } catch {
        // Parse edilemezse varsayılana devam
      }
    }

    // 3. Veritabanındaki ilk kiracıyı doğrudan SQL sorgusuyla (RLS bypass) çöz
    try {
      const satirlar = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Tenant" ORDER BY "createdAt" ASC LIMIT 1`
      );
      if (satirlar && satirlar.length > 0) {
        return satirlar[0].id;
      }
    } catch (err) {
      // Tablo adı küçük harf olabilir
      const satirlar = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1`
      ).catch(() => []);
      if (satirlar && satirlar.length > 0) {
        return satirlar[0].id;
      }
    }

    throw new Error("Sistemde aktif kiracı (tenant) bulunamadı.");
  }
}
