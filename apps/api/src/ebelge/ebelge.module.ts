import { Module, forwardRef } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { BelgelerModule } from "../belgeler/belgeler.module";
import { BildirimlerModule } from "../bildirimler/bildirimler.module";
import { FaturaModule } from "../fatura/fatura.module";
import { TenantModule } from "../tenant/tenant.module";
import { EbelgeController } from "./ebelge.controller";
import { EbelgeService } from "./ebelge.service";
import { EbelgeKuyrukService } from "./ebelge-kuyruk.service";
import { EbelgeGorunumService } from "./ebelge-gorunum.service";
import { EbelgeUygulamalariService } from "./ebelge-uygulamalari.service";
import { EbelgeUygulamasiGuard } from "./ebelge-uygulamasi.guard";
import { EirsaliyeController } from "./eirsaliye.controller";
import { EirsaliyeService } from "./eirsaliye.service";
import { MukellefListesiService } from "./mukellef-listesi.service";

@Module({
  // Gelen belgenin taslak alış faturasına dönüşü FaturaService üzerinden
  // yapılır; FaturaModule da e-belge kuyruğunu kullandığı için döngüsel.
  imports: [TenantModule, BildirimlerModule, BelgelerModule, forwardRef(() => FaturaModule)],
  controllers: [EbelgeController, EirsaliyeController],
  providers: [
    EbelgeService, EbelgeKuyrukService, EbelgeGorunumService, EirsaliyeService, MukellefListesiService,
    EbelgeUygulamalariService,
    // EBLG-77: kapalı e-belge uygulamasının ucu reddedilir. Guard global
    // çalışır ama dekoratörsüz uçlara hiç dokunmaz.
    { provide: APP_GUARD, useClass: EbelgeUygulamasiGuard },
  ],
  exports: [EbelgeService, EbelgeKuyrukService, EbelgeGorunumService, MukellefListesiService, EbelgeUygulamalariService],
})
export class EbelgeModule {}
