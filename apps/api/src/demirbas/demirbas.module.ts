import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AmortismanService } from "./amortisman.service";
import { DemirbasController } from "./demirbas.controller";
import { DemirbasService } from "./demirbas.service";

/** DMR-01…14 (§3.20): demirbaş ve sabit kıymet. */
@Module({
  imports: [AuthModule],
  controllers: [DemirbasController],
  providers: [DemirbasService, AmortismanService],
  exports: [DemirbasService, AmortismanService],
})
export class DemirbasModule {}
