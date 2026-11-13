import "./cari.raporlar";
import { Module, OnModuleInit } from "@nestjs/common";
import { CariMahsupController } from "./cari-mahsup.controller";
import { registerEylemPolitikasi } from "../core/eylemler/eylem-kayit";
import { CariController } from "./cari.controller";
import { VadeHatirlatmaController } from "./vade-hatirlatma.controller";
import { VadeHatirlatmaService } from "./vade-hatirlatma.service";
import { CariTopluController } from "./cari-toplu.controller";
import { CariTopluService } from "./cari-toplu.service";
import { CariGrupController } from "./cari-grup.controller";
import { CariGrupService } from "./cari-grup.service";
import { CariMutabakatController } from "./cari-mutabakat.controller";
import { CariMutabakatService } from "./cari-mutabakat.service";
import { MutabakatPortalController } from "./mutabakat-portal.controller";
import { MutabakatPortalService } from "./mutabakat-portal.service";
import { MutabakatZamanlayiciService } from "./mutabakat-zamanlayici.service";
import { EklerModule } from "../ekler/ekler.module";
import { BildirimlerModule } from "../bildirimler/bildirimler.module";
import { CariService } from "./cari.service";
import { CariBirlestirmeController } from "./cari-birlestirme.controller";
import { CariBirlestirmeService } from "./cari-birlestirme.service";
import { TahsilatRiskiService } from "./tahsilat-riski";
import { CariIceAktarmaService } from "./cari-ice-aktarma.service";
import { TenantModule } from "../tenant/tenant.module";
import { OdemeSozuController } from "./odeme-sozu.controller";
import { OdemeSozuService } from "./odeme-sozu.service";
import { TahsilatTakibiController } from "./tahsilat-takibi.controller";
import { TahsilatTakibiService } from "./tahsilat-takibi.service";
import { GecikenSozZamanlayiciService } from "./geciken-soz-zamanlayici.service";

@Module({
  imports: [TenantModule, EklerModule, BildirimlerModule],
  // Sabit yollu denetleyici önce: "cari/vade-hatirlatma/...", "cari/toplu/...", "cari/gruplar/...", "cari/mutabakatlar/...", "cari/mukerrer/..." `:id` kalıplarına düşmesin.
  controllers: [TahsilatTakibiController, OdemeSozuController, VadeHatirlatmaController, CariTopluController, CariBirlestirmeController, CariGrupController, CariMutabakatController, MutabakatPortalController, CariMahsupController, CariController],
  providers: [GecikenSozZamanlayiciService, TahsilatTakibiService, OdemeSozuService, TahsilatRiskiService, CariService, CariIceAktarmaService, VadeHatirlatmaService, CariTopluService, CariBirlestirmeService, CariGrupService, CariMutabakatService, MutabakatPortalService, MutabakatZamanlayiciService],
  exports: [CariService, CariIceAktarmaService, TahsilatRiskiService],
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
