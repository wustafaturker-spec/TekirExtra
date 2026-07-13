import { Global, Module } from "@nestjs/common";
import { AyarlarController } from "./ayarlar/ayarlar.controller";
import { AyarlarService } from "./ayarlar/ayarlar.service";
import { PdfService } from "./pdf/pdf.service";
import { PrismaService } from "./prisma.service";
import { RaporlarController } from "./raporlar/raporlar.controller";
import { RaporlarService } from "./raporlar/raporlar.service";

@Global()
@Module({
  controllers: [AyarlarController, RaporlarController],
  providers: [PrismaService, AyarlarService, RaporlarService, PdfService],
  exports: [PrismaService, AyarlarService, RaporlarService, PdfService],
})
export class CoreModule {}
