/**
 * MVZ-17: dönemsel mevzuat değerlerinin yayın takvimi. Bu değerler yalnız
 * başladıkları dönemde geçerlidir (bordro ve tevkifat alt sınırı yıl, kıdem
 * tavanı yarıyıl); yeni dönemin kaydı yayınlanmadan ilgili hesap yapılmaz.
 * Takvim, sıradaki dönem yaklaşırken ya da başladığı hâlde kayıt yoksa uyarır.
 */

export type DonemSikligi = "yillik" | "yariyillik";

export interface DonemselDeger { tur: string; anahtar: string; ad: string; siklik: DonemSikligi; etki: string }

export const DONEMSEL_DEGERLER: readonly DonemselDeger[] = [
  { tur: "bordro_parametreleri", anahtar: "genel", ad: "Bordro parametreleri (asgari ücret, SGK tavanı, GV dilimleri…)", siklik: "yillik", etki: "bordro hesaplanamaz" },
  { tur: "kanuni_deger", anahtar: "kidem_tavani", ad: "Kıdem tazminatı tavanı", siklik: "yariyillik", etki: "kıdem tazminatı hesaplanamaz" },
  { tur: "kanuni_deger", anahtar: "tevkifat_alt_siniri", ad: "KDV tevkifatı alt sınırı", siklik: "yillik", etki: "tevkifat alt sınırı denetlenemez" },
];

/** Uyarı penceresi: sıradaki döneme bu kadar gün kala kayıt yoksa "yaklaşıyor". */
export const YAYIN_UYARI_GUNU = 45;

export type TakvimDurumu = "tamam" | "bekliyor" | "yaklasiyor" | "eksik";

export interface TakvimSatiri {
  tur: string; anahtar: string; ad: string; etki: string;
  /** "2027" ya da "2027/1" */
  donem: string;
  baslangic: string; // YYYY-MM-DD
  /** Dönem başına kalan gün (başladıysa 0 ya da eksi). */
  kalanGun: number;
  kayitVar: boolean;
  durum: TakvimDurumu;
}

const gunFarki = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

function donemBasi(siklik: DonemSikligi, yil: number, yari: 1 | 2) {
  return siklik === "yillik" ? { donem: String(yil), baslangic: `${yil}-01-01`, bitis: `${yil}-12-31` }
    : yari === 1 ? { donem: `${yil}/1`, baslangic: `${yil}-01-01`, bitis: `${yil}-06-30` } : { donem: `${yil}/2`, baslangic: `${yil}-07-01`, bitis: `${yil}-12-31` };
}

/**
 * Her dönemsel değer için içinde bulunulan ve sıradaki dönemin satırı.
 * `kayitlar`: değerin bütün kayıtlarının yürürlük başlangıçları.
 */
export function yayinTakvimi(kayitlar: readonly { tur: string; anahtar: string; yururlukBaslangic: string }[], bugun: string): TakvimSatiri[] {
  const yil = Number(bugun.slice(0, 4));
  const yari: 1 | 2 = bugun.slice(5, 7) <= "06" ? 1 : 2;
  return DONEMSEL_DEGERLER.flatMap((d) => {
    const simdiki = donemBasi(d.siklik, yil, yari);
    const sonraki = d.siklik === "yillik" ? donemBasi(d.siklik, yil + 1, 1) : yari === 1 ? donemBasi(d.siklik, yil, 2) : donemBasi(d.siklik, yil + 1, 1);
    const var_ = (p: { baslangic: string; bitis: string }) =>
      kayitlar.some((k) => k.tur === d.tur && k.anahtar === d.anahtar && k.yururlukBaslangic.slice(0, 10) >= p.baslangic && k.yururlukBaslangic.slice(0, 10) <= p.bitis);
    const satir = (p: ReturnType<typeof donemBasi>, kayitVar: boolean, durum: TakvimDurumu): TakvimSatiri =>
      ({ tur: d.tur, anahtar: d.anahtar, ad: d.ad, etki: d.etki, donem: p.donem, baslangic: p.baslangic, kalanGun: gunFarki(p.baslangic, bugun), kayitVar, durum });
    const simdikiVar = var_(simdiki), sonrakiVar = var_(sonraki);
    const kalan = gunFarki(sonraki.baslangic, bugun);
    return [
      satir(simdiki, simdikiVar, simdikiVar ? "tamam" : "eksik"),
      satir(sonraki, sonrakiVar, sonrakiVar ? "tamam" : kalan <= YAYIN_UYARI_GUNU ? "yaklasiyor" : "bekliyor"),
    ];
  });
}

/** Platform ekibine e-posta hatırlatması gönderilen kalan gün eşikleri. */
export const HATIRLATMA_GUNLERI = [30, 15, 7] as const;
