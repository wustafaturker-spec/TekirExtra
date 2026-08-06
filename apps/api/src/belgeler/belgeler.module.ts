import { Module, OnModuleInit } from "@nestjs/common";
import { registerEylemPolitikasi } from "../core/eylemler/eylem-kayit";
import { StokModule } from "../stok/stok.module";
import { BelgelerController } from "./belgeler.controller";
import { BelgelerService } from "./belgeler.service";

/** Belge zinciri modülü (FTR-12/13): teklif → sipariş → irsaliye → fatura. */
@Module({
  imports: [StokModule],
  controllers: [BelgelerController],
  providers: [BelgelerService],
  exports: [BelgelerService],
})
export class BelgelerModule implements OnModuleInit {
  onModuleInit() {
    const yetkili = (rol: string) => ["muhasebe", "yonetici", "satis"].includes(rol);
    registerEylemPolitikasi<{ durum: string }>("belge", {
      duzenle: (b, ctx) => b.durum === "taslak" && yetkili(ctx.rol),
      sil: (b, ctx) => b.durum === "taslak" && yetkili(ctx.rol),
      iptal: (b, ctx) =>
        ["taslak", "onaylandi"].includes(b.durum) && yetkili(ctx.rol),
      kopyala: (b, ctx) => ctx.rol !== "salt_okunur",
    });
  }
}
