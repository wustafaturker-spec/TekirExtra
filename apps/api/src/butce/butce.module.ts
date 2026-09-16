import { Module } from "@nestjs/common";
import { ButceController } from "./butce.controller";
import { ButceService } from "./butce.service";

@Module({ controllers: [ButceController], providers: [ButceService], exports: [ButceService] })
export class ButceModule {}
