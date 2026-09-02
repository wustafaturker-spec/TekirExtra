import { Module } from "@nestjs/common";
import { DuzeltmelerController } from "./duzeltmeler.controller";
import { DuzeltmelerService } from "./duzeltmeler.service";
import { DuzeltmeTaramaZamanlayiciService } from "./duzeltme-tarama-zamanlayici.service";

@Module({ controllers: [DuzeltmelerController], providers: [DuzeltmelerService, DuzeltmeTaramaZamanlayiciService], exports: [DuzeltmelerService] })
export class DuzeltmelerModule {}
