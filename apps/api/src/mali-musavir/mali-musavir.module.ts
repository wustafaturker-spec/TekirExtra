import { Module } from "@nestjs/common";
import { MaliMusavirController } from "./mali-musavir.controller";
import { MaliMusavirService } from "./mali-musavir.service";
import { MuhasebeAktarimController } from "./muhasebe/muhasebe-aktarim.controller";
import { MuhasebeAktarimService } from "./muhasebe/muhasebe-aktarim.service";

@Module({
  controllers: [MaliMusavirController, MuhasebeAktarimController],
  providers: [MaliMusavirService, MuhasebeAktarimService],
  exports: [MaliMusavirService],
})
export class MaliMusavirModule {}
