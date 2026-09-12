import { Module, forwardRef } from "@nestjs/common";
import { BildirimlerModule } from "../bildirimler/bildirimler.module";
import { FaturaModule } from "../fatura/fatura.module";
import { TenantModule } from "../tenant/tenant.module";
import { EbelgeController } from "./ebelge.controller";
import { EbelgeService } from "./ebelge.service";
import { EbelgeKuyrukService } from "./ebelge-kuyruk.service";
import { EbelgeGorunumService } from "./ebelge-gorunum.service";
import { EirsaliyeController } from "./eirsaliye.controller";
import { EirsaliyeService } from "./eirsaliye.service";
import { MukellefListesiService } from "./mukellef-listesi.service";

@Module({
  // Gelen belgenin taslak alış faturasına dönüşü FaturaService üzerinden
  // yapılır; FaturaModule da e-belge kuyruğunu kullandığı için döngüsel.
  imports: [TenantModule, BildirimlerModule, forwardRef(() => FaturaModule)],
  controllers: [EbelgeController, EirsaliyeController],
  providers: [EbelgeService, EbelgeKuyrukService, EbelgeGorunumService, EirsaliyeService, MukellefListesiService],
  exports: [EbelgeService, EbelgeKuyrukService, MukellefListesiService],
})
export class EbelgeModule {}
