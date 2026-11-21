import { PlatformDuyuruController } from "./platform-duyuru.controller";
import { TenantDuyuruController } from "./tenant-duyuru.controller";
import { TenantDuyuruService } from "./tenant-duyuru.service";
import { PlatformDuyuruService } from "./platform-duyuru.service";
import { PlatformPaketService } from "./platform-paket.service";
import { PlatformFirmaIstisnaModule } from "./platform-firma-istisna.controller";
import { PlatformKotaModule } from "./platform-kota.controller";
import { PlatformPaketZamanlayiciService } from "./platform-paket-zamanlayici.service";
import { PlatformPaketController } from "./platform-paket.controller";
import { PlatformIstatistikService } from "./platform-istatistik.service";
import { PlatformIstatistikController } from "./platform-istatistik.controller";
import { PlatformIstatistikZamanlayiciService } from "./platform-istatistik-zamanlayici.service";
import { PlatformFirmaTakipService } from "./platform-firma-takip.service";
import { PlatformFirmaTakipController } from "./platform-firma-takip.controller";
import { Global, Module } from "@nestjs/common";
import { MevzuatController } from "./mevzuat.controller";
import { MevzuatService } from "./mevzuat.service";
import { PlatformAiController, PlatformAuthController, PlatformFirmaController, PlatformKullanicilarController, PlatformMevzuatController } from "./platform.controller";
import { PlatformKullanicilarService } from "./platform-kullanicilar.service";
import { PlatformFirmaService } from "./platform-firma.service";
import { GirisDenemeSayaci } from "../auth/giris-deneme-sayaci";
import { PlatformAiTavanService } from "./platform-ai-tavan.service";
import { PlatformAiOzellikService } from "./platform-ai-ozellik.service";
import { PlatformAuthService } from "./platform-auth.service";
import { PlatformMevzuatService } from "./platform-mevzuat.service";
import { PlatformIletiService } from "../ileti/platform-ileti.service";
import { IletiSablonService } from "../ileti/ileti-sablon.service";
import { IletiSablonController, PlatformIletiSablonController } from "../ileti/ileti-sablon.controller";
import { PlatformIletiController } from "../ileti/platform-ileti.controller";
import { SmsKodService } from "../ileti/sms-kod.service";
import { PlatformVergiTakvimiService } from "./platform-vergi-takvimi.service";
import { PlatformVergiTakvimiController } from "./platform-vergi-takvimi.controller";
import { PlatformOturumDurumService } from "./platform-oturum-durum.service";
import { PlatformPrismaService } from "./platform-prisma.service";
import { PlatformEntegrasyonController } from "./platform-entegrasyon.controller";
import { MevzuatHatirlatmaService } from "./mevzuat-hatirlatma.service";
import { TahsilatHatirlatmaService } from "./tahsilat-hatirlatma.service";
import { PlatformGorevController } from "./platform-gorev.controller";
import { PlatformGorevService } from "./platform-gorev.service";
import { EklerModule } from "../ekler/ekler.module";
import { DuyuruGorselController } from "./duyuru-gorsel.controller";
import { PlatformVergiDaireleriController } from "./platform-vergi-daireleri.controller";

/**
 * Mevzuat Merkezi (MVZ). `MevzuatService` diğer modüllerin (fatura, e-belge,
 * bordro) yürürlükteki değeri okuduğu kapıdır; platform servisleri yalnız
 * platform uçlarında kullanılır.
 */
@Global()
@Module({
  imports: [PlatformFirmaIstisnaModule, PlatformKotaModule, EklerModule],
  controllers: [PlatformEntegrasyonController, IletiSablonController, PlatformIletiSablonController, PlatformIletiController, PlatformVergiTakvimiController, TenantDuyuruController, PlatformDuyuruController, DuyuruGorselController, PlatformVergiDaireleriController, PlatformPaketController, PlatformIstatistikController, PlatformFirmaTakipController, PlatformGorevController, MevzuatController, PlatformAuthController, PlatformMevzuatController, PlatformAiController, PlatformFirmaController, PlatformKullanicilarController],
  providers: [IletiSablonService, SmsKodService, PlatformIletiService, PlatformVergiTakvimiService, TenantDuyuruService, PlatformDuyuruService, PlatformPaketService, PlatformPaketZamanlayiciService, PlatformIstatistikService, PlatformIstatistikZamanlayiciService, PlatformFirmaTakipService, PlatformGorevService, MevzuatService, PlatformPrismaService, PlatformAuthService, PlatformMevzuatService, PlatformAiTavanService, PlatformAiOzellikService, MevzuatHatirlatmaService, TahsilatHatirlatmaService, PlatformFirmaService, PlatformKullanicilarService, GirisDenemeSayaci, PlatformOturumDurumService],
  exports: [IletiSablonService, SmsKodService, PlatformIletiService, MevzuatService, PlatformPrismaService, PlatformOturumDurumService],
})
export class MevzuatModule {}
