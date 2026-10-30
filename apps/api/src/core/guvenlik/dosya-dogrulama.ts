import { BadRequestException } from "@nestjs/common";
import { yuklemeDenetle, type DosyaProfili } from "./dosya-denetimi";

/**
 * Yükleme uçlarının kapısı. İçerik `dosya-denetimi.ts` ile denetlenir (tür
 * imzadan, profil izinleri, arşiv/makro/PDF eylemi/çalıştırılabilir dosya
 * reddi) ve `CLAMAV_HOST` tanımlıysa ClamAV ile taranır. Saklanacak MIME türü
 * tarayıcının bildirdiğinden değil içerikten gelir.
 */
export interface YuklemeDosyasi {
  originalname: string;
  mimetype?: string;
  buffer: Buffer;
}

/** Ek ve belge yükleme; dönen değer saklanacak (içerikten belirlenen) MIME türü. */
export async function dosyaIceriginiDogrula(dosya: { buffer: Buffer; originalname?: string; mimetype?: string }, profil: DosyaProfili = "belge"): Promise<string> {
  return (await yuklemeDenetle(dosya, profil)).mimetype;
}

/** Excel içe aktarma (cari, stok, puantaj): yalnız .xlsx. */
export async function excelDosyasiniDogrula(dosya: YuklemeDosyasi): Promise<void> {
  if (!dosya.originalname.toLocaleLowerCase("tr-TR").endsWith(".xlsx")) {
    throw new BadRequestException("Yalnızca .xlsx biçiminde Excel dosyası yüklenebilir");
  }
  await yuklemeDenetle(dosya, "excel");
}

/** KSB-06/KSB-32/KSB-34: banka ekstresi .csv/.txt/.xlsx, MT940 (.sta/.mt940/.940), camt.052/053 (.xml) ya da metin katmanlı PDF; eski .xls desteklenmez. */
const EKSTRE_UZANTILARI = [".xlsx", ".csv", ".txt", ".sta", ".mt940", ".940", ".xml", ".pdf"];
export async function ekstreDosyasiniDogrula(dosya: YuklemeDosyasi): Promise<void> {
  const uzanti = dosya.originalname.toLocaleLowerCase("tr-TR");
  if (!EKSTRE_UZANTILARI.some((u) => uzanti.endsWith(u))) {
    throw new BadRequestException("Banka ekstresi .csv, .txt, .xlsx, MT940 (.sta, .mt940, .940), camt.053 (.xml) ya da PDF biçiminde yüklenebilir");
  }
  await yuklemeDenetle(dosya, "ekstre");
}
