/**
 * STK-37: geçmiş tarih itibarıyla envanter. Miktar o güne kadarki hareketlerin
 * toplamı; ortalama maliyet hareketlerin KAYITLI maliyetleriyle maliyet
 * çekirdeği (STK-28) yeniden oynatılarak bulunur. Maliyetler yeniden yazılmaz;
 * eski kayıtlar düzeltilmek isteniyorsa önce "maliyeti yeniden hesapla" çalışır.
 */
import { Prisma } from "@prisma/client";
import { maliyetleriYenidenHesapla, type YenidenHareket } from "./maliyet";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Ters yönlü çıkışı alış maliyetiyle ortalamadan düşen fatura tersleri (STK-27). */
const FATURA_TERSLERI = ["fatura_iptal", "fatura_geri_alma"];

export interface EnvanterHareketi {
  id: string;
  stokId: string;
  depoId: string;
  miktar: Prisma.Decimal;
  maliyet: Prisma.Decimal;
  kaynakTur: string;
  kaynakRef: string | null;
}

export interface TarihliBakiye {
  /** Firma geneli miktar (ortalamanın hesaplandığı tabaka). */
  miktar: Prisma.Decimal;
  depoMiktarlari: Map<string, Prisma.Decimal>;
  ortalama: Prisma.Decimal;
}

/**
 * Kart başına tarih sırasıyla verilmiş hareketlerden bakiye ve ortalama.
 * `alisIadeleri`: tipi alış iadesi olan faturaların kimlikleri — çıkışları
 * canlıda olduğu gibi alış maliyetiyle ortalamadan düşer.
 */
export function tarihliBakiyeler(hareketler: EnvanterHareketi[], alisIadeleri: Set<string>): Map<string, TarihliBakiye> {
  const kartlar = new Map<string, EnvanterHareketi[]>();
  for (const h of hareketler) {
    const liste = kartlar.get(h.stokId);
    if (liste) liste.push(h);
    else kartlar.set(h.stokId, [h]);
  }
  const sonuc = new Map<string, TarihliBakiye>();
  for (const [stokId, liste] of kartlar) {
    const depoMiktarlari = new Map<string, Prisma.Decimal>();
    let miktar = D(0);
    const girdi: YenidenHareket[] = liste.map((h) => {
      miktar = miktar.add(h.miktar);
      depoMiktarlari.set(h.depoId, (depoMiktarlari.get(h.depoId) ?? D(0)).add(h.miktar));
      const giris = h.miktar.gt(0);
      const maliyetliCikis = !giris && Boolean(h.kaynakRef) && (
        FATURA_TERSLERI.includes(h.kaynakTur) || (h.kaynakTur === "fatura" && alisIadeleri.has(h.kaynakRef!))
      );
      return { id: h.id, miktar: h.miktar, maliyet: h.maliyet, giris, maliyetliCikis, sabit: true, kural: { tur: "kayitli" } };
    });
    sonuc.set(stokId, { miktar, depoMiktarlari, ortalama: maliyetleriYenidenHesapla(girdi).ortalama });
  }
  return sonuc;
}
