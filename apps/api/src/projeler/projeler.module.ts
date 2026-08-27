import { Module } from "@nestjs/common";
import { ProjelerController } from "./projeler.controller";
import { ProjelerService } from "./projeler.service";

@Module({
  controllers: [ProjelerController],
  providers: [ProjelerService],
  exports: [ProjelerService],
})
export class ProjelerModule {}
