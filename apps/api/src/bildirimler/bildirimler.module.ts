import { Module, forwardRef } from "@nestjs/common";
import { RaporModule } from "../rapor/rapor.module";
import { TenantModule } from "../tenant/tenant.module";
import { BildirimEpostaService } from "./bildirim-eposta.service";
import { BildirimService } from "./bildirim.service";
import { BildirimUreticiService } from "./bildirim-uretici.service";
import { BildirimZamanlayiciService } from "./bildirim-zamanlayici.service";
import { BildirimlerController } from "./bildirimler.controller";

@Module({
  imports: [RaporModule, forwardRef(() => TenantModule)],
  controllers: [BildirimlerController],
  providers: [BildirimService, BildirimUreticiService, BildirimEpostaService, BildirimZamanlayiciService],
  exports: [BildirimService, BildirimUreticiService],
})
export class BildirimlerModule {}
