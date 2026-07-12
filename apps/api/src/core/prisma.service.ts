import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Kiracı bağlamlı Prisma erişimi (MIMARI §3).
 *
 * Kiracıya ait tablolara HER erişim tenantIslem() üzerinden yapılmalıdır:
 * transaction başında `SET LOCAL app.tenant_id` kurulur, RLS politikaları
 * satırları bu değere göre süzer. Bağlam kurulmadan yapılan sorgular
 * (politika gereği) hiç satır döndürmez — sessiz veri sızıntısı yerine
 * sessiz boş sonuç tercih edilmiştir; uygulama DB rolünde BYPASSRLS yoktur.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async tenantIslem<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }
}
