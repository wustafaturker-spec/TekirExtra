import { CrmBelgeService } from "./crm-belge.service";
import { CrmBelgeController } from "./crm-belge.controller";
import { Module } from "@nestjs/common";
import { CrmFirsatController } from "./crm-firsat.controller";
import { CrmFirsatService } from "./crm-firsat.service";
import { BelgelerModule } from "../belgeler/belgeler.module";

@Module({
  imports: [BelgelerModule],
  controllers: [CrmFirsatController, CrmBelgeController],
  providers: [CrmFirsatService, CrmBelgeService],
  exports: [CrmFirsatService],
})
export class CrmFirsatModule {}
