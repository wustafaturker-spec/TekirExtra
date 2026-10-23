import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AracTakipController } from "./arac-takip.controller";
import { AracTakipService } from "./arac-takip.service";

/** ARC-01…11 (§3.21): araç takibi. */
@Module({
  imports: [AuthModule],
  controllers: [AracTakipController],
  providers: [AracTakipService],
  exports: [AracTakipService],
})
export class AracTakipModule {}
