import { Injectable, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * MVZ-16: Mevzuat Merkezi'nin yazma bağlantısı. `tekir_platform` rolüyle
 * bağlanır; bu rolün yalnız mevzuat tablolarında yetkisi vardır, kiracı
 * tablolarına erişemez. Uygulama bağlantısı (`tekir_app`) mevzuat tablolarını
 * yalnız okur. Adres tanımlı değilse platform işlemleri kapalıdır — uygulama
 * bağlantısına düşülmez.
 */
@Injectable()
export class PlatformPrismaService implements OnModuleDestroy {
  private istemci: PrismaClient | null = null;

  get db(): PrismaClient {
    const adres = process.env.DATABASE_URL_PLATFORM;
    if (!adres) throw new ServiceUnavailableException("Platform veritabanı bağlantısı (DATABASE_URL_PLATFORM) tanımlı değil");
    this.istemci ??= new PrismaClient({ datasourceUrl: adres });
    return this.istemci;
  }

  async onModuleDestroy(): Promise<void> {
    await this.istemci?.$disconnect();
  }
}
