import { Module } from "@nestjs/common";
import { AbonelikOdemeController, AbonelikOdemePublicController } from "./abonelik-odeme.controller";
import { AbonelikOdemeService } from "./abonelik-odeme.service";
import { PlatformOdemeController } from "./platform-odeme.controller";
import { SaglayiciAyarlariService } from "./saglayici-ayarlari.service";

/** PLT-11…15: abonelik bedelinin ödeme sağlayıcısıyla tahsili. */
@Module({
  controllers: [AbonelikOdemeController, AbonelikOdemePublicController, PlatformOdemeController],
  providers: [AbonelikOdemeService, SaglayiciAyarlariService],
  exports: [AbonelikOdemeService, SaglayiciAyarlariService],
})
export class AbonelikOdemeModule {}
