import "./kasa-banka.raporlar";
import { Module, OnModuleInit } from "@nestjs/common";
import { registerEylemPolitikasi } from "../core/eylemler/eylem-kayit";
import { EkstreService } from "./ekstre.service";
import { EkstreEslestirmeService } from "./ekstre-eslestirme.service";
import { KasaBankaController } from "./kasa-banka.controller";
import { KasaBankaService } from "./kasa-banka.service";
import { DovizIslemService } from "./doviz-islem.service";
import { DovizBaglamaService } from "./doviz-baglama.service";
import { BankaWebhookController } from "./banka-webhook.controller";
import { KrediController } from "./kredi.controller";
import { KrediService } from "./kredi.service";
import { BankaSenkronZamanlayiciService } from "./banka-senkron-zamanlayici.service";
import { BankaEntegrasyonService } from "./banka-entegrasyon.service";
import { AuthModule } from "../auth/auth.module";
import { OdemeTalimatiService } from "./odeme-talimati.service";
import { KrediKartiController } from "./kredi-karti.controller";
import { KrediKartiService } from "./kredi-karti.service";
import { EklerModule } from "../ekler/ekler.module";
import { CekBordroController } from "./cek-bordro.controller";
import { CekBordroService } from "./cek-bordro.service";
import { OdemeTalimatiController } from "./odeme-talimati.controller";

@Module({
  imports: [AuthModule, EklerModule],
  controllers: [KasaBankaController, BankaWebhookController, KrediKartiController, CekBordroController, OdemeTalimatiController, KrediController],
  providers: [KasaBankaService, DovizIslemService, DovizBaglamaService, EkstreService, EkstreEslestirmeService, BankaEntegrasyonService, BankaSenkronZamanlayiciService, KrediService, OdemeTalimatiService, KrediKartiService, CekBordroService],
  exports: [KasaBankaService, EkstreService, KrediService],
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
