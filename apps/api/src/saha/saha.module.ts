import { Module } from "@nestjs/common";
import { AsistanSoruModule } from "../asistan-soru/asistan-soru.module";
import { SahaFisController, SahaUrunController } from "./saha.controller";

/** SAH-01…10: mobil saha ekranları (PWA) için uçlar. */
@Module({ imports: [AsistanSoruModule], controllers: [SahaUrunController, SahaFisController] })
export class SahaModule {}
