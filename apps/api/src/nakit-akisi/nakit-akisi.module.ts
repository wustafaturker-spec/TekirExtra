import { Module } from "@nestjs/common";
import { DovizModule } from "../doviz/doviz.module";
import { NakitAkisiController } from "./nakit-akisi.controller";
import { NakitAkisiService } from "./nakit-akisi.service";

@Module({ imports: [DovizModule], controllers: [NakitAkisiController], providers: [NakitAkisiService] })
export class NakitAkisiModule {}
