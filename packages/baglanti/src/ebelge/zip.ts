import { inflateRawSync } from "node:zlib";

/**
 * ZIP yardımcıları. Entegratörlerin çoğu UBL'i ZIP içinde alıp verdiği için
 * bu iki işlem adaptörler arasında ortaktır; harici bağımlılık kullanılmaz.
 */

/** Tek/çok dosyalı ZIP'in ilk girdisini açar; ZIP değilse düz XML kabul eder. */
export function zipIlkXmlBuffer(zip: Buffer): string {
  if (zip.subarray(0, 4).toString("hex") !== "504b0304") {
    const duz = zip.toString("utf8");
    if (duz.trimStart().startsWith("<")) return duz;
    throw new Error("Belge verisi ZIP veya XML biçiminde değil");
  }
  const metod = zip.readUInt16LE(8);
  const sikismisBoyut = zip.readUInt32LE(18);
  const adBoyutu = zip.readUInt16LE(26);
  const ekBoyutu = zip.readUInt16LE(28);
  const baslangic = 30 + adBoyutu + ekBoyutu;
  const veri = zip.subarray(baslangic, baslangic + sikismisBoyut);
  if (metod === 0) return veri.toString("utf8");
  if (metod === 8) return inflateRawSync(veri).toString("utf8");
  throw new Error(`Desteklenmeyen ZIP sıkıştırma yöntemi: ${metod}`);
}

/** Base64 taşınan ZIP'in ilk XML girdisini açar. */
export function zipIlkXml(base64: string): string {
  return zipIlkXmlBuffer(Buffer.from(base64.replace(/\s/g, ""), "base64"));
}

function crc32(veri: Uint8Array): number {
  let crc = 0xffffffff;
  for (const bayt of veri) {
    crc ^= bayt;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function le16(deger: number): Uint8Array {
  return Uint8Array.of(deger & 255, (deger >>> 8) & 255);
}

function le32(deger: number): Uint8Array {
  return Uint8Array.of(deger & 255, (deger >>> 8) & 255, (deger >>> 16) & 255, (deger >>> 24) & 255);
}

function birlestir(...parcalar: Uint8Array[]): Uint8Array {
  const sonuc = new Uint8Array(parcalar.reduce((toplam, parca) => toplam + parca.length, 0));
  let konum = 0;
  for (const parca of parcalar) { sonuc.set(parca, konum); konum += parca.length; }
  return sonuc;
}

/** Harici bağımlılık olmadan, tek dosyalı ve sıkıştırmasız geçerli ZIP üretir. */
export function tekDosyaZipBase64(dosyaAdi: string, icerik: string): string {
  const kodlayici = new TextEncoder();
  const ad = kodlayici.encode(dosyaAdi);
  const veri = kodlayici.encode(icerik);
  const crc = crc32(veri);
  const ortak = birlestir(le16(20), le16(0x0800), le16(0), le16(0), le16(0), le32(crc), le32(veri.length), le32(veri.length), le16(ad.length), le16(0));
  const yerel = birlestir(le32(0x04034b50), ortak, ad, veri);
  const merkez = birlestir(le32(0x02014b50), le16(20), ortak, le16(0), le16(0), le16(0), le32(0), le32(0), ad);
  const son = birlestir(le32(0x06054b50), le16(0), le16(0), le16(1), le16(1), le32(merkez.length), le32(yerel.length), le16(0));
  return Buffer.from(birlestir(yerel, merkez, son)).toString("base64");
}
