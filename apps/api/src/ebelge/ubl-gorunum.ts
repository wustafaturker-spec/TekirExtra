import { XMLParser } from "fast-xml-parser";

/**
 * EBLG-28: UBL belgesine gömülü görünüm (XSLT) eklentisini çıkarır.
 *
 * UBL-TR'de gönderen, belgesinin nasıl görüneceğini `DocumentTypeCode = XSLT`
 * olan bir `AdditionalDocumentReference` içinde base64 olarak taşır. Belgeyi bu
 * dönüşümle basmak, alıcının gönderenin tasarladığı resmî görünümü görmesini
 * sağlar — e-fatura görüntüleyicilerinin yaptığı iş budur.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

type Dugum = Record<string, unknown>;

const nesne = (deger: unknown): Dugum | undefined =>
  deger !== null && typeof deger === "object" && !Array.isArray(deger) ? (deger as Dugum) : undefined;

const dizi = (deger: unknown): Dugum[] => {
  if (deger === undefined || deger === null) return [];
  if (Array.isArray(deger)) return deger.filter((d) => nesne(d) !== undefined) as Dugum[];
  const n = nesne(deger);
  return n ? [n] : [];
};

const metin = (deger: unknown): string => {
  if (typeof deger === "string") return deger.trim();
  const n = nesne(deger);
  if (n && "#text" in n) return String(n["#text"] ?? "").trim();
  return "";
};

/** Base64 çözümü; içerik XSLT'ye benzemiyorsa yok sayılır. */
function xsltCoz(base64: string): string | null {
  if (!base64) return null;
  let cozulmus: string;
  try {
    cozulmus = Buffer.from(base64, "base64").toString("utf8");
  } catch {
    return null;
  }
  return cozulmus.includes("stylesheet") || cozulmus.includes("transform") ? cozulmus : null;
}

/**
 * Belgedeki gömülü XSLT'yi döner; yoksa `null`. Bulunamaması hata değildir —
 * çağıran kendi yedek görünümüne düşer (EBLG-28).
 */
export function gomuluXsltCikar(xml: string): string | null {
  let kok: Dugum | undefined;
  try {
    kok = nesne(parser.parse(xml));
  } catch {
    return null;
  }
  // Fatura, irsaliye ve uygulama yanıtı aynı eklenti yapısını kullanır.
  const belge = nesne(kok?.Invoice) ?? nesne(kok?.DespatchAdvice) ?? nesne(kok?.ApplicationResponse);
  if (!belge) return null;

  for (const ek of dizi(belge.AdditionalDocumentReference)) {
    // Eklentinin türü iki ayrı alanda bildirilebiliyor: UBL-TR uygulamalarının
    // neredeyse tamamı `DocumentType` yazar (gelen 54 belgenin 53'ü), OASIS
    // alanı `DocumentTypeCode` ise bizim ürettiğimiz belgelerde bulunur.
    const tur = (metin(ek.DocumentType) || metin(ek.DocumentTypeCode)).toUpperCase();
    if (tur !== "XSLT") continue;
    const ikili = nesne(ek.Attachment)?.EmbeddedDocumentBinaryObject;
    const xslt = xsltCoz(metin(ikili));
    if (xslt) return xslt;
  }
  return null;
}
