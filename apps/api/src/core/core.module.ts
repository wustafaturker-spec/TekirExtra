import { Global, Module } from "@nestjs/common";
import { AyarlarController } from "./ayarlar/ayarlar.controller";
import { AyarlarService } from "./ayarlar/ayarlar.service";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  controllers: [AyarlarController],
  providers: [PrismaService, AyarlarService],
  exports: [PrismaService, AyarlarService],
})
export class CoreModule {}
