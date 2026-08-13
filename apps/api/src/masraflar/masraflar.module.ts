import { Module } from "@nestjs/common";
import { MasraflarController } from "./masraflar.controller";
import { MasraflarService } from "./masraflar.service";

@Module({ controllers: [MasraflarController], providers: [MasraflarService] })
export class MasraflarModule {}
