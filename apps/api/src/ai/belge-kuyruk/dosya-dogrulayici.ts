import crypto from "node:crypto";
import { BadRequestException } from "@nestjs/common";

export const AZAMI_DOSYA_BOYUTU = 15 * 1024 * 1024; // 15 MB
export const AZAMI_TOPLU_ADET = 20;
export const AZAMI_PDF_SAYFA = 10;

export type DesteklenenMimeTipi =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export interface DogrulanmisDosya {
  mimeTip: DesteklenenMimeTipi;
  dosyaBoyutu: number;
  dosyaHash: string;
  sayfaSayisi: number;
  hamMetin: string | null;
  sayfaMetinleri?: Record<number, string>;
}

/**
 * Gerçek dosya türünü başlık (magic bytes) imzasına göre doğrular.
 * Sahte veya desteklenmeyen uzantıları reddeder.
 */
export function magicBytesMimeBelirle(tampon: Buffer): DesteklenenMimeTipi {
  if (
    tampon.length >= 5 &&
    tampon[0] === 0x25 &&
    tampon[1] === 0x50 &&
    tampon[2] === 0x44 &&
    tampon[3] === 0x46 &&
    tampon[4] === 0x2d
  ) {
    return "application/pdf";
  }
  if (
    tampon.length >= 3 &&
    tampon[0] === 0xff &&
    tampon[1] === 0xd8 &&
    tampon[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    tampon.length >= 8 &&
    tampon[0] === 0x89 &&
    tampon[1] === 0x50 &&
    tampon[2] === 0x4e &&
    tampon[3] === 0x47 &&
    tampon[4] === 0x0d &&
    tampon[5] === 0x0a &&
    tampon[6] === 0x1a &&
    tampon[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    tampon.length >= 12 &&
    tampon.subarray(0, 4).toString("ascii") === "RIFF" &&
    tampon.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  throw new BadRequestException(
    "Desteklenmeyen dosya türü. Yalnızca PDF, JPEG, PNG veya WEBP formatındaki belgeler kabul edilir.",
  );
}

/**
 * PDF dosyasının sayfa sayısını ve dijital metin katmanını ayıklar.
 * Azami sayfa sınırını aşarsa hata fırlatır.
 */
export async function pdfBilgileriniCikar(
  tampon: Buffer,
  azamiSayfa: number = AZAMI_PDF_SAYFA,
): Promise<{ sayfaSayisi: number; hamMetin: string | null; sayfaMetinleri: Record<number, string> }> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const yukleme = pdfjs.getDocument({
      data: new Uint8Array(tampon),
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    });
    const doc = await yukleme.promise;
    const sayfaSayisi = doc.numPages;

    if (sayfaSayisi > azamiSayfa) {
      throw new BadRequestException(
        `PDF belgesi ${sayfaSayisi} sayfa içeriyor. Azami izin verilen sayfa sınırı ${azamiSayfa}'dur.`,
      );
    }

    let birlesikMetin = "";
    const sayfaMetinleri: Record<number, string> = {};

    for (let sayfaNo = 1; sayfaNo <= sayfaSayisi; sayfaNo++) {
      const sayfa = await doc.getPage(sayfaNo);
      const icerik = await sayfa.getTextContent();
      const metinler = icerik.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter((s) => s.trim().length > 0);
      sayfa.cleanup();

      if (metinler.length > 0) {
        const sayfaMetni = metinler.join(" ");
        sayfaMetinleri[sayfaNo] = sayfaMetni;
        birlesikMetin += `\n[Sayfa ${sayfaNo}]\n` + sayfaMetni;
      }
    }

    const temiz = birlesikMetin.replace(/\s+/g, " ").trim();
    return {
      sayfaSayisi,
      hamMetin: temiz.length >= 20 ? temiz : null,
      sayfaMetinleri,
    };
  } catch (hata) {
    if (hata instanceof BadRequestException) throw hata;
    // PDF bozuksa veya şifreliyse
    throw new BadRequestException("PDF dosyası okunamadı veya şifreli.");
  }
}

/**
 * Yüklenen dosya tamponunu doğrular, hash ve sayfa sayısını çıkarır.
 */
export async function belgeDosyasiniDogrula(tampon: Buffer): Promise<DogrulanmisDosya> {
  if (!tampon || tampon.length === 0) {
    throw new BadRequestException("Dosya içeriği boş olamaz.");
  }
  if (tampon.length > AZAMI_DOSYA_BOYUTU) {
    throw new BadRequestException(
      `Dosya boyutu (${(tampon.length / (1024 * 1024)).toFixed(1)} MB) azami izin verilen ${AZAMI_DOSYA_BOYUTU / (1024 * 1024)} MB sınırını aşıyor.`,
    );
  }

  const mimeTip = magicBytesMimeBelirle(tampon);
  const dosyaHash = crypto.createHash("sha256").update(tampon).digest("hex");

  if (mimeTip === "application/pdf") {
    const pdfBilgi = await pdfBilgileriniCikar(tampon);
    return {
      mimeTip,
      dosyaBoyutu: tampon.length,
      dosyaHash,
      sayfaSayisi: pdfBilgi.sayfaSayisi,
      hamMetin: pdfBilgi.hamMetin,
      sayfaMetinleri: pdfBilgi.sayfaMetinleri,
    };
  }

  return {
    mimeTip,
    dosyaBoyutu: tampon.length,
    dosyaHash,
    sayfaSayisi: 1,
    hamMetin: null,
  };
}
