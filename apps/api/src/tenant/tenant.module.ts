import { Module } from "@nestjs/common";
import { BaglantilarService } from "./baglantilar.service";
import { EpostaService } from "./eposta.service";
import { KayitService } from "./kayit.service";
import { KullanicilarController } from "./kullanicilar.controller";
import { TenantController } from "./tenant.controller";

@Module({
  controllers: [TenantController, KullanicilarController],
  providers: [KayitService, EpostaService, BaglantilarService],
  exports: [BaglantilarService],
})
export class TenantModule {}
