import { Module } from "@nestjs/common";
import { CrmFirsatController } from "./crm-firsat.controller";
import { CrmFirsatService } from "./crm-firsat.service";

@Module({
  controllers: [CrmFirsatController],
  providers: [CrmFirsatService],
  exports: [CrmFirsatService],
})
export class CrmFirsatModule {}
