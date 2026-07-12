import { Module } from "@nestjs/common";
import { TenantModule } from "../tenant/tenant.module";
import { EbelgeController } from "./ebelge.controller";
import { EbelgeService } from "./ebelge.service";
import { EbelgeKuyrukService } from "./ebelge-kuyruk.service";

@Module({
  imports: [TenantModule],
  controllers: [EbelgeController],
  providers: [EbelgeService, EbelgeKuyrukService],
  exports: [EbelgeService, EbelgeKuyrukService],
})
export class EbelgeModule {}
