/**
 * FTR-10/44: tekrarlayan fatura plan takvimi ve dönem değişkenleri.
 * API (üretim) ve web (önizleme) aynı hesabı kullanır. Tarihler UTC gece
 * yarısı olarak ele alınır (plan tarihleri @db.Date).
 */

export type TekrarSikligi = "haftalik" | "aylik" | "yillik";
export type FaturalananDonem = "bu_donem" | "onceki_donem";

export const TEKRAR_DEGISKENLERI = ["AY", "AY_ADI", "YIL", "DONEM_BAS", "DONEM_BIT"] as const;
export type TekrarDegiskeni = (typeof TEKRAR_DEGISKENLERI)[number];

export const TEKRAR_DEGISKEN_ACIKLAMALARI: Record<TekrarDegiskeni, string> = {
  AY: "Ay numarası (11)",
  AY_ADI: "Ay adı (Kasım)",
  YIL: "Yıl (2026)",
  DONEM_BAS: "Dönem başı (03.11.2026)",
  DONEM_BIT: "Dönem sonu (02.12.2026)",
};

const AY_ADLARI = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const BIR_GUN_MS = 86_400_000;

/** Ay/yıl kaydırma; hedef ayda gün yoksa ayın son günü (31 Ocak + 1 ay = 28/29 Şubat). */
function ayKaydir(tarih: Date, ay: number, gun = tarih.getUTCDate()): Date {
  const hedef = new Date(Date.UTC(tarih.getUTCFullYear(), tarih.getUTCMonth() + ay, 1));
  const sonGun = new Date(Date.UTC(hedef.getUTCFullYear(), hedef.getUTCMonth() + 1, 0)).getUTCDate();
  hedef.setUTCDate(Math.min(gun, sonGun));
  return hedef;
}

/** Bir sonraki üretim tarihi (FTR-10 davranışı aynen korunur). */
export function sonrakiTekrarTarihi(tarih: Date, siklik: TekrarSikligi, aralik: number): Date {
  if (siklik === "haftalik") return new Date(tarih.getTime() + 7 * aralik * BIR_GUN_MS);
  return ayKaydir(tarih, siklik === "aylik" ? aralik : 12 * aralik);
}

/** Bir önceki üretim tarihi; `onceki_donem` başlangıcı için. */
export function oncekiTekrarTarihi(tarih: Date, siklik: TekrarSikligi, aralik: number): Date {
  if (siklik === "haftalik") return new Date(tarih.getTime() - 7 * aralik * BIR_GUN_MS);
  return ayKaydir(tarih, -(siklik === "aylik" ? aralik : 12 * aralik));
}

/** Planlanan tarihin faturaladığı dönem (iki uç dahil). */
export function faturalananDonemAraligi(planlanan: Date, siklik: TekrarSikligi, aralik: number, donem: FaturalananDonem): { bas: Date; bit: Date } {
  if (donem === "onceki_donem") {
    return { bas: oncekiTekrarTarihi(planlanan, siklik, aralik), bit: new Date(planlanan.getTime() - BIR_GUN_MS) };
  }
  return { bas: planlanan, bit: new Date(sonrakiTekrarTarihi(planlanan, siklik, aralik).getTime() - BIR_GUN_MS) };
}

const gunMetni = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;

export function tekrarDegiskenDegerleri(planlanan: Date, siklik: TekrarSikligi, aralik: number, donem: FaturalananDonem): Record<TekrarDegiskeni, string> {
  const { bas, bit } = faturalananDonemAraligi(planlanan, siklik, aralik, donem);
  return {
    AY: String(bas.getUTCMonth() + 1).padStart(2, "0"),
    AY_ADI: AY_ADLARI[bas.getUTCMonth()]!,
    YIL: String(bas.getUTCFullYear()),
    DONEM_BAS: gunMetni(bas),
    DONEM_BIT: gunMetni(bit),
  };
}

const DEGISKEN_DESENI = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Metindeki tanımsız değişken adları (ör. `{{AYY}}` → ["AYY"]). */
export function bilinmeyenTekrarDegiskenleri(metin: string): string[] {
  const bilinen = new Set<string>(TEKRAR_DEGISKENLERI);
  const sonuc = new Set<string>();
  for (const eslesme of metin.matchAll(DEGISKEN_DESENI)) if (!bilinen.has(eslesme[1]!)) sonuc.add(eslesme[1]!);
  return [...sonuc];
}

/** Değişkenleri doldurur; bilinmeyen değişken olduğu gibi bırakılır (kayıtta zaten reddedilir). */
export function tekrarMetniDoldur(metin: string, degerler: Record<TekrarDegiskeni, string>): string {
  return metin.replace(DEGISKEN_DESENI, (tum, ad: string) => (ad in degerler ? degerler[ad as TekrarDegiskeni] : tum));
}
