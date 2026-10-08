/**
 * PRS-23…28 (P3-3): SGK bildirge ve MUHSGK kod tabloları. Kaynak: SGK 4A toplu
 * işe giriş/işten ayrılış XML kılavuzu ve APHB-3.1.xsd (docs/sgk/). Eşlemeler
 * ilk kullanımda mali müşavirle doğrulanmalıdır.
 */
export { belgeTuruSigortaKolu, CIKIS_NEDENI_SGK_KODU, CSGB_IS_KOLLARI, OGRENIM_DURUMLARI, SGK_BELGE_TURLERI, SGK_CIKIS_KODLARI } from "@tekirextra/shared";

/** Puantajdaki eksik gün nedeninin SGK kodu. */
export const EKSIK_GUN_KODU: Record<string, string> = { istirahat: "01", ucretsiz_izin: "02", disiplin: "03", gozaltina_alinma: "04", kismi_istihdam: "06", puantaj: "07", diger: "13" };

export const MESLEK_KODU_DESENI = /^\d{4}\.\d{2}$/;
export const KANUN_NO_DESENI = /^\d{5}$/;

/** Teşvik kanun no önerisi: kartta yoksa teşvik oranına göre 5510 s.K. 81/ı ya da teşviksiz. */
export const tesvikKanunNo = (kartta: string | null | undefined, tesvikOrani: number) => kartta || (tesvikOrani > 0 ? "05510" : "00000");

export interface IsyeriSicili { sicil: string; kontrolNo: string; araciNo: string }

/**
 * 26 haneli işyeri sicil numarası: 21 hane sicil (mahiyet, işkolu, ünite, sıra,
 * il, ilçe) + 2 hane kontrol + 3 hane aracı. Boşluk, nokta ve tire yok sayılır;
 * 26 rakam değilse XML için kullanılamaz.
 */
export function isyeriSiciliAyristir(sgkSicilNo: string | null | undefined): IsyeriSicili | null {
  const rakamlar = (sgkSicilNo ?? "").replace(/[\s.-]/g, "");
  if (!/^\d{26}$/.test(rakamlar)) return null;
  const kontrolNo = rakamlar.slice(21, 23);
  if (Number(kontrolNo) < 1 || Number(kontrolNo) > 97) return null;
  return { sicil: rakamlar.slice(0, 21), kontrolNo, araciNo: rakamlar.slice(23, 26) };
}

const gunEkle = (tarih: Date, gun: number) => new Date(Date.UTC(tarih.getUTCFullYear(), tarih.getUTCMonth(), tarih.getUTCDate() + gun));

/**
 * PRS-27: bildirge son tarihleri (özel sektör, 5510 m.8 ve m.9). İşe giriş
 * bildirgesi işe başlamadan bir gün önce; işten çıkış bildirgesi çıkıştan
 * itibaren 10 gün içinde verilir.
 */
export const iseGirisSonTarihi = (baslangic: Date) => gunEkle(baslangic, -1);
export const istenCikisSonTarihi = (bitis: Date) => gunEkle(bitis, 10);
