/**
 * e-Arşiv internet satışı alanları (EBLG-56).
 *
 * İnternet üzerinden yapılan satışta GİB, faturada satışın nerede yapıldığını,
 * nasıl ödendiğini ve malın nereye/kiminle gönderildiğini arar. Bilgi satış
 * anında bilinir ama fatura kesildikten sonra girildiği için sihirbazda
 * toplanır; işaret de orada konur.
 *
 * Alan kümesi yalnız e-Arşiv kanalında belgeye yazılır: e-Fatura mükellefi bir
 * alıcıya kesilen belge internet satışı olsa bile bu grubu istemez.
 */

/**
 * Ödeme şekilleri. `ublKodu` UN/ECE 4461 karşılığıdır (`PaymentMeansCode`);
 * ekranda Türkçe adı görünür, belgeye kod gider.
 */
export const ODEME_SEKILLERI: readonly { kod: string; ad: string; ublKodu: string }[] = [
  { kod: "kredi_karti", ad: "Kredi kartı / banka kartı", ublKodu: "48" },
  { kod: "havale", ad: "Havale / EFT", ublKodu: "30" },
  { kod: "kapida_nakit", ad: "Kapıda nakit ödeme", ublKodu: "10" },
  { kod: "kapida_kart", ad: "Kapıda kartla ödeme", ublKodu: "48" },
  { kod: "odeme_aracisi", ad: "Ödeme aracısı (iyzico, PayPal…)", ublKodu: "68" },
  { kod: "cek", ad: "Çek", ublKodu: "20" },
  { kod: "diger", ad: "Diğer", ublKodu: "1" },
];

export const odemeSekliBul = (kod: string | null | undefined) =>
  ODEME_SEKILLERI.find((o) => o.kod === kod);

export const odemeSekliGecerliMi = (kod: string | null | undefined): boolean =>
  Boolean(odemeSekliBul(kod));

/** Belgeye yazılacak UBL ödeme kodu; tanınmayan şekilde "tanımsız" (1). */
export const odemeSekliUblKodu = (kod: string | null | undefined): string =>
  odemeSekliBul(kod)?.ublKodu ?? "1";

export interface InternetSatisBilgisi {
  internetSatisi: boolean;
  webAdresi?: string | null;
  odemeSekli?: string | null;
  odemeTarihi?: Date | string | null;
  odemeAracisi?: string | null;
  tasiyiciUnvan?: string | null;
  tasiyiciVkn?: string | null;
  gonderiTarihi?: Date | string | null;
}

export interface InternetSatisEngeli {
  alan: "siparisNo" | "siparisTarihi" | "webAdresi" | "odemeSekli" | "odemeTarihi" | "teslimatAdresi" | "tasiyiciVkn";
  mesaj: string;
}

export interface InternetSatisGirdi extends InternetSatisBilgisi {
  siparisNo?: string | null;
  siparisTarihi?: Date | string | null;
  /** Cari kartında teslimata elverişli bir adres var mı (sevk/merkez/fatura). */
  teslimatAdresiVar: boolean;
}

/**
 * Gönderimi engelleyen eksikler. Kargo bilgisi ve ödeme aracısı isteğe bağlıdır
 * — hizmet satışında taşıyan olmayabilir —, ama taşıyıcının VKN'si girilecekse
 * 10 ya da 11 hane olmalıdır.
 */
export function internetSatisEngelleri(girdi: InternetSatisGirdi): InternetSatisEngeli[] {
  if (!girdi.internetSatisi) return [];
  const engeller: InternetSatisEngeli[] = [];
  const bos = (deger: string | null | undefined) => !deger?.trim();

  if (bos(girdi.siparisNo)) engeller.push({ alan: "siparisNo", mesaj: "İnternet satışında sipariş numarası zorunludur; faturada doldurun" });
  if (!girdi.siparisTarihi) engeller.push({ alan: "siparisTarihi", mesaj: "İnternet satışında sipariş tarihi zorunludur; faturada doldurun" });
  if (bos(girdi.webAdresi)) engeller.push({ alan: "webAdresi", mesaj: "Satışın yapıldığı web adresi girilmelidir" });
  if (!odemeSekliGecerliMi(girdi.odemeSekli)) engeller.push({ alan: "odemeSekli", mesaj: "Ödeme şekli seçilmelidir" });
  if (!girdi.odemeTarihi) engeller.push({ alan: "odemeTarihi", mesaj: "Ödeme tarihi girilmelidir" });
  if (!girdi.teslimatAdresiVar) {
    engeller.push({ alan: "teslimatAdresi", mesaj: "İnternet satışında teslimat adresi belgeye yazılır; cari kartına sevk ya da merkez adresi ekleyin" });
  }
  if (girdi.tasiyiciVkn?.trim() && !/^\d{10}$|^\d{11}$/.test(girdi.tasiyiciVkn.trim())) {
    engeller.push({ alan: "tasiyiciVkn", mesaj: "Taşıyıcı VKN/TCKN 10 ya da 11 haneli olmalıdır" });
  }
  return engeller;
}
