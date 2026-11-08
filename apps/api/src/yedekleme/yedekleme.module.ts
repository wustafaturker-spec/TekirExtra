import { Module } from "@nestjs/common";
import { GirisDenemeSayaci } from "../auth/giris-deneme-sayaci";
import { YedeklemeController } from "./yedekleme.controller";
import { YedeklemeService } from "./yedekleme.service";

/** PLT-109…117: yedek talebi, ekran ve planlayıcı. */
@Module({ controllers: [YedeklemeController], providers: [YedeklemeService, GirisDenemeSayaci], exports: [YedeklemeService] })
export class YedeklemeModule {}
