import { Module } from "@nestjs/common";
import { FiyatListeleriController } from "./fiyat-listeleri.controller";
import { FiyatListeleriService } from "./fiyat-listeleri.service";
import { OnayModule } from "../onay/onay.module";

@Module({
  imports: [OnayModule],
  controllers: [FiyatListeleriController],
  providers: [FiyatListeleriService],
  exports: [FiyatListeleriService],
})
export class FiyatListeleriModule {}
