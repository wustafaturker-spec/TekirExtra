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
/**
 * STK-35: işlemin havuzdan bağlantı bekleyebileceği süre (Prisma varsayılanı
 * 2 sn). Yük altında kısa bekleyiş yerine kuyrukta beklenir; yine de dolarsa
 * hata filtresi 503 + Retry-After döner. Havuz boyutu `DATABASE_URL`
 * içindeki `connection_limit` ile ayarlanır (varsayılan çekirdek×2+1).
 */
const BAGLANTI_BEKLEME_MS = 10_000;

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
    }, { maxWait: BAGLANTI_BEKLEME_MS, ...(secenek?.timeout ? { timeout: secenek.timeout } : {}) });
  }
}
