/**
 * Kullanıcının kendi mesajında açıkça bir yazma/işlem istediğini anlar.
 * Harici içerik (e-posta, OCR) okunduktan sonra yazma araçları yalnız bu
 * durumda çalışır (bkz. AiAjanService.dongu).
 *
 * Türkçe eklemeli bir dil olduğu için fiil yalın hâliyle değil kökünden
 * eşleşir: "oluşturur musun", "kaydedelim", "gönderir misin", "onaylayalım"
 * gibi çekimli hâller de istek sayılır. Eski `\b(kök)\b` kalıbı yalnız yalın
 * emir kipini tanıyordu.
 *
 * Olumsuz kip ("oluşturma", "göndermeyin", "kaydetmeden") istek sayılmaz.
 * Mastar ("oluşturmak istiyorum") ve gereklilik ("onaylamalısın") sayılır.
 */
const KOKLER = [
  "oluştur", "olustur",
  "hazırla", "hazirla",
  "kaydet", "kayded",
  "gönder", "gonder",
  "onayla",
  // "iptal et/ed": olumsuzluk eki yardımcı fiile gelir ("iptal etme").
  "iptal\\s*e[td]",
  "dönüştür", "donustur",
  "güncelle", "guncelle",
];

/** Kökten hemen sonra gelen olumsuzluk eki: -ma/-me ardından sözcük sonu ya da y/d/s/z. */
const OLUMSUZ = "(?!m[ae](?:$|[^a-zçğıöşü]|y|d|s|z))";

/** Kök sözcük başında olmalı; `\b` Türkçe harfleri tanımadığından önceki karakter elle denetlenir. */
const KALIP = new RegExp(`(?:^|[^a-zçğıöşü0-9])(?:${KOKLER.join("|")})${OLUMSUZ}`, "u");

export function acikYazmaIstegiVar(metin: string): boolean {
  return KALIP.test((metin ?? "").toLocaleLowerCase("tr-TR"));
}
