/** AI-117: kart hücrelerinin biçimi (bağımlılıksız; birim testi için ayrı dosya). */
/** Ondalık metni Türkçe biçimler; basamak kaybı olmasın diye sayıya çevrilmez (para 2 haneye tamamlanır). */
export function sayiMetni(deger: string, para = false): string {
  const eksi = deger.startsWith("-");
  let [tam, kesir = ""] = (eksi ? deger.slice(1) : deger).split(".");
  if (para && kesir.length > 2) {
    const yuvarlak = Number(`${tam}.${kesir}`).toFixed(2);
    [tam, kesir] = yuvarlak.split(".");
  }
  if (para) kesir = kesir.padEnd(2, "0");
  return `${eksi ? "-" : ""}${tam.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${kesir ? `,${kesir}` : ""}`;
}
