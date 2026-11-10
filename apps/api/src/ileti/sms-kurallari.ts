import type { SablonIstegi } from "./ileti-sablonlari";

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

export const kirp = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** ILT-09/13: varsayılan metinler ileti-sablonlari.ts'de; değişkenler burada kırpılır ki SMS parça sayısı kaçmasın. */
export function vadeSmsSablonu(d: { firma: string; unvan: string; toplam: string; ihtar: boolean }): SablonIstegi {
  return { tur: d.ihtar ? "vade_ihtar_sms" : "vade_sms", degiskenler: { cari: kirp(d.unvan, 40), firma: kirp(d.firma, 40), toplam: d.toplam } };
}

export function sozSmsSablonu(d: { firma: string; unvan: string; tutar: string }): SablonIstegi {
  return { tur: "odeme_sozu_sms", degiskenler: { cari: kirp(d.unvan, 40), firma: kirp(d.firma, 40), tutar: d.tutar } };
}

export function odemeBaglantisiSmsSablonu(d: { unvan: string; link: string; faturaIcin: boolean }): SablonIstegi {
  return { tur: "odeme_baglantisi_sms", degiskenler: { cari: kirp(d.unvan, 40), baglanti: d.link, odeme_turu: d.faturaIcin ? "fatura" : "cari hesap" } };
}
