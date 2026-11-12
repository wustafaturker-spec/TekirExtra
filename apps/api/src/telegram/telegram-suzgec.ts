/**
 * CNL-05: Telegram'a giden her metnin son süzgeci. Model talimata uymasa da tam IBAN, T.C. kimlik
 * numarası ve erişim anahtarı dışarı çıkmaz; firma tutarları kapattıysa para tutarları gizlenir.
 * Süzgeç model çıktısına ve sabit metinlere aynı biçimde uygulanır.
 */

/** TR IBAN: TR + 24 hane, dörtlü gruplar arasında boşluk olabilir. Son 4 hane kalır. */
const IBAN = /\bTR(?:[ ]?\d){24}\b/gi;
/** Rakam dizisinin içinden değil, tek başına duran 11 hane. */
const ON_BIR_HANE = /(?<![\d.,])\d{11}(?![\d.,]\d|\d)/g;
/** Bilinen anahtar biçimleri: MCP (tkx_), EVREN, Anthropic/OpenAI, Telegram bot anahtarı. */
const ANAHTARLAR = [/\btkx_[A-Za-z0-9_-]{8,}/g, /\bevren_llm_[A-Za-z0-9_-]{8,}/g, /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g, /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g];
const PARA_BIRIMI = "(?:TL|TRY|USD|EUR|GBP|₺|\\$|€|£)";
const SAYI = "\\d{1,3}(?:[.,\\s]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";
const TUTAR = new RegExp(`(?:${PARA_BIRIMI}\\s?(?:${SAYI}))|(?:(?:${SAYI})\\s?${PARA_BIRIMI})(?![A-Za-zÇĞİÖŞÜçğıöşü])`, "g");

/** T.C. kimlik numarası sağlaması (ilk hane 0 olamaz; 10. ve 11. hane denetimi). */
export function tcknGecerliMi(no: string): boolean {
  if (!/^[1-9]\d{10}$/.test(no)) return false;
  const h = no.split("").map(Number);
  const tek = h[0] + h[2] + h[4] + h[6] + h[8];
  const cift = h[1] + h[3] + h[5] + h[7];
  const onuncu = (((tek * 7 - cift) % 10) + 10) % 10;
  if (onuncu !== h[9]) return false;
  return h.slice(0, 10).reduce((t, x) => t + x, 0) % 10 === h[10];
}

export function telegramSuz(metin: string, secenek: { tutarGoster: boolean }): string {
  let sonuc = metin.replace(IBAN, (m) => `TR** **** ${m.replace(/\s/g, "").slice(-4)} (tam IBAN panelde)`);
  sonuc = sonuc.replace(ON_BIR_HANE, (m) => (tcknGecerliMi(m) ? "*********** (kimlik no panelde)" : m));
  for (const kalip of ANAHTARLAR) sonuc = sonuc.replace(kalip, "[gizli anahtar]");
  if (!secenek.tutarGoster) sonuc = sonuc.replace(TUTAR, "[tutar gizli]");
  return sonuc;
}

/** Uzun yanıtı Telegram sınırına sığan parçalara böler; önce paragraf, sonra satır sınırından. */
export function parcala(metin: string, sinir = 4000): string[] {
  const parcalar: string[] = [];
  let kalan = metin.trim();
  while (kalan.length > sinir) {
    const pencere = kalan.slice(0, sinir);
    let kes = pencere.lastIndexOf("\n\n");
    if (kes < sinir / 2) kes = pencere.lastIndexOf("\n");
    if (kes < sinir / 2) kes = pencere.lastIndexOf(" ");
    if (kes < sinir / 2) kes = sinir;
    parcalar.push(kalan.slice(0, kes).trimEnd());
    kalan = kalan.slice(kes).trimStart();
  }
  if (kalan) parcalar.push(kalan);
  return parcalar.length ? parcalar : [""];
}
