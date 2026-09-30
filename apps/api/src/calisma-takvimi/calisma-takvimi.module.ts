import { Module } from "@nestjs/common";
import { CalismaTakvimiController } from "./calisma-takvimi.controller";
import { CalismaTakvimiService } from "./calisma-takvimi.service";

@Module({ controllers: [CalismaTakvimiController], providers: [CalismaTakvimiService], exports: [CalismaTakvimiService] })
export class CalismaTakvimiModule {}
