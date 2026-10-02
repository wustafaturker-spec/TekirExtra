/**
 * KSB-06: banka bakiyesi mutabakatı. Ekstredeki bakiye sütunundan her günün
 * banka gün sonu bakiyesi çıkarılır ve sistemdeki hesap bakiyesiyle
 * karşılaştırılır.
 *
 * Bankalar aynı gün içindeki satırları farklı sırada verebilir (artan, azalan,
 * işlem saatine göre); bu yüzden gün sonu bakiyesi satır sırasına güvenmeden
 * bulunur: satırın bakiyesinden kendi tutarı düşülünce gün başı adayı çıkar,
 * gün başı + günün toplamı başka bir satırın bakiyesine eşitse o gün sonudur.
 */
import { Prisma } from "@prisma/client";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);

export interface MutabakatSatiri {
  tarih: Date;
  tutar: Prisma.Decimal;
  bakiye: Prisma.Decimal | null;
  durum: "beklemede" | "eslesti" | "yoksayildi";
}

export interface MutabakatHareketi {
  tarih: Date;
  tip: string;
  tutar: Prisma.Decimal;
}

export interface MutabakatGunu {
  tarih: string;
  banka: string;
  sistem: string;
  fark: string;
  /** O güne kadar onay bekleyen ve yoksayılan satırların toplamı (farkın açıklanan kısmı). */
  bekleyen: string;
  yoksayilan: string;
}

const gun = (t: Date) => t.toISOString().slice(0, 10);
const giris = (tip: string) => tip === "tahsilat" || tip === "virman_gelis";

/** Günün satırlarından gün sonu bakiyesi; bulunamazsa null. */
export function gunSonuBakiyesi(satirlar: MutabakatSatiri[]): Prisma.Decimal | null {
  const bakiyeli = satirlar.filter((s) => s.bakiye !== null);
  if (bakiyeli.length === 0) return null;
  const gunToplami = satirlar.reduce((t, s) => t.add(s.tutar), D(0));
  const bakiyeler = bakiyeli.map((s) => s.bakiye!);
  for (const s of bakiyeli) {
    const gunSonu = s.bakiye!.sub(s.tutar).add(gunToplami);
    if (bakiyeler.some((b) => b.equals(gunSonu))) return gunSonu;
  }
  // Tutarlı bir zincir yoksa (eksik satır) dosyadaki son satırın bakiyesi.
  return bakiyeler[bakiyeler.length - 1];
}

export function mutabakatHesapla(satirlar: MutabakatSatiri[], hareketler: MutabakatHareketi[]) {
  const gunler = new Map<string, MutabakatSatiri[]>();
  for (const s of satirlar) gunler.set(gun(s.tarih), [...(gunler.get(gun(s.tarih)) ?? []), s]);
  const sirali = [...gunler.keys()].sort();
  const hareketSirali = [...hareketler].sort((a, b) => a.tarih.getTime() - b.tarih.getTime());

  const sonuc: MutabakatGunu[] = [];
  let sistem = D(0);
  let h = 0;
  let bekleyen = D(0);
  let yoksayilan = D(0);
  for (const g of sirali) {
    while (h < hareketSirali.length && gun(hareketSirali[h].tarih) <= g) {
      const x = hareketSirali[h++];
      sistem = giris(x.tip) ? sistem.add(x.tutar) : sistem.sub(x.tutar);
    }
    const gunSatirlari = gunler.get(g)!;
    for (const s of gunSatirlari) {
      if (s.durum === "beklemede") bekleyen = bekleyen.add(s.tutar);
      if (s.durum === "yoksayildi") yoksayilan = yoksayilan.add(s.tutar);
    }
    const banka = gunSonuBakiyesi(gunSatirlari);
    if (!banka) continue;
    sonuc.push({ tarih: g, banka: banka.toFixed(2), sistem: sistem.toFixed(2), fark: banka.sub(sistem).toFixed(2), bekleyen: bekleyen.toFixed(2), yoksayilan: yoksayilan.toFixed(2) });
  }

  const son = sonuc.at(-1) ?? null;
  // Farkın başladığı gün: son eşit günden sonraki ilk farklı gün; hiç eşit gün
  // yoksa fark ekstrenin ilk gününden beri vardır (null).
  let sonEsit = -1;
  sonuc.forEach((x, i) => { if (D(x.fark).isZero()) sonEsit = i; });
  const farkBaslangici = son && !D(son.fark).isZero() && sonEsit >= 0 ? sonuc[sonEsit + 1]?.tarih ?? null : null;
  // Bekleyen/yoksayılan satırlarla açıklanamayan fark ilk günden beri hiç değişmediyse
  // büyük olasılıkla hesabın açılış bakiyesi girilmemiştir.
  const aciklanamayan = (x: MutabakatGunu) => D(x.fark).sub(x.bekleyen).sub(x.yoksayilan);
  const sabitFark = sonuc.length > 0 && sonEsit === -1 && !aciklanamayan(sonuc[0]).isZero()
    && sonuc.every((x) => aciklanamayan(x).equals(aciklanamayan(sonuc[0])));
  const aciklanmayan = son ? D(son.fark).sub(son.bekleyen).sub(son.yoksayilan) : D(0);
  return {
    son,
    farkBaslangici,
    acilisBakiyesiEksikOlabilir: sabitFark,
    aciklanmayanFark: aciklanmayan.toFixed(2),
    gunler: sonuc.slice(-60),
  };
}
