import { Global, Module } from "@nestjs/common";
import { MevzuatController } from "./mevzuat.controller";
import { MevzuatService } from "./mevzuat.service";
import { PlatformAiController, PlatformAuthController, PlatformFirmaController, PlatformKullanicilarController, PlatformMevzuatController } from "./platform.controller";
import { PlatformKullanicilarService } from "./platform-kullanicilar.service";
import { PlatformFirmaService } from "./platform-firma.service";
import { GirisDenemeSayaci } from "../auth/giris-deneme-sayaci";
import { PlatformAiTavanService } from "./platform-ai-tavan.service";
import { PlatformAuthService } from "./platform-auth.service";
import { PlatformMevzuatService } from "./platform-mevzuat.service";
import { PlatformOturumDurumService } from "./platform-oturum-durum.service";
import { PlatformPrismaService } from "./platform-prisma.service";
import { MevzuatHatirlatmaService } from "./mevzuat-hatirlatma.service";
import { TahsilatHatirlatmaService } from "./tahsilat-hatirlatma.service";
import { PlatformGorevController } from "./platform-gorev.controller";
import { PlatformGorevService } from "./platform-gorev.service";

/**
 * Mevzuat Merkezi (MVZ). `MevzuatService` diğer modüllerin (fatura, e-belge,
 * bordro) yürürlükteki değeri okuduğu kapıdır; platform servisleri yalnız
 * platform uçlarında kullanılır.
 */
@Global()
@Module({
  controllers: [PlatformGorevController, MevzuatController, PlatformAuthController, PlatformMevzuatController, PlatformAiController, PlatformFirmaController, PlatformKullanicilarController],
  providers: [PlatformGorevService, MevzuatService, PlatformPrismaService, PlatformAuthService, PlatformMevzuatService, PlatformAiTavanService, MevzuatHatirlatmaService, TahsilatHatirlatmaService, PlatformFirmaService, PlatformKullanicilarService, GirisDenemeSayaci, PlatformOturumDurumService],
  exports: [MevzuatService, PlatformPrismaService, PlatformOturumDurumService],
})
export class MevzuatModule {}
