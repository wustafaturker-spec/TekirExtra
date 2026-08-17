import { Module } from "@nestjs/common";
import { MasraflarController } from "./masraflar.controller";
import { MasraflarService } from "./masraflar.service";
import { KiraTahakkukZamanlayiciService } from "./kira-tahakkuk-zamanlayici.service";

@Module({ controllers: [MasraflarController], providers: [MasraflarService, KiraTahakkukZamanlayiciService] })
export class MasraflarModule {}
