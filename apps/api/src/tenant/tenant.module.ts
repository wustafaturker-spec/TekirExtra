import { Module } from "@nestjs/common";
import { BaglantilarService } from "./baglantilar.service";
import { DenetimController } from "./denetim.controller";
import { EpostaService } from "./eposta.service";
import { KayitService } from "./kayit.service";
import { KullanicilarController } from "./kullanicilar.controller";
import { KullanimController } from "./kullanim.controller";
import { TenantController } from "./tenant.controller";
import { EpostaController } from "./eposta.controller";

@Module({
  controllers: [TenantController, KullanicilarController, DenetimController, KullanimController, EpostaController],
  providers: [KayitService, EpostaService, BaglantilarService],
  exports: [BaglantilarService, EpostaService],
})
export class TenantModule {}
