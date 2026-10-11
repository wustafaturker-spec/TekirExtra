import { Module } from "@nestjs/common";
import { TenantModule } from "../tenant/tenant.module";
import { RaporAbonelikController } from "./rapor-abonelik.controller";
import { RaporAbonelikService } from "./rapor-abonelik.service";
import { RaporAbonelikZamanlayiciService } from "./rapor-abonelik-zamanlayici.service";

/** RPR-24: zamanlanmış rapor e-postası. */
@Module({
  imports: [TenantModule],
  controllers: [RaporAbonelikController],
  providers: [RaporAbonelikService, RaporAbonelikZamanlayiciService],
})
export class RaporAbonelikModule {}
