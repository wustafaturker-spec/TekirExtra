import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { BelgelerModule } from "../belgeler/belgeler.module";
import { IsKutusuKapanisService } from "./is-kutusu-kapanis.service";
import { IsKutusuController } from "./is-kutusu.controller";
import { IsKutusuService } from "./is-kutusu.service";

@Module({ imports: [AiModule, BelgelerModule], controllers: [IsKutusuController], providers: [IsKutusuService, IsKutusuKapanisService] })
export class IsKutusuModule {}
