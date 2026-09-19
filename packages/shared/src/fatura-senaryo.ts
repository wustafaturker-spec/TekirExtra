import { type IstisnaKodu, KDV_ISTISNA_KODLARI, ihracKayitliKoduBul, istisnaKoduBul, tevkifatKoduBul, tevkifatOraniAyristir } from "./gib-kodlari";

/** UBL'e `InvoiceTypeCode` olarak yazılan GİB senaryosu (FTR-16). */
export type FaturaSenaryosu = "satis" | "iade" | "tevkifat" | "tevkifatiade" | "istisna" | "ihrackayitli";

/** GİB'in `InvoiceTypeCode` kod listesindeki karşılıkları. */
const UBL_KARSILIGI: Record<FaturaSenaryosu, string> = {
  satis: "SATIS",
  iade: "IADE",
  tevkifat: "TEVKIFAT",
  tevkifatiade: "TEVKIFATIADE",
  istisna: "ISTISNA",
  ihrackayitli: "IHRACKAYITLI",
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
 * "351 KDV - İstisna Olmayan Diğer" istisna değildir: şematron onu her tipte
 * kabul eder, faturayı ISTISNA yapmaz (EBLG-59). 201–350 ise yalnız ISTISNA,
 * IADE ve bizim desteklemediğimiz birkaç tipte geçer.
 */
export const ISTISNA_OLMAYAN_KOD = "351";

const istisnaSayilir = (kod: string | null | undefined) => Boolean(kod) && kod !== ISTISNA_OLMAYAN_KOD;

/**
 * Fatura senaryosunu satırlardan türetir (FTR-16).
 *
 * Kullanıcı senaryoyu seçmez: seçilen bir senaryo satırlarla çelişebilir ve
 * buradaki çelişkinin bedeli GİB'in reddettiği bir faturadır. Sıra isterde
 * yazıldığı gibidir — tevkifat, iade, istisna, sonra satış.
 *
 * EBLG-59 (GİB şematronu, NES önizlemesiyle denendi): iade, istisna kodu
 * taşısa da IADE kalır — IADE tipi 201–350 kodlarını kabul eder ve iade
 * referansı yalnız bu tipte anlamlıdır. 351 faturayı ISTISNA yapmaz.
 */
export function faturaSenaryosuTuret(tip: string, satirlar: SenaryoSatirGirdi[], ihracKayitliKodu?: string | null): FaturaSenaryosu {
  // EBLG-60: ihraç kayıtlı satış faturada işaretlenir; satırlardan türemez.
  if (ihracKayitliKodu && tip === "satis") return "ihrackayitli";
  /*
   * EBLG-61: tevkifatlı faturanın iadesi TEVKIFATIADE'dir ve tevkifatsız
   * düzenlenir — belgede yalnız satıcıya ödenmiş (tevkif dışı) KDV görünür.
   * Şematron bu tipte tevkifat bloğunu reddeder (NES önizlemesi, 2026-09-19).
   */
  if (satirlar.some((s) => Boolean(s.tevkifatKodu))) return iadeTipi(tip) ? "tevkifatiade" : "tevkifat";
  if (iadeTipi(tip)) return "iade";
  if (satirlar.some((s) => Number(s.kdvOrani) === 0 && istisnaSayilir(s.gibIstisnaKodu))) return "istisna";
  return "satis";
}

/**
 * Faturada seçilebilecek KDV istisna kodları (EBLG-59). Şematron 201–350'yi
 * TEVKIFAT tipinde kabul etmez; satırlardan biri tevkifatlıysa sıfır KDV'li
 * satırlar için yalnız 351 kalır. Arayüz listeyi, şema doğrulaması seçimi bu
 * işlevle denetler.
 */
export function izinliIstisnaKodlari(satirlar: Pick<SenaryoSatirGirdi, "tevkifatKodu">[]): readonly IstisnaKodu[] {
  return satirlar.some((s) => Boolean(s.tevkifatKodu))
    ? KDV_ISTISNA_KODLARI.filter((k) => k.kod === ISTISNA_OLMAYAN_KOD)
    : KDV_ISTISNA_KODLARI;
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
  const tevkifatli = satirlar.some((s) => Boolean(s.tevkifatKodu));

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
      } else if (tevkifatli && istisnaSayilir(satir.gibIstisnaKodu)) {
        hatalar.push({
          satirIndeksi,
          alan: "gibIstisnaKodu",
          mesaj: `Tevkifatlı faturada ${satir.gibIstisnaKodu} kullanılamaz; KDV'si sıfır satır için ${ISTISNA_OLMAYAN_KOD} seçin ya da istisnalı satırları ayrı faturaya alın`,
        });
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
 * İhraç kayıtlı satışın fatura düzeyindeki kuralları (EBLG-60). Kod yalnız
 * satış faturasında anlamlıdır; tevkifatla birlikte olamaz, çünkü KDV zaten
 * tahsil edilmez. Şema doğrulaması ile fatura ekranı aynı listeyi kullanır.
 */
export function ihracKayitliHatalari(fatura: {
  tip: string;
  ihracKayitliKodu?: string | null;
  satirlar: Pick<SenaryoSatirGirdi, "tevkifatKodu">[];
}): string[] {
  if (!fatura.ihracKayitliKodu) return [];
  const hatalar: string[] = [];
  if (!ihracKayitliKoduBul(fatura.ihracKayitliKodu)) hatalar.push(`Tanımsız ihraç kayıtlı kodu: ${fatura.ihracKayitliKodu}`);
  if (fatura.tip !== "satis") hatalar.push("İhraç kayıtlı yalnız satış faturasında seçilebilir");
  if (fatura.satirlar.some((s) => Boolean(s.tevkifatKodu))) {
    hatalar.push("İhraç kayıtlı satışta KDV tahsil edilmez; tevkifat uygulanamaz");
  }
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
