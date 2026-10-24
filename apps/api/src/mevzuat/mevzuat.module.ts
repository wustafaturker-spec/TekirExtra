import { Global, Module } from "@nestjs/common";
import { MevzuatController } from "./mevzuat.controller";
import { MevzuatService } from "./mevzuat.service";
import { PlatformAiController, PlatformAuthController, PlatformFirmaController, PlatformMevzuatController } from "./platform.controller";
import { PlatformFirmaService } from "./platform-firma.service";
import { GirisDenemeSayaci } from "../auth/giris-deneme-sayaci";
import { PlatformAiTavanService } from "./platform-ai-tavan.service";
import { PlatformAuthService } from "./platform-auth.service";
import { PlatformMevzuatService } from "./platform-mevzuat.service";
import { PlatformPrismaService } from "./platform-prisma.service";
import { MevzuatHatirlatmaService } from "./mevzuat-hatirlatma.service";

/**
 * Mevzuat Merkezi (MVZ). `MevzuatService` diğer modüllerin (fatura, e-belge,
 * bordro) yürürlükteki değeri okuduğu kapıdır; platform servisleri yalnız
 * platform uçlarında kullanılır.
 */
@Global()
@Module({
  controllers: [MevzuatController, PlatformAuthController, PlatformMevzuatController, PlatformAiController, PlatformFirmaController],
  providers: [MevzuatService, PlatformPrismaService, PlatformAuthService, PlatformMevzuatService, PlatformAiTavanService, MevzuatHatirlatmaService, PlatformFirmaService, GirisDenemeSayaci],
  exports: [MevzuatService, PlatformPrismaService],
})
export class MevzuatModule {}
