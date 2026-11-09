/** ILT-10/11: SMS kuralları; veritabanından bağımsızdır. */

/** Türkiye cep numarasını E.164'e çevirir; geçersizse null. */
export function telefonE164(telefon: string): string | null {
  let r = telefon.replace(/\D/g, "");
  if (r.startsWith("90") && r.length === 12) r = r.slice(2);
  if (r.startsWith("0") && r.length === 11) r = r.slice(1);
  return /^5\d{9}$/.test(r) ? `+90${r}` : null;
}

/** Sağlayıcı ücretlendirmesi için tahmini parça sayısı: Türkçe karakterli metin daha kısa parçalanır. */
export function smsParcaSayisi(mesaj: string): number {
  const turkce = /[çğıİöşüÇĞÖŞÜ]/.test(mesaj);
  const tek = turkce ? 155 : 160, cok = turkce ? 150 : 153;
  return mesaj.length <= tek ? 1 : Math.ceil(mesaj.length / cok);
}

export const SMS_GUNLUK_TAVAN_VARSAYILAN = 500;
export const smsGunlukTavan = () => { const n = Number(process.env.SMS_GUNLUK_TAVAN); return Number.isInteger(n) && n > 0 ? n : SMS_GUNLUK_TAVAN_VARSAYILAN; };

const kirp = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** Tanıtım içermez; alıcının kimden aldığı her metinde yazar (ILT-13). */
export function vadeSmsMetni(d: { firma: string; unvan: string; toplam: string; ihtar: boolean }): string {
  return `Sayın ${kirp(d.unvan, 40)}, ${kirp(d.firma, 40)} firmasına vadesi geçmiş ${d.toplam} borcunuz ${d.ihtar ? "için ödeme ihtarıdır" : "bulunmaktadır"}. Ödediyseniz dikkate almayınız.`;
}

export function sozSmsMetni(d: { firma: string; unvan: string; tutar: string }): string {
  return `Sayın ${kirp(d.unvan, 40)}, ${kirp(d.firma, 40)} firmasına verdiğiniz ${d.tutar} ödeme sözünün tarihi bugündür. Ödediyseniz dikkate almayınız.`;
}

export function odemeBaglantisiSmsMetni(d: { unvan: string; link: string; faturaIcin: boolean }): string {
  return `Sayın ${kirp(d.unvan, 40)}, ${d.faturaIcin ? "fatura" : "cari hesap"} ödeme bağlantınız: ${d.link}`;
}
