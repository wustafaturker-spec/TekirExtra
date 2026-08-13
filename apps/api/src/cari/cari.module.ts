import "./cari.raporlar";
import { Module, OnModuleInit } from "@nestjs/common";
import { registerEylemPolitikasi } from "../core/eylemler/eylem-kayit";
import { CariController } from "./cari.controller";
import { CariService } from "./cari.service";
import { TenantModule } from "../tenant/tenant.module";

@Module({
  imports: [TenantModule],
  controllers: [CariController],
  providers: [CariService],
  exports: [CariService],
})
export class CariModule implements OnModuleInit {
  onModuleInit() {
    // AYR-04/05/06: Cari kayıt eylem politikası kaydı
    registerEylemPolitikasi<{ aktif: boolean; hareketSayisi: number }>("cari", {
      duzenle: (c, ctx) => ["muhasebe", "yonetici"].includes(ctx.rol),
      sil: (c, ctx) => c.hareketSayisi === 0 && ["muhasebe", "yonetici"].includes(ctx.rol),
      pasife_al: (c, ctx) => c.aktif && c.hareketSayisi > 0 && ["muhasebe", "yonetici"].includes(ctx.rol),
      kopyala: (c, ctx) => ctx.rol !== "salt_okunur",
    });
  }
}
