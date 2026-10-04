import { Module } from "@nestjs/common";
import { PersonelController } from "./personel.controller";
import { PersonelService } from "./personel.service";
import { IzinController } from "./izin.controller";
import { IzinService } from "./izin.service";
import { OrganizasyonController } from "./organizasyon.controller";
import { OrganizasyonService } from "./organizasyon.service";
import { EklerModule } from "../ekler/ekler.module";
import { DonemKapatmaModule } from "../donem-kapatma/donem-kapatma.module";
import { PersonelBelgeController } from "./personel-belge.controller";
import { PersonelBelgeService } from "./personel-belge.service";
import { PersonelRaporController } from "./personel-rapor.controller";
import { PersonelRaporService } from "./personel-rapor.service";
import { MevzuatController } from "./mevzuat.controller";
import { MevzuatService } from "./mevzuat.service";

@Module({
  imports: [EklerModule, DonemKapatmaModule],
  controllers: [IzinController, OrganizasyonController, PersonelBelgeController, PersonelRaporController, MevzuatController, PersonelController],
  providers: [PersonelService, IzinService, OrganizasyonService, PersonelBelgeService, PersonelRaporService, MevzuatService],
  exports: [PersonelService],
})
export class PersonelModule {}
