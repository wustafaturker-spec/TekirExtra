/**
 * KAMU senaryosu (tasarım tablosu §3.6, şematron 14.09.2026 §4).
 *
 * Merkezi yönetim kapsamındaki kamu idarelerine (Harcama Yönetim Sistemi
 * kullananlar) kesilen e-Fatura `ProfileID` KAMU ile gider ve iki ek bilgi
 * taşır: ödemeyi yapacak **harcama biriminin VKN'si**
 * (`cac:BuyerCustomerParty`) ve ödemenin yapılacağı **IBAN**
 * (`cac:PaymentMeans/cac:PayeeFinancialAccount`). 14.09.2026'dan beri aynı
 * senaryo IADE tipinde de kullanılabilir: kamu idaresinden alınmış malın
 * iadesi; iade tutarını ödeyecek olan yine kamu tarafının harcama birimidir.
 *
 * Kararlar (2026-09-19): alıcı GİB mükellef listesinde KAMU türündeyse belge
 * kendiliğinden KAMU olur; listede ÖZEL görünen kurumlar ve test ortamı için
 * cari kartında elle işaret de konabilir. Harcama birimi kartta varsayılan
 * durur, sihirbazda faturaya özel değiştirilir; IBAN kendi banka
 * hesaplarımızdan seçilir.
 */

export const KAMU_PROFILI = "KAMU";

/** GİB mükellef listesinde `<Type>` değeri. */
export const MUKELLEF_TURU_KAMU = "KAMU";

/**
 * Ödeme şekli: GİB'in KAMU-IADE örneği `ZZZ` (karşılıklı anlaşılan) yazar;
 * kamu belgesinde ödeme her zaman IBAN'a yapılır, kodu değiştirmek bir şey
 * anlatmaz.
 */
export const KAMU_ODEME_KODU = "ZZZ";

/** Belge KAMU senaryosuyla mı gider — liste türü ya da kart işareti. */
export function kamuSenaryosuMu(girdi: { listeTuru?: string | null; kartIsareti?: boolean | null }): boolean {
  return girdi.listeTuru === MUKELLEF_TURU_KAMU || Boolean(girdi.kartIsareti);
}

/** IBAN'ı belgeye yazılacak biçime indirger: boşluksuz, büyük harf. */
export const ibanNormalize = (iban: string | null | undefined): string =>
  (iban ?? "").replace(/\s/g, "").toLocaleUpperCase("en-US");

/**
 * Şematronun deseni `^TR\d{7}[A-Z0-9]{17}$`; üstüne mod-97 denetimi yapılır,
 * çünkü desene uyan ama hanesi yanlış bir IBAN'a ödeme hiç ulaşmaz.
 */
export function ibanGecerliMi(iban: string | null | undefined): boolean {
  const sade = ibanNormalize(iban);
  if (!/^TR\d{7}[A-Z0-9]{17}$/.test(sade)) return false;
  const dizilim = (sade.slice(4) + sade.slice(0, 4)).replace(/[A-Z]/g, (h) => String(h.charCodeAt(0) - 55));
  let kalan = 0;
  for (const hane of dizilim) kalan = (kalan * 10 + Number(hane)) % 97;
  return kalan === 1;
}

export interface KamuBilgisi {
  harcamaBirimiVkn?: string | null;
  harcamaBirimiAdi?: string | null;
  iban?: string | null;
}

export interface KamuEngeli {
  alan: "harcamaBirimiVkn" | "harcamaBirimiAdi" | "iban";
  mesaj: string;
}

/**
 * Gönderimi engelleyen eksikler. Şematron VKN'nin yalnız 10 haneli bir sayı
 * olmasını arar; kontrol hanesi burada da aranmaz, çünkü test ortamındaki kamu
 * kimlikleri sentetiktir (EBLG-47).
 */
export function kamuEngelleri(bilgi: KamuBilgisi): KamuEngeli[] {
  const engeller: KamuEngeli[] = [];
  if (!/^\d{10}$/.test((bilgi.harcamaBirimiVkn ?? "").trim())) {
    engeller.push({ alan: "harcamaBirimiVkn", mesaj: "Ödemeyi yapacak harcama biriminin 10 haneli VKN'si girilmelidir" });
  }
  if (!bilgi.harcamaBirimiAdi?.trim()) {
    engeller.push({ alan: "harcamaBirimiAdi", mesaj: "Ödemeyi yapacak harcama biriminin adı girilmelidir" });
  }
  if (!bilgi.iban) {
    engeller.push({ alan: "iban", mesaj: "Ödemenin yapılacağı IBAN seçilmelidir (Kasa/Banka'da IBAN'lı TRY hesabı tanımlayın)" });
  } else if (!ibanGecerliMi(bilgi.iban)) {
    engeller.push({ alan: "iban", mesaj: "IBAN geçersiz: TR ile başlayan 26 karakterlik geçerli bir IBAN olmalıdır" });
  }
  return engeller;
}
