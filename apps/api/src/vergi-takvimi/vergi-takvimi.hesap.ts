import { donemSonGunu, VERGI_YUKUMLULUK_ADLARI, type VergiYukumlulugu } from "@tekirextra/shared";

/** VTK: takvim satırı hesabı; veritabanından bağımsızdır. Tutarlar TL, kuruşa yuvarlıdır. */

export const kurus = (n: number) => Math.round(n * 100) / 100;
export const donemAnahtari = (yil: number, ay: number) => yil * 12 + ay - 1;
export const donemCoz = (a: number) => ({ yil: Math.floor(a / 12), ay: (a % 12) + 1 });

export type VergiDurumu = "bekliyor" | "kismi" | "odendi" | "gecikti" | "yok";

export interface DonemEksikleri { onaysizBordro: number; izsizBordro: number; taslakFatura: number; taslakMasraf: number }

/** Bir dönemin kayıtlardan okunan ham tutarları. */
export interface DonemGirdisi extends DonemEksikleri { kdvNet: number; kdv2: number; gvDamga: number; stopaj: number; sgk: number }

export const bosDonem = (): DonemGirdisi => ({ kdvNet: 0, kdv2: 0, gvDamga: 0, stopaj: 0, sgk: 0, onaysizBordro: 0, izsizBordro: 0, taslakFatura: 0, taslakMasraf: 0 });

export interface KdvZincirAdimi { hesaplanan: number; devredenGiren: number; devredenCikan: number }

/** VTK-03/05: net KDV, devredenle kapanır; beyanda yazan devreden hesaptan üstündür. */
export function kdvAdimi(net: number, devredenGiren: number, beyanDevreden: number | null): KdvZincirAdimi {
  const fark = kurus(net - devredenGiren);
  return { hesaplanan: Math.max(0, fark), devredenGiren: kurus(devredenGiren), devredenCikan: beyanDevreden ?? Math.max(0, kurus(-fark)) };
}

export function vergiDurumu(g: { tutar: number; odenen: number; sonTarih: string | null; bugun: string }): VergiDurumu {
  const kalan = kurus(g.tutar - g.odenen);
  if (kalan > 0) return g.sonTarih && g.bugun > g.sonTarih ? "gecikti" : g.odenen > 0 ? "kismi" : "bekliyor";
  return g.odenen > 0 ? "odendi" : "yok";
}

export interface VergiOdemeOzeti { id: string; tarih: string; tutar: number; not: string | null; hareketId: string | null; hareketAciklama: string | null }

export interface VergiTakvimSatiri {
  yukumluluk: VergiYukumlulugu; ad: string; yil: number; ay: number;
  /** Tarih yayınlanmadıysa boş: "son tarih yayınlanmadı". */
  sonTarih: string | null;
  /** Uzatmadan önceki tarih. */
  oncekiSonTarih: string | null;
  hesaplanan: number; beyanTutari: number | null; beyanDevreden: number | null; beyanNotu: string | null;
  tutar: number; odenen: number; kalan: number; durum: VergiDurumu;
  donemSuruyor: boolean; uyarilar: string[];
  devredenGiren: number | null; devredenCikan: number | null;
  odemeler: VergiOdemeOzeti[];
}

export interface SatirGirdisi {
  yukumluluk: VergiYukumlulugu; yil: number; ay: number; bugun: string;
  sonTarih: string | null; oncekiSonTarih: string | null;
  hesaplanan: number; beyanTutari: number | null; beyanDevreden: number | null; beyanNotu: string | null;
  odemeler: VergiOdemeOzeti[]; eksikler: DonemEksikleri;
  devredenGiren?: number | null; devredenCikan?: number | null;
  /** Firma başlangıç dönemini girmediyse geçmişi izlemez; satır gecikmiş sayılmaz. */
  takipBasladi?: boolean;
}

/** VTK-08: eksik veri uyarıları; bordrolu kalemde bordro, belgeli kalemde fatura/masraf sayılır. */
function eksikUyarilari(y: VergiYukumlulugu, e: DonemEksikleri): string[] {
  const bordro = y === "sgk" || y === "muhtasar" || y === "muhtasar3";
  const fatura = y !== "sgk";
  const masraf = y === "muhtasar" || y === "muhtasar3";
  return [
    bordro && e.onaysizBordro > 0 && `${e.onaysizBordro} onaylanmamış bordro tutara girmedi`,
    bordro && e.izsizBordro > 0 && `${e.izsizBordro} bordroda hesap izi yok, tutara girmedi`,
    fatura && e.taslakFatura > 0 && `${e.taslakFatura} taslak fatura tutara girmedi`,
    masraf && e.taslakMasraf > 0 && `${e.taslakMasraf} onay bekleyen masraf tutara girmedi`,
  ].filter((u): u is string => Boolean(u));
}

export function takvimSatiri(g: SatirGirdisi): VergiTakvimSatiri {
  const hesaplanan = kurus(g.hesaplanan);
  const tutar = g.beyanTutari ?? hesaplanan;
  const odenen = kurus(g.odemeler.reduce((t, o) => t + o.tutar, 0));
  return {
    yukumluluk: g.yukumluluk, ad: VERGI_YUKUMLULUK_ADLARI[g.yukumluluk], yil: g.yil, ay: g.ay,
    sonTarih: g.sonTarih, oncekiSonTarih: g.oncekiSonTarih,
    hesaplanan, beyanTutari: g.beyanTutari, beyanDevreden: g.beyanDevreden, beyanNotu: g.beyanNotu,
    tutar, odenen, kalan: Math.max(0, kurus(tutar - odenen)),
    durum: vergiDurumu({ tutar, odenen, sonTarih: g.takipBasladi === false ? null : g.sonTarih, bugun: g.bugun }),
    donemSuruyor: donemSonGunu(g.yil, g.ay) >= g.bugun,
    uyarilar: eksikUyarilari(g.yukumluluk, g.eksikler),
    devredenGiren: g.devredenGiren ?? null, devredenCikan: g.devredenCikan ?? null,
    odemeler: g.odemeler,
  };
}
