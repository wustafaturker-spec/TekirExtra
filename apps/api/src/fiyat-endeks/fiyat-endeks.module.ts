import { Module } from "@nestjs/common";
import { MevzuatModule } from "../mevzuat/mevzuat.module";
import { EndeksZamanlayiciService } from "./endeks-zamanlayici.service";
import { EndeksService } from "./endeks.service";
import { FiyatEndeksController } from "./fiyat-endeks.controller";
import { FiyatEndeksService } from "./fiyat-endeks.service";
import { PlatformEndeksController } from "./platform-endeks.controller";
import "./fiyat-endeks.raporlar";
import "./fiyat-endeks-makas.raporlar";

/** END: fiyat ve endeks analizi (ortak endeks deposu, platform yönetimi, ürün karşılaştırması, toplu rapor). */
@Module({
  imports: [MevzuatModule],
  controllers: [FiyatEndeksController, PlatformEndeksController],
  providers: [EndeksService, EndeksZamanlayiciService, FiyatEndeksService],
  exports: [EndeksService, FiyatEndeksService],
})
export class FiyatEndeksModule {}
