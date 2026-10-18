import { Module } from "@nestjs/common";
import { IsKutusuController } from "./is-kutusu.controller";
import { IsKutusuService } from "./is-kutusu.service";

@Module({ controllers: [IsKutusuController], providers: [IsKutusuService] })
export class IsKutusuModule {}
