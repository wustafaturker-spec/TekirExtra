import { Global, Module } from "@nestjs/common";
import { EklerModule } from "../ekler/ekler.module";
import { AyarlarController } from "./ayarlar/ayarlar.controller";
import { AyarlarService } from "./ayarlar/ayarlar.service";
import { PdfService } from "./pdf/pdf.service";
import { BelgeGorunumuController } from "./pdf/belge-gorunumu.controller";
import { AbonelikErisimService } from "./abonelik-erisim.service";
import { DestekOturumService } from "./destek-oturum.service";
import { KullaniciDurumService } from "./kullanici-durum.service";
import { PrismaService } from "./prisma.service";
import { RaporlarController } from "./raporlar/raporlar.controller";
import { RaporlarService } from "./raporlar/raporlar.service";

@Global()
@Module({
  // PdfService, firma logosunu (KLN-03) depodan okumak için DepoService'e bağlı
  imports: [EklerModule],
  controllers: [AyarlarController, RaporlarController, BelgeGorunumuController],
  providers: [PrismaService, AyarlarService, RaporlarService, PdfService, KullaniciDurumService, AbonelikErisimService, DestekOturumService],
  exports: [PrismaService, AyarlarService, RaporlarService, PdfService, KullaniciDurumService, AbonelikErisimService, DestekOturumService],
})
export class CoreModule {}
