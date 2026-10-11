import type { Prisma } from "@prisma/client";
import type { Rol } from "@tekirextra/shared";

/**
 * Ortak rapor araç seti kayıt defteri (RPR-06, MIMARI §4.4).
 *
 * Her modül raporunu bildirimsel tanımla ekler: filtre/gruplama/kolon
 * meta verisi + veri fonksiyonu. Doğrulama, sıralama, Excel dışa aktarım
 * (RPR-04) ve kayıtlı görünümler altyapıdan gelir; PDF, şablon altyapısıyla
 * 4. aşamada eklenir (T-02).
 */

export type RaporKolonTip = "metin" | "sayi" | "para" | "yuzde" | "tarih";

export interface RaporKolon {
  alan: string;
  baslik: string;
  tip: RaporKolonTip;
  /** Para sütunu TL değilse dövizi taşıyan satır alanı (ör. "dovizCinsi"). */
  dovizAlani?: string;
  /** RPR-09: hücre, satırın bu alanındaki panel yoluna bağlantı olur (ör. faturaya); dışa aktarımda yok sayılır. */
  baglantiAlani?: string;
}

/** cari/stok/depo/etiket tipleri arayüzde ilgili kayıt listesinden seçim kutusu çizer. */
export type RaporFiltreTip =
  | "tarih"
  | "metin"
  | "sayi"
  | "secim"
  | "onay"
  | "cari"
  | "stok"
  | "depo"
  | "etiket"
  /** KSB-14: kasa/banka/POS hesabı; değer "kasa:<id>", "banka:<id>" ya da "pos:<id>". */
  | "hesap";

export interface RaporFiltreTanimi {
  alan: string;
  ad: string;
  tip: RaporFiltreTip;
  zorunlu?: boolean;
  secenekler?: { deger: string; ad: string }[];
}

export type RaporFiltreDegerleri = Record<
  string,
  string | number | boolean | undefined
>;

export interface RaporGirdisi {
  filtreler?: RaporFiltreDegerleri;
  gruplama?: string;
  siralama?: { alan: string; yon: "asc" | "desc" };
}

export interface RaporBaglami {
  tenantId: string;
  tx: Prisma.TransactionClient;
}

export type RaporSatiri = Record<string, string | number | boolean | null>;

export interface RaporTanimi {
  kod: string; // "cari.yaslandirma"
  modul: "cari" | "stok" | "fatura" | "genel" | "urun_hareket" | "kasa_banka" | "vergi";
  ad: string;
  aciklama?: string;
  filtreler: RaporFiltreTanimi[];
  gruplamalar?: { deger: string; ad: string }[];
  kolonlar: RaporKolon[];
  /** RPR-09: verilirse yalnız bu roller görür ve çalıştırır; verilmezse rapor erişimi olan herkes. */
  roller?: readonly Rol[];
  calistir: (girdi: RaporGirdisi, bag: RaporBaglami) => Promise<RaporSatiri[]>;
}

const tanimlar = new Map<string, RaporTanimi>();

export function registerRapor(tanim: RaporTanimi): void {
  if (tanimlar.has(tanim.kod)) {
    throw new Error(`'${tanim.kod}' raporu zaten kayıtlı`);
  }
  tanimlar.set(tanim.kod, tanim);
}

export function raporTanimiAl(kod: string): RaporTanimi | undefined {
  return tanimlar.get(kod);
}

export function raporTanimlari(modul?: string): RaporTanimi[] {
  const hepsi = [...tanimlar.values()];
  return modul ? hepsi.filter((t) => t.modul === modul) : hepsi;
}

const TARIH_DESENI = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Girdiyi tanıma göre doğrular; hata mesajlarını döner (boşsa geçerli).
 * Bilinmeyen filtre alanları reddedilir (asıl denetim sunucuda — AYR-06 ruhu).
 */
export function girdiDogrula(tanim: RaporTanimi, girdi: RaporGirdisi): string[] {
  const hatalar: string[] = [];
  const filtreler = girdi.filtreler ?? {};

  for (const alan of Object.keys(filtreler)) {
    if (!tanim.filtreler.some((f) => f.alan === alan)) {
      hatalar.push(`Bilinmeyen filtre: ${alan}`);
    }
  }

  for (const f of tanim.filtreler) {
    const deger = filtreler[f.alan];
    if (deger === undefined || deger === "") {
      if (f.zorunlu) hatalar.push(`'${f.ad}' filtresi zorunludur`);
      continue;
    }
    switch (f.tip) {
      case "tarih":
        if (typeof deger !== "string" || !TARIH_DESENI.test(deger)) {
          hatalar.push(`'${f.ad}' YYYY-MM-DD biçiminde olmalıdır`);
        }
        break;
      case "sayi":
        if (typeof deger !== "number" || Number.isNaN(deger)) {
          hatalar.push(`'${f.ad}' sayısal olmalıdır`);
        }
        break;
      case "onay":
        if (typeof deger !== "boolean") {
          hatalar.push(`'${f.ad}' true/false olmalıdır`);
        }
        break;
      case "hesap":
        if (typeof deger !== "string" || !/^(kasa|banka|pos):[0-9a-f-]{36}$/i.test(deger)) {
          hatalar.push(`'${f.ad}' geçersiz hesap`);
        }
        break;
      case "secim":
        if (!f.secenekler?.some((s) => s.deger === deger)) {
          hatalar.push(`'${f.ad}' için geçersiz seçim: ${String(deger)}`);
        }
        break;
      default:
        if (typeof deger !== "string") {
          hatalar.push(`'${f.ad}' metin olmalıdır`);
        }
    }
  }

  if (girdi.gruplama !== undefined) {
    if (!tanim.gruplamalar?.some((g) => g.deger === girdi.gruplama)) {
      hatalar.push(`Geçersiz gruplama: ${girdi.gruplama}`);
    }
  }

  if (girdi.siralama !== undefined) {
    if (!tanim.kolonlar.some((k) => k.alan === girdi.siralama?.alan)) {
      hatalar.push(`Geçersiz sıralama alanı: ${girdi.siralama.alan}`);
    }
    if (!["asc", "desc"].includes(girdi.siralama.yon)) {
      hatalar.push("Sıralama yönü asc/desc olmalıdır");
    }
  }

  return hatalar;
}

/** Kolon tipine göre sıralar: sayısal tipler sayı, kalanı yerelli metin. */
export function siralamaUygula(
  tanim: RaporTanimi,
  satirlar: RaporSatiri[],
  siralama?: { alan: string; yon: "asc" | "desc" },
): RaporSatiri[] {
  if (!siralama) return satirlar;
  const kolon = tanim.kolonlar.find((k) => k.alan === siralama.alan);
  if (!kolon) return satirlar;
  const sayisal = ["sayi", "para", "yuzde"].includes(kolon.tip);
  const isaret = siralama.yon === "desc" ? -1 : 1;
  return [...satirlar].sort((a, b) => {
    const x = a[siralama.alan];
    const y = b[siralama.alan];
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    if (sayisal) return isaret * (Number(x) - Number(y));
    return isaret * String(x).localeCompare(String(y), "tr");
  });
}

/** Yalnızca testlerin kullandığı sıfırlama. */
export function _tumRaporlariTemizle(): void {
  tanimlar.clear();
}
