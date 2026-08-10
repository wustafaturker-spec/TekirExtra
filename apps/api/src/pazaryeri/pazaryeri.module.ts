import { Module } from "@nestjs/common";
import { PazaryeriController } from "./pazaryeri.controller";
import { PazaryeriService } from "./pazaryeri.service";
import { FaturaModule } from "../fatura/fatura.module";
@Module({ imports: [FaturaModule], controllers: [PazaryeriController], providers: [PazaryeriService] })
export class PazaryeriModule {}
