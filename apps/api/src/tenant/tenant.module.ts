import { Module } from "@nestjs/common";
import { BaglantilarService } from "./baglantilar.service";
import { BelgeTasarimlariService } from "./belge-tasarimlari.service";
import { DenetimController } from "./denetim.controller";
import { EpostaService } from "./eposta.service";
import { KayitService } from "./kayit.service";
import { KullanicilarController } from "./kullanicilar.controller";
import { KullanimController } from "./kullanim.controller";
import { TenantController } from "./tenant.controller";
import { EpostaController } from "./eposta.controller";
import { AbonelikController } from "./abonelik.controller";
import { AbonelikService } from "./abonelik.service";

@Module({
  controllers: [TenantController, KullanicilarController, DenetimController, KullanimController, EpostaController, AbonelikController],
  providers: [KayitService, EpostaService, BaglantilarService, BelgeTasarimlariService, AbonelikService],
  exports: [BaglantilarService, EpostaService, AbonelikService],
})
export class TenantModule {}
