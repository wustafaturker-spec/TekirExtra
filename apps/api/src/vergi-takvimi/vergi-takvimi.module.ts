import { Module } from "@nestjs/common";
import { VergiTakvimiController } from "./vergi-takvimi.controller";
import { VergiTakvimiService } from "./vergi-takvimi.service";

@Module({ controllers: [VergiTakvimiController], providers: [VergiTakvimiService] })
export class VergiTakvimiModule {}
