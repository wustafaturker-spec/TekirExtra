/**
 * İade faturasının iade edilen faturalara referansı (EBLG-58).
 *
 * GİB şematronu (NES önizlemesiyle denendi, 2026-09-19): IADE, TEVKIFATIADE
 * ve YTBIADE tiplerinde iade edilen **her** fatura için bir
 * `cac:BillingReference/cac:InvoiceDocumentReference` ister; `cbc:ID` 16
 * haneli belge numarası, `cbc:DocumentTypeCode` "IADE" olmalı ve tarih
 * bugünden ileri olamaz. Kural sunucu ile sihirbazda aynı işlevden okunur.
 */

/** `cbc:DocumentTypeCode` değeri; GİB görünümü iade tablosunu buna bakarak basar. */
export const IADE_BELGE_TUR_KODU = "IADE";

/**
 * Yurt dışındaki tedarikçiye iade e-belge ile kesilmez (karar 2026-09-19).
 * Kanal alıcının ülkesinden türediği için belge ihracat faturasına düşerdi;
 * iade edilen yabancı faturanın GİB numarası da yoktur. Sihirbaz ilk adımda,
 * gönderim ve önizleme sunucuda bu mesajla durur.
 */
export const YURT_DISI_IADE_ENGELI =
  "Tedarikçinin fatura adresi yurt dışında: yurt dışındaki tedarikçiye iade e-belge ile kesilmez, belgeyi e-belge dışında düzenleyin";

/** Bir iade faturasında en çok kaç fatura referans verilebilir. */
export const IADE_REFERANS_UST_SINIRI = 20;

/** GİB belge numarası: 3 karakter seri + 4 hane yıl + 9 hane sıra. */
const GIB_BELGE_NO = /^[A-Z0-9]{3}\d{13}$/;

export const gibBelgeNoMu = (no: string | null | undefined): boolean => GIB_BELGE_NO.test(no?.trim() ?? "");

export interface IadeReferansGirdi {
  belgeNo: string | null | undefined;
  /** YYYY-AA-GG ya da Date. */
  tarih: string | Date | null | undefined;
}

export interface IadeEngeli {
  /** Engelin ait olduğu referansın sırası; genel engelde yok. */
  sira?: number;
  mesaj: string;
}

const gun = (deger: string | Date): string =>
  typeof deger === "string" ? deger.slice(0, 10) : deger.toISOString().slice(0, 10);

/**
 * İade faturasının gönderilmesini engelleyen eksikler. `iadeTarihi` iade
 * faturasının kendi tarihidir: iade edilen fatura ondan sonra kesilmiş olamaz
 * (şematron yalnız "bugünden ileri olamaz" der, bu daha sıkı ve daha doğru).
 */
export function iadeEngelleri(referanslar: IadeReferansGirdi[], iadeTarihi: string | Date): IadeEngeli[] {
  if (referanslar.length === 0) {
    return [{ mesaj: "İade edilen en az bir fatura seçilmeli ya da numarasıyla girilmelidir" }];
  }
  const engeller: IadeEngeli[] = [];
  if (referanslar.length > IADE_REFERANS_UST_SINIRI) {
    engeller.push({ mesaj: `Bir iade faturasında en çok ${IADE_REFERANS_UST_SINIRI} fatura referans verilebilir` });
  }
  const gorulen = new Set<string>();
  referanslar.forEach((ref, index) => {
    const sira = index + 1;
    const no = ref.belgeNo?.trim().toLocaleUpperCase("tr-TR") ?? "";
    if (!gibBelgeNoMu(no)) {
      engeller.push({ sira, mesaj: `${sira}. referansın numarası 16 haneli olmalıdır (ör. ABC2026000000001)` });
    } else if (gorulen.has(no)) {
      engeller.push({ sira, mesaj: `${no} birden çok kez girilmiş` });
    }
    gorulen.add(no);
    if (!ref.tarih) {
      engeller.push({ sira, mesaj: `${sira}. referansın tarihi girilmelidir` });
    } else if (gun(ref.tarih) > gun(iadeTarihi)) {
      engeller.push({ sira, mesaj: `${sira}. referansın tarihi iade faturasının tarihinden sonra olamaz` });
    }
  });
  return engeller;
}
