import { Module } from "@nestjs/common";
import { BildirimlerModule } from "../bildirimler/bildirimler.module";
import { MevzuatModule } from "../mevzuat/mevzuat.module";
import { EndeksArtisController } from "./endeks-artis.controller";
import { EndeksArtisService } from "./endeks-artis.service";
import { EndeksArtisZamanlayiciService } from "./endeks-artis-zamanlayici.service";
import { EndeksZamanlayiciService } from "./endeks-zamanlayici.service";
import { EndeksService } from "./endeks.service";
import { FiyatEndeksController } from "./fiyat-endeks.controller";
import { FiyatEndeksService } from "./fiyat-endeks.service";
import { PlatformEndeksController } from "./platform-endeks.controller";
import "./fiyat-endeks.raporlar";
import "./fiyat-endeks-makas.raporlar";
import "./fiyat-endeks-erime.raporlar";

/** END: fiyat ve endeks analizi (ortak endeks deposu, platform yönetimi, ürün karşılaştırması, toplu rapor). */
@Module({
  imports: [MevzuatModule, BildirimlerModule],
  controllers: [FiyatEndeksController, PlatformEndeksController, EndeksArtisController],
  providers: [EndeksService, EndeksZamanlayiciService, FiyatEndeksService, EndeksArtisService, EndeksArtisZamanlayiciService],
  exports: [EndeksService, FiyatEndeksService],
})
export class FiyatEndeksModule {}
