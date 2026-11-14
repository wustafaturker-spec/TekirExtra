import { Prisma } from "@prisma/client";

/**
 * END-06…10: fiyat–endeks karşılaştırmasının saf hesabı. Bütün tutar ve
 * oranlar Decimal'dir; çıktı ondalık metindir (yüzdeler iki, fiyatlar dört
 * basamak). Model ya da istemci hesap yapmaz.
 */
type D = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const YUZ = D(100);

/** END-10 (kullanıcı kararı 2026-11-14): ayda en az bu kadar fatura satırı yoksa ay "yetersiz veri"dir. */
export const EN_AZ_SATIR = 2;

export interface AylikToplam { tutar: D; miktar: D; satir: number }
export type AyDurumu = "tamam" | "yetersiz" | "yok";

export interface FiyatSatiri {
  ay: string;
  durum: AyDurumu;
  satir: number;
  /** Ana birim başına TL (KDV hariç, iskontolar düşülmüş); yetersiz/yok ayda null. */
  fiyat: string | null;
  /** Baz ay = 100. */
  endeks100: string | null;
  aylikDegisim: string | null;
  yillikDegisim: string | null;
}

export interface Karsilastirma {
  endeks: string;
  bazAy: string;
  sonAy: string | null;
  bazFiyat: string | null;
  sonFiyat: string | null;
  fiyatDegisim: string | null;
  endeksDegisim: string | null;
  /** (1 + fiyat değişimi) / (1 + endeks değişimi) − 1 */
  reelDegisim: string | null;
  /** Baz fiyat × son endeks / baz endeks. */
  olmasiGerekenFiyat: string | null;
  /** Son fiyat − olması gereken fiyat. */
  fark: string | null;
  neden: string | null;
}

const AY = /^\d{4}-\d{2}-01$/;

/** "2026-10-01" + n ay. */
export function ayKaydir(ay: string, n: number): string {
  const [y, a] = ay.split("-").map(Number);
  const t = new Date(Date.UTC(y, a - 1 + n, 1));
  return t.toISOString().slice(0, 10);
}

/** YYYY-MM ya da YYYY-MM-DD → ayın ilk günü; geçersizse null. */
export function ayBasiMetni(deger: string | undefined | null): string | null {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(deger ?? "");
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

/** İki ay dahil aradaki aylar. */
export function ayAraligi(baslangic: string, bitis: string): string[] {
  if (!AY.test(baslangic) || !AY.test(bitis) || baslangic > bitis) return [];
  const sonuc: string[] = [];
  for (let ay = baslangic; ay <= bitis; ay = ayKaydir(ay, 1)) sonuc.push(ay);
  return sonuc;
}

const yuzde = (oran: D) => oran.mul(YUZ).toDecimalPlaces(2).toFixed(2);
const fiyatMetni = (f: D) => f.toDecimalPlaces(4).toFixed(4);

export function ayFiyati(t: AylikToplam | undefined): { durum: AyDurumu; fiyat: D | null; satir: number } {
  if (!t || t.satir === 0) return { durum: "yok", fiyat: null, satir: 0 };
  if (t.satir < EN_AZ_SATIR || !t.miktar.gt(0)) return { durum: "yetersiz", fiyat: null, satir: t.satir };
  return { durum: "tamam", fiyat: t.tutar.div(t.miktar), satir: t.satir };
}

/**
 * Bir fiyat serisinin ekrandaki ayları ve her endeksle karşılaştırması.
 * `toplamlar` yıllık değişim için ekrandan 12 ay öncesini de içerebilir.
 */
export function fiyatSerisiHesapla(
  toplamlar: Map<string, AylikToplam>,
  ekranAylari: string[],
  baz: string,
  endeksler: Map<string, Map<string, D>>,
): { satirlar: FiyatSatiri[]; karsilastirmalar: Karsilastirma[] } {
  const fiyat = (ay: string) => ayFiyati(toplamlar.get(ay));
  const bazF = fiyat(baz);
  const satirlar: FiyatSatiri[] = ekranAylari.map((ay) => {
    const f = fiyat(ay);
    const onceki = fiyat(ayKaydir(ay, -1)).fiyat;
    const gecenYil = fiyat(ayKaydir(ay, -12)).fiyat;
    return {
      ay,
      durum: f.durum,
      satir: f.satir,
      fiyat: f.fiyat ? fiyatMetni(f.fiyat) : null,
      endeks100: f.fiyat && bazF.fiyat ? f.fiyat.div(bazF.fiyat).mul(YUZ).toDecimalPlaces(2).toFixed(2) : null,
      aylikDegisim: f.fiyat && onceki ? yuzde(f.fiyat.div(onceki).sub(1)) : null,
      yillikDegisim: f.fiyat && gecenYil ? yuzde(f.fiyat.div(gecenYil).sub(1)) : null,
    };
  });

  const karsilastirmalar: Karsilastirma[] = [...endeksler.entries()].map(([kod, degerler]) => {
    const bos: Karsilastirma = { endeks: kod, bazAy: baz, sonAy: null, bazFiyat: bazF.fiyat ? fiyatMetni(bazF.fiyat) : null, sonFiyat: null, fiyatDegisim: null, endeksDegisim: null, reelDegisim: null, olmasiGerekenFiyat: null, fark: null, neden: null };
    if (!bazF.fiyat) return { ...bos, neden: bazF.durum === "yetersiz" ? `Baz ayda yeterli veri yok (en az ${EN_AZ_SATIR} fatura satırı gerekir).` : "Baz ayda bu ürünün faturası yok." };
    const bazE = degerler.get(baz);
    if (!bazE) return { ...bos, neden: "Baz ay için endeks değeri yok (henüz açıklanmamış olabilir)." };
    const son = [...ekranAylari].reverse().find((ay) => ay > baz && fiyat(ay).fiyat && degerler.has(ay));
    if (!son) return { ...bos, neden: "Baz aydan sonra hem fiyatı hem endeksi olan ay yok." };
    const sonF = fiyat(son).fiyat!, sonE = degerler.get(son)!;
    const fd = sonF.div(bazF.fiyat).sub(1);
    const ed = sonE.div(bazE).sub(1);
    const gereken = bazF.fiyat.mul(sonE).div(bazE);
    return {
      ...bos,
      sonAy: son,
      sonFiyat: fiyatMetni(sonF),
      fiyatDegisim: yuzde(fd),
      endeksDegisim: yuzde(ed),
      reelDegisim: yuzde(fd.add(1).div(ed.add(1)).sub(1)),
      olmasiGerekenFiyat: fiyatMetni(gereken),
      fark: fiyatMetni(sonF.sub(gereken)),
    };
  });
  return { satirlar, karsilastirmalar };
}

/** Endeks değerlerini baz ay = 100 ölçeğine taşır; değeri olmayan ay null. */
export function endeksNormalle(degerler: Map<string, D>, aylar: string[], baz: string): { ay: string; deger: string | null; normal: string | null }[] {
  const b = degerler.get(baz);
  return aylar.map((ay) => {
    const d = degerler.get(ay);
    return { ay, deger: d ? d.toFixed(4) : null, normal: d && b ? d.div(b).mul(YUZ).toDecimalPlaces(2).toFixed(2) : null };
  });
}
