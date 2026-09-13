import { Module } from "@nestjs/common";
import { DovizController } from "./doviz.controller";
import { DovizZamanlayiciService } from "./doviz-zamanlayici.service";
import { DovizService } from "./doviz.service";

@Module({ controllers: [DovizController], providers: [DovizService, DovizZamanlayiciService], exports: [DovizService] })
export class DovizModule {}
