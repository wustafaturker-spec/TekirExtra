import { Module } from "@nestjs/common";
import { DovizController } from "./doviz.controller";
import { DovizService } from "./doviz.service";

@Module({ controllers: [DovizController], providers: [DovizService], exports: [DovizService] })
export class DovizModule {}
