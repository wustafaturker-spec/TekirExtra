import { Module, forwardRef } from "@nestjs/common";
import { FaturaModule } from "../fatura/fatura.module";
import { TenantModule } from "../tenant/tenant.module";
import { EbelgeController } from "./ebelge.controller";
import { EbelgeService } from "./ebelge.service";
import { EbelgeKuyrukService } from "./ebelge-kuyruk.service";
import { EirsaliyeController } from "./eirsaliye.controller";
import { EirsaliyeService } from "./eirsaliye.service";

@Module({
  // Gelen belgenin taslak alış faturasına dönüşü FaturaService üzerinden
  // yapılır; FaturaModule da e-belge kuyruğunu kullandığı için döngüsel.
  imports: [TenantModule, forwardRef(() => FaturaModule)],
  controllers: [EbelgeController, EirsaliyeController],
  providers: [EbelgeService, EbelgeKuyrukService, EirsaliyeService],
  exports: [EbelgeService, EbelgeKuyrukService],
})
export class EbelgeModule {}
