import { Module, OnModuleInit } from "@nestjs/common";
import { registerEylemPolitikasi } from "../core/eylemler/eylem-kayit";
import { StokController } from "./stok.controller";
import { StokService } from "./stok.service";

@Module({
  controllers: [StokController],
  providers: [StokService],
  exports: [StokService],
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
