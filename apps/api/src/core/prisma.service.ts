import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { baglamAl } from "./istek-baglami";
import { degisimDenetlenmeli, degisimKaydet } from "./degisim-izi";

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
    /** Süre varsayılanı 5 sn; tutarlı çok sorgulu okumalar ayrıca snapshot izolasyonu seçebilir. */
    secenek?: { timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T> {
    let yazdi = false;
    const sonuc = await this.$transaction(async (tx) => {
      // PLT-10: destek oturumu hiçbir şey yazamaz; ilk komut olmalıdır.
      if (baglamAl()?.destek) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      // EBLG-35: durum geçmişi tetikleyicisi değiştiren kullanıcıyı `app.user_id`'den okur.
      const kullanici = baglamAl()?.userId ?? "";
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${kullanici}, true)`;
      const deger = await fn(tx);
      // BLD-14: işlem kimliği yalnız ilk yazmada atanır; okuma işleminde boş kalır.
      if (degisimDenetlenmeli(tenantId)) {
        const [satir] = await tx.$queryRaw<{ yazdi: boolean }[]>`SELECT pg_current_xact_id_if_assigned() IS NOT NULL AS yazdi`;
        yazdi = !!satir?.yazdi;
      }
      return deger;
    }, { maxWait: BAGLANTI_BEKLEME_MS, ...(secenek?.timeout ? { timeout: secenek.timeout } : {}), ...(secenek?.isolationLevel ? { isolationLevel: secenek.isolationLevel } : {}) });
    // İz işlem kesinleştikten sonra bırakılır; tarama izi görünce veriyi de görür.
    if (yazdi) degisimKaydet(tenantId);
    return sonuc;
  }
}
