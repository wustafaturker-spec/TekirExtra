/**
 * PRS-18 (P3-2, karar 2026-10-04): çıkış bordrosu. Kıdem ve ihbar hakkı
 * çıkış nedeninden önerilir, kullanıcı gerekçeyle değiştirebilir; tutarlar
 * çıkış ayının bordrosuna kalem olarak girer (vergi/SGK motorda).
 *
 * - Kıdem (1475 s. K. m.14): en az 1 yıl; her yıl için 30 günlük giydirilmiş
 *   brüt, kıdem tavanıyla sınırlı; artan süre orantılı. Yalnız damga vergisi.
 * - İhbar (4857 s. K. m.17): <6 ay 2, 6 ay–1,5 yıl 4, 1,5–3 yıl 6, >3 yıl 8
 *   hafta; giydirilmiş brüt üzerinden; GV + DV, SGK yok. Önel verilmişse ödenmez;
 *   işçi önelsiz ayrılırsa işverene öder (kesinti).
 * - Kullanılmamış yıllık izin (m.59): çıkış nedeni ne olursa olsun; çıplak
 *   brüt ücret üzerinden; ücret gibi SGK + GV + DV.
 * - Hizmet süresi yalnız son istihdam dönemidir; önceki dönemlerin birleştirilmesi elle değerlendirilir.
 *
 * Kıdem tavanı Mevzuat Merkezi'nden gelir (`kanuni_deger / kidem_tavani`,
 * yarıyıllık); çağıran fesih tarihindeki değeri okuyup girdiye koyar.
 */

export const CIKIS_NEDENLERI = {
  isveren_fesih: { ad: "İşveren feshi (haklı neden olmadan)", kidem: true, ihbar: "isveren_oder" },
  istifa: { ad: "İstifa", kidem: false, ihbar: "yok" },
  emeklilik: { ad: "Emeklilik / yaşlılık aylığı", kidem: true, ihbar: "yok" },
  askerlik: { ad: "Muvazzaf askerlik", kidem: true, ihbar: "yok" },
  evlilik: { ad: "Evlilik (kadın, 1 yıl içinde)", kidem: true, ihbar: "yok" },
  isci_hakli_fesih: { ad: "İşçinin haklı feshi (m.24)", kidem: true, ihbar: "yok" },
  isveren_saglik_zorlayici: { ad: "İşveren feshi — sağlık / zorlayıcı neden (m.25/I, III)", kidem: true, ihbar: "yok" },
  ahlak_iyiniyet: { ad: "İşveren feshi — ahlak ve iyiniyet ihlali (m.25/II)", kidem: false, ihbar: "yok" },
  deneme_suresi: { ad: "Deneme süresinde fesih", kidem: false, ihbar: "yok" },
  belirli_sure_bitimi: { ad: "Belirli süreli sözleşmenin bitimi", kidem: true, ihbar: "yok" },
  olum: { ad: "Ölüm", kidem: true, ihbar: "yok" },
  diger: { ad: "Diğer", kidem: false, ihbar: "yok" },
} as const;

export type CikisNedeni = keyof typeof CIKIS_NEDENLERI;
export type IhbarDurumu = "yok" | "isveren_oder" | "isci_oder";

const GUN_MS = 86_400_000;
const utc = (t: Date) => Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
const kurus = (n: number) => Math.round(n * 100) / 100;

/** Giriş ve çıkış günü dahil hizmet günü. */
export const hizmetGunu = (giris: Date, cikis: Date) => Math.round((utc(cikis) - utc(giris)) / GUN_MS) + 1;

export function ihbarHaftasi(gun: number): number {
  if (gun < 183) return 2;
  if (gun < 548) return 4;
  if (gun < 1096) return 6;
  return 8;
}

export interface CikisGirdisi {
  girisTarihi: Date;
  cikisTarihi: Date;
  kidemHakki: boolean;
  ihbarDurumu: IhbarDurumu;
  /** Son brüt ücret (aylık, çıplak). */
  sonBrut: number;
  /** Aylık düzenli yan ödemeler (yemek, yol, düzenli prim). */
  yanOdemeler: number;
  /** Kullanılmamış yıllık izin günü. */
  izinGunu: number;
  /** Fesih tarihindeki kıdem tavanı (Mevzuat Merkezi); yayınlanmamışsa null. */
  kidemTavani: number | null;
}

export class KidemTavaniYokHatasi extends Error {
  constructor(cikis: Date) {
    super(`${cikis.toISOString().slice(0, 10)} tarihindeki kıdem tazminatı tavanı Mevzuat Merkezi'nde henüz yayınlanmadı`);
  }
}

export function cikisHesapla(g: CikisGirdisi) {
  const gun = hizmetGunu(g.girisTarihi, g.cikisTarihi);
  const giydirilmis = kurus(g.sonBrut + g.yanOdemeler);
  const tavan = g.kidemTavani;
  const kidemVar = g.kidemHakki && gun >= 365;
  // Kıdem doğmuyorsa tavan gerekmez; doğuyorsa tavansız hesap yapılmaz.
  if (kidemVar && tavan === null) throw new KidemTavaniYokHatasi(g.cikisTarihi);
  const kidemEsasi = tavan === null ? giydirilmis : Math.min(giydirilmis, tavan);
  const kidemTutari = kidemVar ? kurus((kidemEsasi * gun) / 365) : 0;
  const hafta = ihbarHaftasi(gun);
  const ihbarTutari = g.ihbarDurumu === "yok" ? 0 : kurus((giydirilmis / 30) * hafta * 7);
  const izinUcreti = kurus((g.sonBrut / 30) * Math.max(0, g.izinGunu));
  return {
    hizmetGunu: gun,
    giydirilmisBrut: giydirilmis,
    kidemTavani: tavan,
    kidemEsasi,
    kidemTutari,
    kidemUyari: g.kidemHakki && gun < 365 ? "Hizmet süresi 1 yıldan az; kıdem tazminatı doğmaz" : null,
    ihbarHaftasi: hafta,
    ihbarTutari,
    ihbarDurumu: g.ihbarDurumu,
    izinGunu: g.izinGunu,
    izinUcreti,
  };
}
