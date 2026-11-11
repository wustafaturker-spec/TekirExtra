import { Global, Module } from "@nestjs/common";
import { BildirimlerModule } from "../bildirimler/bildirimler.module";
import { OnayController, OnayKuraliController } from "./onay.controller";
import { OnayService } from "./onay.service";

/** ONY-01…10: genel onay akışları; işlem servisleri kapı ve yürütücü için kullanır. */
@Global()
@Module({ imports: [BildirimlerModule], controllers: [OnayController, OnayKuraliController], providers: [OnayService], exports: [OnayService] })
export class OnayModule {}
