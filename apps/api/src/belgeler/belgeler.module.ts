import { Module, OnModuleInit } from "@nestjs/common";
import { registerEylemPolitikasi } from "../core/eylemler/eylem-kayit";
import { StokModule } from "../stok/stok.module";
import { TenantModule } from "../tenant/tenant.module";
import { BelgelerController } from "./belgeler.controller";
import { BelgelerService } from "./belgeler.service";
import { TeklifTakipController } from "./teklif-takibi/teklif-takip.controller";
import { TeklifTakipService } from "./teklif-takibi/teklif-takip.service";

/** Belge zinciri modülü (FTR-12/13): teklif → sipariş → irsaliye → fatura. */
@Module({
  imports: [StokModule, TenantModule],
  controllers: [BelgelerController, TeklifTakipController],
  providers: [BelgelerService, TeklifTakipService],
  exports: [BelgelerService],
})
export class BelgelerModule implements OnModuleInit {
  onModuleInit() {
    const yetkili = (rol: string) => ["muhasebe", "yonetici", "satis"].includes(rol);
    registerEylemPolitikasi<{ durum: string }>("belge", {
      duzenle: (b, ctx) => b.durum === "taslak" && yetkili(ctx.rol),
      sil: (b, ctx) => b.durum === "taslak" && yetkili(ctx.rol),
      // Kısmen teslim edilmiş siparişin kalanından vazgeçilebilir (SAT-09).
      iptal: (b, ctx) =>
        ["taslak", "onaylandi", "kismen_kapandi"].includes(b.durum) && yetkili(ctx.rol),
      kopyala: (b, ctx) => ctx.rol !== "salt_okunur",
    });
  }
}
