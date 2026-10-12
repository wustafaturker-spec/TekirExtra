import { Controller, Post, Get, Body, Param } from "@nestjs/common";
import { AiAjanService, GelenAjanMesaji } from "./ai-ajan.service";
import { aktifBaglam } from "../../core/istek-baglami";

@Controller("ai/ajan")
export class AiAjanController {
  constructor(private readonly ajanService: AiAjanService) {}

  /**
   * Dış kanallardan (WhatsApp, E-posta, Webhook) gelen mesajı işler
   */
  @Post("mesaj")
  async mesajiIsle(@Body() body: GelenAjanMesaji) {
    let baglamTenantId: string | undefined;
    let baglamUserId: string | undefined;

    try {
      const baglam = aktifBaglam();
      baglamTenantId = baglam.tenantId;
      baglamUserId = baglam.userId;
    } catch {
      // Dış Webhook çağrılarında (örneğin doğrudan WhatsApp Twilio/Meta webhook) baglam henüz oturum token'ı içermeyebilir
    }

    return this.ajanService.mesajiIsle({
      ...body,
      tenantId: body.tenantId || baglamTenantId,
      userId: body.userId || baglamUserId,
    });
  }

  /**
   * PIN Doğrulama
   */
  @Post("pin-dogrula")
  async pinDogrula(
    @Body() body: { kanal: string; kanalKimlik: string; pinKodu: string; tenantId?: string },
  ) {
    let tenantId = body.tenantId;
    if (!tenantId) {
      try {
        tenantId = aktifBaglam().tenantId;
      } catch {
        tenantId = "";
      }
    }

    const dogrulandi = await this.ajanService.pinDogrula(
      tenantId,
      body.kanal || "WHATSAPP",
      body.kanalKimlik,
      body.pinKodu,
    );

    return { dogrulandi };
  }

  /**
   * Oturum Bilgisi ve Mesaj Geçmişi
   */
  @Get("oturum/:id")
  async oturumDetay(@Param("id") oturumId: string) {
    const { tenantId } = aktifBaglam();
    return this.ajanService.oturumDetay(tenantId, oturumId);
  }

  /**
   * Web Arayüzü Simülatörü
   */
  @Post("simulasyon")
  async simulasyon(@Body() body: { mesaj: string; sesBase64?: string }) {
    const { tenantId, userId } = aktifBaglam();

    return this.ajanService.mesajiIsle({
      kanal: "WEB",
      kanalKimlik: "simulasyon@tekirextra.local",
      mesaj: body.mesaj,
      sesBase64: body.sesBase64,
      tenantId,
      userId,
    });
  }
}
