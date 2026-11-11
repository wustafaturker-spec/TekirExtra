import { Module } from "@nestjs/common";
import { CariModule } from "../cari/cari.module";
import { DonemKapatmaModule } from "../donem-kapatma/donem-kapatma.module";
import { KasaBankaModule } from "../kasa-banka/kasa-banka.module";
import { MevzuatModule } from "../mevzuat/mevzuat.module";
import { StokModule } from "../stok/stok.module";
import { TenantModule } from "../tenant/tenant.module";
import { VeriAktarimiController } from "./veri-aktarimi.controller";
import { VeriAktarimiService } from "./veri-aktarimi.service";

/** VAK-01…09: veri aktarım sihirbazı. */
@Module({
  imports: [CariModule, StokModule, KasaBankaModule, DonemKapatmaModule, MevzuatModule, TenantModule],
  controllers: [VeriAktarimiController],
  providers: [VeriAktarimiService],
})
export class VeriAktarimiModule {}
