import { SelfServisController, SelfServisDavetController, SelfServisDavetPortalController } from "./self-servis.controller";
import { SelfServisService } from "./self-servis.service";
import { PersonelKuyrukService } from "./personel-kuyruk.service";
import { Module } from "@nestjs/common";
import { PersonelController } from "./personel.controller";
import { PersonelService } from "./personel.service";
import { IzinController } from "./izin.controller";
import { IzinService } from "./izin.service";
import { OrganizasyonController } from "./organizasyon.controller";
import { OrganizasyonService } from "./organizasyon.service";
import { EklerModule } from "../ekler/ekler.module";
import { DonemKapatmaModule } from "../donem-kapatma/donem-kapatma.module";
import { TenantModule } from "../tenant/tenant.module";
import { BordroPusulaController } from "./bordro-pusula.controller";
import { BordroPusulaService } from "./bordro-pusula.service";
import { PersonelBelgeController } from "./personel-belge.controller";
import { PersonelBelgeService } from "./personel-belge.service";
import { PersonelRaporController } from "./personel-rapor.controller";
import { PersonelRaporService } from "./personel-rapor.service";
import { MevzuatController } from "./mevzuat.controller";
import { MevzuatService } from "./mevzuat.service";
import { SgkController } from "./sgk.controller";
import { SgkService } from "./sgk.service";

@Module({
  imports: [EklerModule, DonemKapatmaModule, TenantModule],
  controllers: [SelfServisController, SelfServisDavetController, SelfServisDavetPortalController, BordroPusulaController, IzinController, OrganizasyonController, PersonelBelgeController, PersonelRaporController, MevzuatController, SgkController, PersonelController],
  providers: [SelfServisService, BordroPusulaService, PersonelService, PersonelKuyrukService, IzinService, OrganizasyonService, PersonelBelgeService, PersonelRaporService, MevzuatService, SgkService],
  exports: [PersonelService],
})
export class PersonelModule {}
