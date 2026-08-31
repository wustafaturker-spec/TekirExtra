import { Module } from "@nestjs/common";
import { DuzeltmelerController } from "./duzeltmeler.controller";
import { DuzeltmelerService } from "./duzeltmeler.service";

@Module({ controllers: [DuzeltmelerController], providers: [DuzeltmelerService], exports: [DuzeltmelerService] })
export class DuzeltmelerModule {}
