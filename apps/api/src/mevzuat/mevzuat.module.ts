import { Global, Module } from "@nestjs/common";
import { MevzuatController } from "./mevzuat.controller";
import { MevzuatService } from "./mevzuat.service";
import { PlatformAuthController, PlatformMevzuatController } from "./platform.controller";
import { PlatformAuthService } from "./platform-auth.service";
import { PlatformMevzuatService } from "./platform-mevzuat.service";
import { PlatformPrismaService } from "./platform-prisma.service";

/**
 * Mevzuat Merkezi (MVZ). `MevzuatService` diğer modüllerin (fatura, e-belge,
 * bordro) yürürlükteki değeri okuduğu kapıdır; platform servisleri yalnız
 * platform uçlarında kullanılır.
 */
@Global()
@Module({
  controllers: [MevzuatController, PlatformAuthController, PlatformMevzuatController],
  providers: [MevzuatService, PlatformPrismaService, PlatformAuthService, PlatformMevzuatService],
  exports: [MevzuatService],
})
export class MevzuatModule {}
