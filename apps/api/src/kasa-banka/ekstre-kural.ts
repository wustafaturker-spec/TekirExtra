/**
 * KSB-06: ekstre eşleme kuralları — "açıklamada X geçen giriş/çıkış → şununla
 * eşleştir". Kural yalnız öneri üretir; satır kullanıcı onayıyla işlenir.
 *
 * Karşılaştırma ekstre okuyucusunun normaliyle yapılır (aksansız, büyük harf,
 * tek boşluk): bankalar açıklamayı aksansız yazıyor, kullanıcı aksanlı yazabilir.
 */
import type { EkstreEslesmeTuru, EkstreKuralYonu, Prisma } from "@prisma/client";
import { metniNormalle } from "./ekstre-oku";

export interface KuralKaydi {
  id: string;
  bankaHesapId: string | null;
  anahtar: string;
  yon: EkstreKuralYonu;
  eslesmeTuru: EkstreEslesmeTuru;
  cariId: string | null;
  masrafKategoriId: string | null;
  gelirKategoriId: string | null;
  hedefKasaId: string | null;
  hedefBankaHesapId: string | null;
}

/** Aksansız, küçük harf; noktalama boşluğa iner ("EFT-ÜCRETİ/REF" → "eft ucreti ref"). */
export const kuralAnahtari = (metin: string) => metniNormalle(metin).replace(/[^a-z0-9]+/g, " ").trim();

export function satirYonu(tutar: Prisma.Decimal): EkstreKuralYonu {
  return tutar.isNegative() ? "cikis" : "giris";
}

/**
 * Satıra uyan ilk kural. Önce bu hesaba özel kurallar, sonra bütün hesaplarda
 * geçerli olanlar; aynı düzeyde en uzun anahtar (en belirgin kural) kazanır.
 */
export function kuralBul<T extends KuralKaydi>(
  kurallar: T[],
  satir: { bankaHesapId: string; tutar: Prisma.Decimal; aciklama: string; karsiUnvan: string | null },
): T | null {
  const metin = kuralAnahtari(`${satir.aciklama} ${satir.karsiUnvan ?? ""}`);
  const yon = satirYonu(satir.tutar);
  const uyanlar = kurallar.filter((k) =>
    k.yon === yon
    && (k.bankaHesapId === null || k.bankaHesapId === satir.bankaHesapId)
    && k.anahtar.length > 0
    && metin.includes(k.anahtar),
  );
  uyanlar.sort((a, b) =>
    Number(b.bankaHesapId !== null) - Number(a.bankaHesapId !== null) || b.anahtar.length - a.anahtar.length,
  );
  return uyanlar[0] ?? null;
}
