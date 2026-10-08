/**
 * STK-08 / STK-25…28: ağırlıklı ortalama maliyet çekirdeği. Canlı hareket
 * (`StokService.hareketEkle`) ve maliyeti yeniden hesaplama aynı kuralları
 * kullanır; ikisi farklı sonuç üretmesin.
 */
import { Prisma } from "@prisma/client";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const SIFIR = D(0);

/** STK-25: satır matrahı (iskontolar düşülmüş) × kur ÷ ana birim miktarı. */
export function alisBirimMaliyeti(matrah: Prisma.Decimal.Value, kur: Prisma.Decimal.Value, anaBirimMiktari: Prisma.Decimal.Value): Prisma.Decimal {
  const miktar = D(anaBirimMiktari);
  return miktar.gt(0) ? D(matrah).mul(D(kur)).div(miktar).toDecimalPlaces(4) : SIFIR;
}

/** Giriş sonrası ortalama: eski stok eksi/sıfırsa giren maliyet; yeni miktar ≤ 0 ise ortalama korunur. */
export function girisOrtalamasi(mevcut: Prisma.Decimal.Value, ortalama: Prisma.Decimal.Value, miktar: Prisma.Decimal.Value, maliyet: Prisma.Decimal.Value): Prisma.Decimal {
  const eski = D(mevcut), yeni = eski.add(D(miktar));
  if (!yeni.gt(0)) return D(ortalama);
  if (!eski.gt(0)) return D(maliyet);
  return eski.mul(D(ortalama)).add(D(miktar).mul(D(maliyet))).div(yeni).toDecimalPlaces(4);
}

/**
 * STK-27: alış maliyetiyle yapılan çıkış ortalamadan düşer. Kalan ≤ 0 ya da
 * sonuç eksi ise ortalama korunur (stok eksiye düşerken anlamlı değer yok).
 */
export function maliyetliCikisOrtalamasi(mevcut: Prisma.Decimal.Value, ortalama: Prisma.Decimal.Value, miktar: Prisma.Decimal.Value, maliyet: Prisma.Decimal.Value): Prisma.Decimal {
  const eski = D(mevcut), kalan = eski.sub(D(miktar));
  if (!kalan.gt(0) || !eski.gt(0)) return D(ortalama);
  const yeni = eski.mul(D(ortalama)).sub(D(miktar).mul(D(maliyet))).div(kalan).toDecimalPlaces(4);
  return yeni.lt(0) ? D(ortalama) : yeni;
}

/** Miktar ağırlıklı ortalama maliyet (işaretten bağımsız); boşsa null. */
export function agirlikliMaliyet(kalemler: { miktar: Prisma.Decimal.Value; maliyet: Prisma.Decimal.Value }[]): Prisma.Decimal | null {
  let miktar = SIFIR, deger = SIFIR;
  for (const k of kalemler) { const m = D(k.miktar).abs(); miktar = miktar.add(m); deger = deger.add(m.mul(D(k.maliyet))); }
  return miktar.gt(0) ? deger.div(miktar).toDecimalPlaces(4) : null;
}

/** Yeniden hesaplamada bir hareketin maliyetinin nereden geldiği (STK-28). */
export type MaliyetKurali =
  | { tur: "kayitli" }                     // elle giriş, açılış, sayım, üretim girişi: olduğu gibi
  | { tur: "ortalama" }                    // çıkışlar ve kaynağı olmayan iade/transfer girişi: o anki ortalama
  | { tur: "sayim" }                       // sayım düzeltmesi: stok pozitifse o anki ortalama, değilse kayıtlı (kartın alış fiyatı)
  | { tur: "sabit"; maliyet: Prisma.Decimal } // alış girişi (faturadan), alış iadesi çıkışı
  | { tur: "kaynak"; hareketIdleri: string[] }; // satış iadesi, iptal tersleri: kaynak hareketlerin YENİ maliyeti

export interface YenidenHareket {
  id: string; miktar: Prisma.Decimal; maliyet: Prisma.Decimal; giris: boolean;
  /** Çıkış alış maliyetiyle yapılır ve ortalamadan düşer (STK-27). */
  maliyetliCikis: boolean;
  /** Kapalı dönem: maliyet değişmez, ortalamaya kayıtlı maliyetle girer. */
  sabit: boolean;
  kural: MaliyetKurali;
}

/**
 * Hareketleri sırayla işleyip yeni maliyetleri ve son ortalamayı döner.
 * `miktar` işaretlidir (çıkış eksi); sayım düzeltmesi işaretten giriş/çıkış sayılır.
 */
export function maliyetleriYenidenHesapla(hareketler: YenidenHareket[]): { maliyetler: Map<string, Prisma.Decimal>; ortalama: Prisma.Decimal } {
  const maliyetler = new Map<string, Prisma.Decimal>();
  const miktarlar = new Map(hareketler.map((h) => [h.id, h.miktar]));
  let mevcut = SIFIR, ortalama = SIFIR;
  for (const h of hareketler) {
    const miktar = h.miktar.abs();
    let maliyet: Prisma.Decimal;
    if (h.sabit || h.kural.tur === "kayitli") maliyet = h.maliyet;
    else if (h.kural.tur === "sabit") maliyet = h.kural.maliyet;
    else if (h.kural.tur === "sayim") maliyet = mevcut.gt(0) ? ortalama : h.maliyet;
    else if (h.kural.tur === "kaynak") maliyet = agirlikliMaliyet(h.kural.hareketIdleri.flatMap((id) => (maliyetler.has(id) ? [{ miktar: miktarlar.get(id)!, maliyet: maliyetler.get(id)! }] : []))) ?? ortalama;
    else maliyet = ortalama;
    if (h.giris) ortalama = girisOrtalamasi(mevcut, ortalama, miktar, maliyet);
    else if (h.maliyetliCikis) ortalama = maliyetliCikisOrtalamasi(mevcut, ortalama, miktar, maliyet);
    else if (!h.sabit && h.kural.tur === "ortalama") maliyet = ortalama;
    mevcut = mevcut.add(h.giris ? miktar : miktar.negated());
    maliyetler.set(h.id, maliyet);
  }
  return { maliyetler, ortalama };
}
