import { Module } from "@nestjs/common";
import { AsistanSoruModule } from "../asistan-soru/asistan-soru.module";
import { BelgelerModule } from "../belgeler/belgeler.module";
import { CariModule } from "../cari/cari.module";
import { SahaFisController, SahaMalKabulController, SahaTahsilatController, SahaUrunController } from "./saha.controller";

/** SAH-01…10: mobil saha ekranları (PWA) için uçlar. */
@Module({ imports: [AsistanSoruModule, BelgelerModule, CariModule], controllers: [SahaUrunController, SahaFisController, SahaMalKabulController, SahaTahsilatController] })
export class SahaModule {}
