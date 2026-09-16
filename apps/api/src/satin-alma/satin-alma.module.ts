import { Module } from "@nestjs/common";
import { BelgelerModule } from "../belgeler/belgeler.module";
import { ButceModule } from "../butce/butce.module";
import { SatinAlmaController } from "./satin-alma.controller";
import { SatinAlmaService } from "./satin-alma.service";

/** Satın alma talep ve onay (SAT-01…SAT-08). */
@Module({ imports: [BelgelerModule, ButceModule], controllers: [SatinAlmaController], providers: [SatinAlmaService] })
export class SatinAlmaModule {}
