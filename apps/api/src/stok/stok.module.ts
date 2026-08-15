import "./stok.raporlar";
import "./urun-hareket.raporlar";
import { Module, OnModuleInit } from "@nestjs/common";
import { registerEylemPolitikasi } from "../core/eylemler/eylem-kayit";
import { DepoController } from "./depo.controller";
import { DepoService } from "./depo.service";
import { StokController } from "./stok.controller";
import { StokService } from "./stok.service";
import { TransferService } from "./transfer.service";
import { TenantModule } from "../tenant/tenant.module";

@Module({
  imports: [TenantModule],
  controllers: [StokController, DepoController],
  providers: [StokService, DepoService, TransferService],
  exports: [StokService, DepoService],
})
export class StokModule implements OnModuleInit {
  onModuleInit() {
    // AYR-04/05/06: Stok kayıt eylem politikası kaydı
    registerEylemPolitikasi<{ aktif: boolean; hareketSayisi: number }>("stok", {
      duzenle: (s, ctx) => ["muhasebe", "yonetici"].includes(ctx.rol),
      sil: (s, ctx) => s.hareketSayisi === 0 && ["muhasebe", "yonetici"].includes(ctx.rol),
      pasife_al: (s, ctx) => s.aktif && s.hareketSayisi > 0 && ["muhasebe", "yonetici"].includes(ctx.rol),
      kopyala: (s, ctx) => ctx.rol !== "salt_okunur",
    });
  }
}
