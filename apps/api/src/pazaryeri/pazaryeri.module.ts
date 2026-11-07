import { Module } from "@nestjs/common";
import { PazaryeriController } from "./pazaryeri.controller";
import { PazaryeriService } from "./pazaryeri.service";
import { PazaryeriEslestirmeService } from "./pazaryeri-eslestirme.service";
import { PazaryeriHakedisService } from "./pazaryeri-hakedis.service";
import { FaturaModule } from "../fatura/fatura.module";
import { DonemKapatmaModule } from "../donem-kapatma/donem-kapatma.module";
@Module({ imports: [FaturaModule, DonemKapatmaModule], controllers: [PazaryeriController], providers: [PazaryeriService, PazaryeriEslestirmeService, PazaryeriHakedisService] })
export class PazaryeriModule {}
