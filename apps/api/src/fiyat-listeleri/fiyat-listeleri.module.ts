import { Module } from "@nestjs/common";
import { FiyatListeleriController } from "./fiyat-listeleri.controller";
import { FiyatListeleriService } from "./fiyat-listeleri.service";

@Module({
  controllers: [FiyatListeleriController],
  providers: [FiyatListeleriService],
  exports: [FiyatListeleriService],
})
export class FiyatListeleriModule {}
