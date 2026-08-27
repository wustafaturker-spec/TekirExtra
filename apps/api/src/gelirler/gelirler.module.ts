import { Module } from "@nestjs/common";
import { GelirlerController } from "./gelirler.controller";
import { GelirlerService } from "./gelirler.service";

@Module({
  controllers: [GelirlerController],
  providers: [GelirlerService],
  exports: [GelirlerService],
})
export class GelirlerModule {}
