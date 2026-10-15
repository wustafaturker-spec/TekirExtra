import { Module } from "@nestjs/common";
import { EklerModule } from "../ekler/ekler.module";
import { AiModule } from "../ai/ai.module";
import { BaglantilarService } from "./baglantilar.service";
import { BelgeTasarimlariService } from "./belge-tasarimlari.service";
import { DenetimController } from "./denetim.controller";
import { EpostaService } from "./eposta.service";
import { ImapService } from "./imap.service";
import { KayitService } from "./kayit.service";
import { KullanicilarController } from "./kullanicilar.controller";
import { KullanimController } from "./kullanim.controller";
import { TenantController } from "./tenant.controller";
import { EpostaController } from "./eposta.controller";
import { GelenEpostaController } from "./gelen-eposta.controller";
import { AbonelikController } from "./abonelik.controller";
import { AbonelikService } from "./abonelik.service";

import { EpostaZamanlayiciService } from "./eposta-zamanlayici.service";

@Module({
  imports: [EklerModule, AiModule],
  controllers: [
    TenantController,
    KullanicilarController,
    DenetimController,
    KullanimController,
    EpostaController,
    GelenEpostaController,
    AbonelikController,
  ],
  providers: [
    KayitService,
    EpostaService,
    ImapService,
    EpostaZamanlayiciService,
    BaglantilarService,
    BelgeTasarimlariService,
    AbonelikService,
  ],
  exports: [BaglantilarService, EpostaService, ImapService, AbonelikService],
})
export class TenantModule {}
