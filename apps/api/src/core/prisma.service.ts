import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { baglamAl } from "./istek-baglami";

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
    /** Uzun okumalar (ör. muhasebe aktarımı) için; varsayılan Prisma'nın 5 sn'si. */
    secenek?: { timeout?: number },
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      // EBLG-35: durum geçmişi tetikleyicisi değiştiren kullanıcıyı `app.user_id`'den okur.
      const kullanici = baglamAl()?.userId ?? "";
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${kullanici}, true)`;
      return fn(tx);
    }, secenek?.timeout ? { timeout: secenek.timeout, maxWait: 10_000 } : undefined);
  }
}
