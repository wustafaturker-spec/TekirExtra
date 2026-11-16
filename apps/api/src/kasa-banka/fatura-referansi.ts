/**
 * KSB-44: banka açıklamasındaki fatura referansları.
 *
 * GİB fatura numarası: 3 karakterlik seri + 4 hane yıl + 9 hane sıra (16
 * karakter). Yıl sabit bir ön eke ("20") bağlanmaz; makul aralıkta olması
 * yeterlidir. Seride en az bir harf aranır: aksi hâlde 16 haneli kart/hesap
 * numaraları fatura sanılırdı. Bankalar numarayı sıkça harfe yapıştırır
 * ("FTNOSNC2026…", "…001NOLU"), bu yüzden sözcük sınırı yerine örtüşen
 * pencereyle ve yalnız rakam sınırıyla aranır.
 *
 * ETTN (UUID) fatura numarasından ayrı ayrıştırılır ve ayrı sinyaldir.
 */

const FATURA_NO = /(?=([A-Z0-9]{3})(\d{4})(\d{9})(?!\d))/g;
const ETTN = /(?<![0-9A-F])[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}(?![0-9A-F])/gi;

export function faturaNumaralariniBul(metin: string, simdi = new Date()): string[] {
  const ust = metin.toLocaleUpperCase("tr").replace(/İ/g, "I");
  const enGecYil = simdi.getUTCFullYear() + 1;
  const bulunan = new Set<string>();
  for (const m of ust.matchAll(FATURA_NO)) {
    const [, seri, yil, sira] = m;
    if (!/[A-Z]/.test(seri)) continue;
    const y = Number(yil);
    if (y < 2000 || y > enGecYil || /^0+$/.test(sira)) continue;
    bulunan.add(`${seri}${yil}${sira}`);
  }
  return [...bulunan];
}

export function ettnleriBul(metin: string): string[] {
  return [...new Set((metin.match(ETTN) ?? []).map((x) => x.toLowerCase()))];
}
