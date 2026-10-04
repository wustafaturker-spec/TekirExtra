import "./cari.raporlar";
import { Module, OnModuleInit } from "@nestjs/common";
import { registerEylemPolitikasi } from "../core/eylemler/eylem-kayit";
import { CariController } from "./cari.controller";
import { VadeHatirlatmaController } from "./vade-hatirlatma.controller";
import { VadeHatirlatmaService } from "./vade-hatirlatma.service";
import { CariTopluController } from "./cari-toplu.controller";
import { CariTopluService } from "./cari-toplu.service";
import { CariGrupController } from "./cari-grup.controller";
import { CariGrupService } from "./cari-grup.service";
import { CariService } from "./cari.service";
import { CariIceAktarmaService } from "./cari-ice-aktarma.service";
import { TenantModule } from "../tenant/tenant.module";

@Module({
  imports: [TenantModule],
  // Sabit yollu denetleyici önce: "cari/vade-hatirlatma/...", "cari/toplu/...", "cari/gruplar/..." `:id` kalıplarına düşmesin.
  controllers: [VadeHatirlatmaController, CariTopluController, CariGrupController, CariController],
  providers: [CariService, CariIceAktarmaService, VadeHatirlatmaService, CariTopluService, CariGrupService],
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
