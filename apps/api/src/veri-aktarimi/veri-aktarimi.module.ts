import { Module } from "@nestjs/common";
import { CariModule } from "../cari/cari.module";
import { DonemKapatmaModule } from "../donem-kapatma/donem-kapatma.module";
import { KasaBankaModule } from "../kasa-banka/kasa-banka.module";
import { MevzuatModule } from "../mevzuat/mevzuat.module";
import { StokModule } from "../stok/stok.module";
import { TenantModule } from "../tenant/tenant.module";
import { VeriAktarimiController } from "./veri-aktarimi.controller";
import { VeriAktarimiService } from "./veri-aktarimi.service";
import { VeriAktarimiAiService } from "./veri-aktarimi-ai.service";

/** VAK-01…09, P-13: veri aktarım sihirbazı ve AI kolon önerisi. */
@Module({
  imports: [CariModule, StokModule, KasaBankaModule, DonemKapatmaModule, MevzuatModule, TenantModule],
  controllers: [VeriAktarimiController],
  providers: [VeriAktarimiService, VeriAktarimiAiService],
  exports: [VeriAktarimiService, VeriAktarimiAiService],
})
export class VeriAktarimiModule {}
