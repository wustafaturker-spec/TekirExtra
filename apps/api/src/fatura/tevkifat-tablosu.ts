import type { Prisma } from "@prisma/client";
import { senaryoHatalari, TEVKIFAT_KODLARI, tevkifatTablosuCoz, type TevkifatDegisikligi, type TevkifatKodu } from "@tekirextra/shared";
import type { AyarlarService } from "../core/ayarlar/ayarlar.service";

/**
 * FTR-35: kiracının tevkifat tablosu (varsayılan + Ayarlar > Tevkifat
 * değişiklikleri). Ayar servisi verilmemişse (birim testleri) varsayılan.
 */
export async function firmaTevkifatTablosu(ayarlar: AyarlarService | undefined, tx?: Prisma.TransactionClient): Promise<TevkifatKodu[]> {
  if (!ayarlar) return [...TEVKIFAT_KODLARI];
  const ayar = await ayarlar.getir("tevkifat", tx);
  return tevkifatTablosuCoz((ayar.degisiklikler ?? []) as TevkifatDegisikligi[]);
}

/**
 * Şema tevkifat kodunu kiracının tablosunu bilmeden doğrulayamaz; kod ve oran
 * kuralı burada kiracının tablosuyla uygulanır. Gelen belgeden oluşan faturada
 * pasif kod da kabul edilir (belge karşı tarafındır).
 */
export function tevkifatKurallariniUygula(
  satirlar: { kdvOrani?: string | number | null; tevkifatKodu?: string | null; tevkifatOrani?: string | null }[],
  tablo: readonly TevkifatKodu[],
  pasifKodKabul = false,
): string[] {
  return senaryoHatalari(
    satirlar.map((s) => ({ kdvOrani: Number(s.kdvOrani ?? 0), tevkifatKodu: s.tevkifatKodu, tevkifatOrani: s.tevkifatOrani, gibIstisnaKodu: "351" })),
    true,
    { tevkifatTablosu: tablo, pasifKodKabul },
  )
    .filter((h) => h.alan === "tevkifatKodu" || h.alan === "tevkifatOrani")
    .map((h) => `${h.satirIndeksi + 1}. satır: ${h.mesaj}`);
}
