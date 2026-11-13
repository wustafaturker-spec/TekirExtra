import { Controller, Get } from "@nestjs/common";
import { katalogKaydi } from "@tekirextra/shared";
import { PlatformRolleri, PlatformUcu } from "../auth/public.decorator";
import { PlatformPrismaService } from "./platform-prisma.service";

/** ETC-02: "Yakında" platformlara gelen talepler; yalnız platform başına firma sayısı (hangi firma olduğu dönmez). */
@PlatformUcu()
@PlatformRolleri("yonetici")
@Controller("platform/entegrasyon-talepleri")
export class PlatformEntegrasyonController {
  constructor(private readonly platform: PlatformPrismaService) {}

  @Get()
  async sayilar() {
    const satirlar = await this.platform.db.$queryRaw<Array<{ saglayici: string; firma_sayisi: number; son_talep: Date }>>`SELECT saglayici, firma_sayisi, son_talep FROM platform_entegrasyon_talep_sayilari()`;
    return satirlar.map((s) => ({ saglayici: s.saglayici, ad: katalogKaydi(s.saglayici)?.ad ?? s.saglayici, firmaSayisi: Number(s.firma_sayisi), sonTalep: s.son_talep }));
  }
}
