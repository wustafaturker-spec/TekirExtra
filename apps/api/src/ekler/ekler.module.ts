import { Module } from "@nestjs/common";
import { DepoService } from "./depo.service";
import { EklerController } from "./ekler.controller";
import { EklerService } from "./ekler.service";

/** Belge/dosya ekleri ortak altyapısı (4. aşama S-01, MinIO depolama). */
@Module({
  controllers: [EklerController],
  providers: [EklerService, DepoService],
  exports: [EklerService],
})
export class EklerModule {}
