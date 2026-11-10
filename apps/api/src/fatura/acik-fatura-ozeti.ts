import { Prisma } from "@prisma/client";

/**
 * Kesin faturaların açık kalanı veritabanında toplanır; ana sayfa özetleri firmanın bütün
 * faturalarını ve kapamalarını belleğe almasın. Kural `faturaOdemeDurumu` ile aynıdır: kalan,
 * bu faturayı kapatanlar ve (iade faturasıysa) onun kapattığı tutarlar düşülerek bulunur,
 * eksiye inmez; TL karşılığı fatura başına kuruşa yuvarlanıp toplanır.
 */
export interface AcikFaturaToplami { adet: number; kalanTry: Prisma.Decimal }

export async function acikFaturaOzeti(tx: Prisma.TransactionClient, tenantId: string, tipler: string[]): Promise<Map<string, AcikFaturaToplami>> {
  const satirlar = await tx.$queryRaw<{ tip: string; adet: number; kalan_try: string }[]>`
    WITH k AS (
      SELECT f.tip::text AS tip, f.kur,
        GREATEST(f.genel_toplam - COALESCE(o.toplam, 0) - COALESCE(i.toplam, 0), 0) AS kalan
      FROM faturalar f
      LEFT JOIN (SELECT fatura_id, sum(tutar) AS toplam FROM fatura_kapamalari WHERE tenant_id = ${tenantId}::uuid GROUP BY fatura_id) o ON o.fatura_id = f.id
      LEFT JOIN (SELECT iade_fatura_id, sum(tutar) AS toplam FROM fatura_kapamalari WHERE tenant_id = ${tenantId}::uuid AND iade_fatura_id IS NOT NULL GROUP BY iade_fatura_id) i ON i.iade_fatura_id = f.id
      WHERE f.tenant_id = ${tenantId}::uuid AND f.durum = 'kesin' AND f.tip::text = ANY(${tipler}::text[])
    )
    SELECT tip, (count(*) FILTER (WHERE kalan > 0))::int AS adet, COALESCE(sum(round(kalan * kur, 2)), 0)::text AS kalan_try
    FROM k GROUP BY tip`;
  return new Map(satirlar.map((s) => [s.tip, { adet: s.adet, kalanTry: new Prisma.Decimal(s.kalan_try) }]));
}
