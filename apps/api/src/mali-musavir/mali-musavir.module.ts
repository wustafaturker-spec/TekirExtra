import { Module } from "@nestjs/common";
import { MaliMusavirController } from "./mali-musavir.controller";
import { MaliMusavirService } from "./mali-musavir.service";

@Module({
  controllers: [MaliMusavirController],
  providers: [MaliMusavirService],
  exports: [MaliMusavirService],
})
export class MaliMusavirModule {}
