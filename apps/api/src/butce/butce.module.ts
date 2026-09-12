import { Module } from "@nestjs/common";
import { ButceController } from "./butce.controller";
import { ButceService } from "./butce.service";

@Module({ controllers: [ButceController], providers: [ButceService] })
export class ButceModule {}
