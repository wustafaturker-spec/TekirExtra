/**
 * EBLG-76: faturanın sevkiyatla ilişkisi. Firma e-İrsaliye mükellefiyse mal
 * satışında sevkiyatın nasıl belgelendiği sorulur; üç yol vardır ve birbirini
 * dışlar. Mükellef olmayan firmada bu kural hiç çalışmaz.
 */
export const SEVKIYAT_YONTEMLERI = [
  { kod: "irsaliye", etiket: "Bu sevkiyat için e-İrsaliye düzenlendi" },
  { kod: "fatura_once", etiket: "Fatura sevkten önce düzenleniyor; e-İrsaliye sonra kesilecek" },
  { kod: "irsaliye_yerine", etiket: "Mal fatura beraberinde sevk edildi; e-İrsaliye düzenlenmiyor" },
] as const;

export type SevkiyatYontemi = (typeof SEVKIYAT_YONTEMLERI)[number]["kod"];

export const SEVKIYAT_YONTEM_KODLARI = SEVKIYAT_YONTEMLERI.map((y) => y.kod) as [SevkiyatYontemi, ...SevkiyatYontemi[]];

export function sevkiyatYontemiMi(deger: unknown): deger is SevkiyatYontemi {
  return typeof deger === "string" && SEVKIYAT_YONTEM_KODLARI.includes(deger as SevkiyatYontemi);
}

/**
 * İrsaliye yerine geçen faturaya yazılan ibare. Belgeye `cbc:Note` olarak da
 * gider: GİB'in genel XSLT'si sevk tarih/saat alanlarını basmaz, notu basar
 * (EBLG-73'te aynı tuzağa vade tarihinde düşmüştük). Alıcı e-Fatura mükellefi
 * değilse belge e-Arşiv'e düştüğü için ibare de o belgenin adını söyler.
 */
export function irsaliyeYerineIbaresi(tur: "efatura" | "earsiv" = "efatura"): string {
  const belge = tur === "earsiv" ? "e-Arşiv faturası" : "e-Fatura";
  return `Mal ${belge} beraberinde sevk edildiğinden ayrıca e-İrsaliye düzenlenmemiştir. Bu fatura irsaliye yerine geçer.`;
}

/**
 * Sevkiyat yalnız fiziksel mal satışında sorulur: hizmet faturasının sevki
 * yoktur. Alış faturası ve iade dışı tipler de kapsam dışıdır.
 */
export function sevkiyatSorulurMu(fatura: {
  tip: string;
  satirlar: { stok: { tip?: string | null } }[];
}): boolean {
  return fatura.tip === "satis" && fatura.satirlar.some((s) => s.stok.tip !== "hizmet");
}

/**
 * Gönderimi durduran eksikler. Boş dizi dönerse belge gönderilebilir.
 * `mukellef` null ise firmanın durumu bilinmiyordur: liste güncel değil ve
 * firma ayarında da belirtilmemiş; sessizce irsaliyesiz göndermektense sorarız.
 */
export function sevkiyatEksikleri(girdi: {
  sorulur: boolean;
  mukellef: boolean | null;
  yontem: string | null;
  irsaliyeSayisi: number;
  fiiliSevkZamani: Date | string | null;
}): string[] {
  if (!girdi.sorulur) return [];
  if (girdi.mukellef === false) return [];
  if (girdi.mukellef === null) {
    return ["Firmanın e-İrsaliye mükellefiyeti bilinmiyor; entegratör mükellef listesini güncelleyin veya firma ayarından belirtin."];
  }
  if (!sevkiyatYontemiMi(girdi.yontem)) {
    return ["Sevkiyatın nasıl belgelendiğini seçin: e-İrsaliye düzenlendi, fatura sevkten önce düzenleniyor ya da mal fatura beraberinde sevk edildi."];
  }
  if (girdi.yontem === "irsaliye" && girdi.irsaliyeSayisi === 0) {
    return ["Bu satışa ait en az bir gönderilmiş e-İrsaliye seçin."];
  }
  if (girdi.yontem === "irsaliye_yerine" && !girdi.fiiliSevkZamani) {
    return ["İrsaliye yerine geçen faturada fiili sevk tarihi ve saati zorunludur."];
  }
  return [];
}
