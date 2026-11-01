import { Module } from "@nestjs/common";
import { CariModule } from "../cari/cari.module";
import { FaturaModule } from "../fatura/fatura.module";
import { KasaBankaModule } from "../kasa-banka/kasa-banka.module";
import { PosModule } from "../pos/pos.module";
import { BildirimlerModule } from "../bildirimler/bildirimler.module";
import { AbonelikFaturaAyarService } from "./abonelik-fatura-ayar.service";
import { AbonelikFaturaService } from "./abonelik-fatura.service";
import { AbonelikOdemeController, AbonelikOdemePublicController } from "./abonelik-odeme.controller";
import { AbonelikOdemeService } from "./abonelik-odeme.service";
import { OtomatikYenilemeService } from "./otomatik-yenileme.service";
import { PlatformAbonelikFaturaController, PlatformAbonelikIadeController, PlatformOdemeController } from "./platform-odeme.controller";
import { PlatformAbonelikIadeService } from "./platform-abonelik-iade.service";
import { PlatformOdemeRaporuController } from "./platform-odeme-raporu.controller";
import { PlatformOdemeRaporuService } from "./platform-odeme-raporu.service";
import { SaglayiciAyarlariService } from "./saglayici-ayarlari.service";

/** PLT-11…15: abonelik bedelinin ödeme sağlayıcısıyla tahsili; PLT-20…23: abonelik faturası ve tahsilatı; PLT-32…37: ödeme raporu. */
@Module({
  imports: [FaturaModule, CariModule, KasaBankaModule, PosModule, BildirimlerModule],
  controllers: [AbonelikOdemeController, AbonelikOdemePublicController, PlatformOdemeController, PlatformAbonelikFaturaController, PlatformOdemeRaporuController, PlatformAbonelikIadeController],
  providers: [AbonelikOdemeService, SaglayiciAyarlariService, OtomatikYenilemeService, AbonelikFaturaService, AbonelikFaturaAyarService, PlatformOdemeRaporuService, PlatformAbonelikIadeService],
  exports: [AbonelikOdemeService, SaglayiciAyarlariService],
})
export class AbonelikOdemeModule {}
