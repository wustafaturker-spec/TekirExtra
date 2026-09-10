import { Module } from "@nestjs/common";
import { SevkiyatController } from "./sevkiyat.controller";
import { SevkiyatService } from "./sevkiyat.service";

/** Araç ve şoför kartları (EBLG-25). */
@Module({
  controllers: [SevkiyatController],
  providers: [SevkiyatService],
  exports: [SevkiyatService],
})
export class SevkiyatModule {}
