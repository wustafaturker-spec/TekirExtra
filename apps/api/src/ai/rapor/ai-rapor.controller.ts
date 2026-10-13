import { Controller, Post, Get, Body } from "@nestjs/common";
import { AiRaporService } from "./ai-rapor.service";
import { aktifBaglam } from "../../core/istek-baglami";
import { Roller } from "../../auth/roller.decorator";

/** AI-02: finansal özet rolleri (RPR-11 `GET /rapor/ozet` ile aynı). */
@Controller("ai/rapor")
@Roller("muhasebe", "mali_musavir", "salt_okunur")
export class AiRaporController {
  constructor(private readonly raporService: AiRaporService) {}

  /**
   * Doğal dille finansal soru sorma (ChatBI / Text-to-Insight)
   */
  @Post("sor")
  async soruSor(@Body() body: { soru: string }) {
    const { tenantId } = aktifBaglam();
    return this.raporService.soruCevapla(tenantId, body.soru);
  }

  /**
   * Haftalık / Aylık AI CFO Yönetici Brifingi ve Sağlık Skoru
   */
  @Get("yonetici-brifingi")
  async yoneticiBrifingi() {
    const { tenantId } = aktifBaglam();
    return this.raporService.yoneticiBrifingiUret(tenantId);
  }
}
