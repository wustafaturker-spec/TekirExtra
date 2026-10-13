import { Controller, Post, Get, Body, Param } from "@nestjs/common";
import { AiAjanService, GelenAjanMesaji } from "./ai-ajan.service";
import { aktifBaglam } from "../../core/istek-baglami";

/**
 * Kiracı ve kullanıcı yalnız oturumdan gelir; gövdedeki kimlik alanları
 * yok sayılır. Dış kanal (WhatsApp vb.) webhook'u henüz yok — bu uçlar
 * oturum açmış panel kullanıcısı içindir.
 */
@Controller("ai/ajan")
export class AiAjanController {
  constructor(private readonly ajanService: AiAjanService) {}

  @Post("mesaj")
  async mesajiIsle(@Body() body: Pick<GelenAjanMesaji, "kanal" | "kanalKimlik" | "mesaj" | "sesBase64" | "pinKodu">) {
    const { tenantId, userId } = aktifBaglam();
    return this.ajanService.mesajiIsle({
      kanal: body.kanal,
      kanalKimlik: body.kanalKimlik,
      mesaj: body.mesaj,
      sesBase64: body.sesBase64,
      pinKodu: body.pinKodu,
    }, { tenantId, userId });
  }

  @Post("pin-dogrula")
  async pinDogrula(@Body() body: { kanal?: string; kanalKimlik: string; pinKodu: string }) {
    const { tenantId, userId } = aktifBaglam();
    const dogrulandi = await this.ajanService.pinDogrula(
      { tenantId, userId },
      body.kanal || "WHATSAPP",
      body.kanalKimlik,
      body.pinKodu,
    );
    return { dogrulandi };
  }

  @Get("oturum/:id")
  async oturumDetay(@Param("id") oturumId: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.ajanService.oturumDetay({ tenantId, userId }, oturumId);
  }

  /** Web asistanı: her kullanıcının kendi oturumu. */
  @Post("simulasyon")
  async simulasyon(@Body() body: { mesaj: string; sesBase64?: string }) {
    const { tenantId, userId } = aktifBaglam();
    return this.ajanService.mesajiIsle({
      kanal: "WEB",
      kanalKimlik: `web:${userId}`,
      mesaj: body.mesaj,
      sesBase64: body.sesBase64,
    }, { tenantId, userId });
  }
}
