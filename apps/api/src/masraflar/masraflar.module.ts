import { Module } from "@nestjs/common";
import { BildirimlerModule } from "../bildirimler/bildirimler.module";
import { DovizModule } from "../doviz/doviz.module";
import { MasraflarController } from "./masraflar.controller";
import { MasraflarService } from "./masraflar.service";
import { KiraTahakkukZamanlayiciService } from "./kira-tahakkuk-zamanlayici.service";

@Module({ imports: [DovizModule, BildirimlerModule], controllers: [MasraflarController], providers: [MasraflarService, KiraTahakkukZamanlayiciService] })
export class MasraflarModule {}
