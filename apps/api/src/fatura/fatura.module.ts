import "./fatura.raporlar";
import { Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { registerEylemPolitikasi } from "../core/eylemler/eylem-kayit";
import { StokModule } from "../stok/stok.module";
import { BelgelerModule } from "../belgeler/belgeler.module";
import { EbelgeModule } from "../ebelge/ebelge.module";
import { TenantModule } from "../tenant/tenant.module";
import { FaturaController } from "./fatura.controller";
import { FaturaService } from "./fatura.service";
import { KurFarkiController } from "./kur-farki.controller";
import { KurFarkiService } from "./kur-farki.service";

@Module({
  imports: [
    StokModule,
    TenantModule,
    BelgelerModule,
    forwardRef(() => EbelgeModule),
  ],
  controllers: [FaturaController, KurFarkiController],
  providers: [FaturaService, KurFarkiService],
  exports: [FaturaService],
})
export class FaturaModule implements OnModuleInit {
  onModuleInit() {
    // AYR-04/05/06: Fatura kayıt eylem politikası kaydı
    registerEylemPolitikasi<{ durum: string }>("fatura", {
      duzenle: (f, ctx) => f.durum === "taslak" && ["muhasebe", "yonetici"].includes(ctx.rol),
      sil: (f, ctx) => f.durum === "taslak" && ["muhasebe", "yonetici"].includes(ctx.rol),
      iptal: (f, ctx) => f.durum === "kesin" && ["muhasebe", "yonetici"].includes(ctx.rol),
      kopyala: (f, ctx) => ctx.rol !== "salt_okunur",
    });
  }
}
