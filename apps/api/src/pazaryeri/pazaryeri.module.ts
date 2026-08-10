import { Module } from "@nestjs/common";
import { PazaryeriController } from "./pazaryeri.controller";
import { PazaryeriService } from "./pazaryeri.service";
@Module({ controllers: [PazaryeriController], providers: [PazaryeriService] })
export class PazaryeriModule {}
