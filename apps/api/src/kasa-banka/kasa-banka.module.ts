import { Module, OnModuleInit } from "@nestjs/common";
import { registerEylemPolitikasi } from "../core/eylemler/eylem-kayit";
import { KasaBankaController } from "./kasa-banka.controller";
import { KasaBankaService } from "./kasa-banka.service";

@Module({
  controllers: [KasaBankaController],
  providers: [KasaBankaService],
  exports: [KasaBankaService],
})
export class KasaBankaModule implements OnModuleInit {
  onModuleInit() {
    // Kasa Eylem Politikası
    registerEylemPolitikasi<{ aktif: boolean; hareketSayisi: number }>("kasa", {
      duzenle: (k, ctx) => ["muhasebe", "yonetici"].includes(ctx.rol),
      sil: (k, ctx) => k.hareketSayisi === 0 && ["muhasebe", "yonetici"].includes(ctx.rol),
      pasife_al: (k, ctx) => k.aktif && ["muhasebe", "yonetici"].includes(ctx.rol),
    });

    // Banka Hesabı Eylem Politikası
    registerEylemPolitikasi<{ aktif: boolean; hareketSayisi: number }>("banka", {
      duzenle: (b, ctx) => ["muhasebe", "yonetici"].includes(ctx.rol),
      sil: (b, ctx) => b.hareketSayisi === 0 && ["muhasebe", "yonetici"].includes(ctx.rol),
      pasife_al: (b, ctx) => b.aktif && ["muhasebe", "yonetici"].includes(ctx.rol),
    });
  }
}
