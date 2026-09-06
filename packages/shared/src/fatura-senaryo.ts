import { istisnaKoduBul, tevkifatKoduBul, tevkifatOraniAyristir } from "./gib-kodlari";

/** UBL'e `InvoiceTypeCode` olarak yazılan GİB senaryosu (FTR-16). */
export type FaturaSenaryosu = "satis" | "iade" | "tevkifat" | "istisna";

/** GİB'in `InvoiceTypeCode` kod listesindeki karşılıkları. */
const UBL_KARSILIGI: Record<FaturaSenaryosu, string> = {
  satis: "SATIS",
  iade: "IADE",
  tevkifat: "TEVKIFAT",
  istisna: "ISTISNA",
};

export function senaryoUblKodu(senaryo: FaturaSenaryosu): string {
  return UBL_KARSILIGI[senaryo];
}

export interface SenaryoSatirGirdi {
  kdvOrani: number;
  tevkifatKodu?: string | null;
  tevkifatOrani?: string | null;
  gibIstisnaKodu?: string | null;
}

const iadeTipi = (tip: string) => tip === "satis_iade" || tip === "alis_iade";

/**
 * Fatura senaryosunu satırlardan türetir (FTR-16).
 *
 * Kullanıcı senaryoyu seçmez: seçilen bir senaryo satırlarla çelişebilir ve
 * buradaki çelişkinin bedeli GİB'in reddettiği bir faturadır. Sıra isterde
 * yazıldığı gibidir — tevkifat, istisna, iade, sonra satış.
 */
export function faturaSenaryosuTuret(tip: string, satirlar: SenaryoSatirGirdi[]): FaturaSenaryosu {
  if (satirlar.some((s) => Boolean(s.tevkifatKodu))) return "tevkifat";
  if (satirlar.some((s) => Number(s.kdvOrani) === 0 && Boolean(s.gibIstisnaKodu))) return "istisna";
  if (iadeTipi(tip)) return "iade";
  return "satis";
}

export interface SenaryoHatasi {
  satirIndeksi: number;
  alan: "gibIstisnaKodu" | "tevkifatKodu" | "tevkifatOrani";
  mesaj: string;
}

/**
 * Satırların GİB kurallarına uygunluğunu denetler (FTR-17, FTR-18, FTR-21).
 * Hem şema doğrulaması hem de arayüzün kaydetme öncesi özeti bu listeyi
 * kullanır, böylece iki taraf aynı kuralı ayrı ayrı yorumlamaz.
 */
export function senaryoHatalari(satirlar: SenaryoSatirGirdi[]): SenaryoHatasi[] {
  const hatalar: SenaryoHatasi[] = [];

  satirlar.forEach((satir, satirIndeksi) => {
    const kdvSifir = Number(satir.kdvOrani) === 0;

    if (kdvSifir && !satir.gibIstisnaKodu) {
      hatalar.push({
        satirIndeksi,
        alan: "gibIstisnaKodu",
        // Sıfır KDV'nin sebebi belgede yazmak zorunda; istisna değilse bile
        // "351 KDV - İstisna Olmayan Diğer" seçilir.
        mesaj: "KDV oranı sıfır olan satırda GİB istisna kodu seçilmelidir",
      });
    }

    if (satir.gibIstisnaKodu) {
      if (!istisnaKoduBul(satir.gibIstisnaKodu)) {
        hatalar.push({ satirIndeksi, alan: "gibIstisnaKodu", mesaj: `Tanımsız GİB istisna kodu: ${satir.gibIstisnaKodu}` });
      } else if (!kdvSifir) {
        hatalar.push({ satirIndeksi, alan: "gibIstisnaKodu", mesaj: "İstisna kodu yalnızca KDV oranı sıfır olan satırda kullanılabilir" });
      }
    }

    if (satir.tevkifatKodu) {
      const kod = tevkifatKoduBul(satir.tevkifatKodu);
      if (!kod) {
        hatalar.push({ satirIndeksi, alan: "tevkifatKodu", mesaj: `Tanımsız GİB tevkifat kodu: ${satir.tevkifatKodu}` });
      } else if (kod.oranlar.length > 1) {
        // Yalnız "650 Diğerleri" birden çok oranla kullanılabiliyor; oran yine
        // listeden seçilir, serbest girilmez.
        if (!satir.tevkifatOrani) {
          hatalar.push({ satirIndeksi, alan: "tevkifatOrani", mesaj: `${kod.kod} kodu için tevkifat oranı seçilmelidir` });
        } else if (!kod.oranlar.includes(satir.tevkifatOrani)) {
          hatalar.push({ satirIndeksi, alan: "tevkifatOrani", mesaj: `${kod.kod} kodu için geçersiz tevkifat oranı: ${satir.tevkifatOrani}` });
        }
      } else if (satir.tevkifatOrani && satir.tevkifatOrani !== kod.oranlar[0]) {
        hatalar.push({ satirIndeksi, alan: "tevkifatOrani", mesaj: `${kod.kod} kodunun oranı ${kod.oranlar[0]} olmalıdır` });
      }

      if (kdvSifir) {
        hatalar.push({ satirIndeksi, alan: "tevkifatKodu", mesaj: "KDV oranı sıfır olan satırda tevkifat uygulanamaz" });
      }
    }
  });

  return hatalar;
}

/**
 * Satırın tevkifat oranını koddan çözer (FTR-18). Kullanıcı pay/payda girmez;
 * bu değerler koddan türer ve hesaplamaya öyle girer.
 */
export function tevkifatPayPayda(
  tevkifatKodu: string | null | undefined,
  tevkifatOrani?: string | null,
): { pay: number; payda: number } | undefined {
  const kod = tevkifatKoduBul(tevkifatKodu);
  if (!kod) return undefined;
  const oran = kod.oranlar.length === 1 ? kod.oranlar[0] : tevkifatOrani;
  return oran ? tevkifatOraniAyristir(oran) : undefined;
}
