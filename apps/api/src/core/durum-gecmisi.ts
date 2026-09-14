import type { Prisma } from "@prisma/client";

/**
 * EBLG-35: belge durum geçmişini okur. Satırları veritabanı tetikleyicisi
 * yazar; burada yalnız değiştiren kullanıcının adı eklenir.
 */

/** Worker ve zamanlanmış işlerin kimlik bağlamındaki kullanıcı. */
const SISTEM_KULLANICISI = "00000000-0000-0000-0000-000000000000";

export interface DurumGecmisiSatiri {
  id: string;
  eksen: string;
  eskiDurum: string | null;
  yeniDurum: string;
  aciklama: string | null;
  /** Kullanıcı adı, "Sistem (otomatik)" ya da bilinmiyorsa null. */
  kullanici: string | null;
  baslangic: boolean;
  zaman: string;
}

export async function durumGecmisiOku(
  tx: Prisma.TransactionClient,
  kosul: Prisma.BelgeDurumGecmisiWhereInput,
): Promise<DurumGecmisiSatiri[]> {
  const kayitlar = await tx.belgeDurumGecmisi.findMany({
    where: kosul,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });
  const kullaniciIdleri = [...new Set(kayitlar.map((k) => k.userId).filter((id): id is string => Boolean(id) && id !== SISTEM_KULLANICISI))];
  const kullanicilar = kullaniciIdleri.length
    ? await tx.user.findMany({ where: { id: { in: kullaniciIdleri } }, select: { id: true, adSoyad: true } })
    : [];
  const adlar = new Map(kullanicilar.map((k) => [k.id, k.adSoyad]));

  return kayitlar.map((k) => ({
    id: k.id,
    eksen: k.eksen,
    eskiDurum: k.eskiDurum,
    yeniDurum: k.yeniDurum,
    aciklama: k.aciklama,
    kullanici: !k.userId ? null : k.userId === SISTEM_KULLANICISI ? "Sistem (otomatik)" : (adlar.get(k.userId) ?? null),
    baslangic: k.baslangic,
    zaman: k.createdAt.toISOString(),
  }));
}
