/**
 * Yatırım Teşvik Belgesi (YTB) kapsamında düzenlenen faturalar
 * (GİB "Yatırım Teşvik Kapsamında Yapılan Teslimlere İlişkin Fatura Teknik
 * Kılavuzu" **v1.2**, Ocak 2026 — `docs/e-belge/Yatirim-Tesvik-Fatura-Teknik-
 * Kilavuzu-v1.2.pdf`; v1.1'e göre tevkifat tipleri eklendi ve makine adı
 * `Item/Name`'den `Item/ModelName`'e taşındı).
 *
 * YTB bir **profildir**, fatura tipi değil — İDİS'teki kalıbın aynısı
 * (EBLG-72): belge `ProfileID=YATIRIMTESVIK` ile gider, `InvoiceTypeCode`
 * normal kurallarla türer. Alıcı e-Fatura mükellefi değilse belge e-Arşiv'e
 * düşer; orada profil `EARSIVFATURA` olur ve **tipin başına `YTB` gelir**
 * (SATIS → YTBSATIS, ISTISNA → YTBISTISNA …).
 *
 * Ayrı bir işaret yoktur: **teşvik belge numarası girildiyse fatura YTB
 * kapsamındadır.**
 */

export const YTB_PROFILI = "YATIRIMTESVIK";

/** e-Arşiv'de YTB tipleri bu önekle yazılır (YTBSATIS, YTBISTISNA …). */
export const YTB_TIP_ONEKI = "YTB";

/** Kılavuz §2: YTB senaryosunda kullanılabilen fatura tipleri. */
export const YTB_FATURA_TIPLERI = ["SATIS", "ISTISNA", "TEVKIFAT", "TEVKIFATIADE", "IADE"] as const;

/**
 * Harcama tipi (`Item/CommodityClassification/cbc:ItemClassificationCode`).
 * YTB faturasında **en az bir satırda** bulunmak zorundadır.
 */
export const YTB_HARCAMA_TIPLERI = [
  { kod: "01", ad: "Makine-teçhizat, yazılım ve gayrimaddi hak", istisnaKodu: "308", kdvsizOlabilir: true },
  { kod: "02", ad: "İnşaat işleri mal teslimi ve hizmet ifası", istisnaKodu: "339", kdvsizOlabilir: true },
  { kod: "03", ad: "Arsa / arazi satışı", istisnaKodu: null, kdvsizOlabilir: false },
  { kod: "04", ad: "Diğer yatırım harcamaları", istisnaKodu: null, kdvsizOlabilir: false },
] as const;

export type YtbHarcamaTipi = (typeof YTB_HARCAMA_TIPLERI)[number]["kod"];

/** Makine ID ve sıra no yalnız bu harcama tipinde istenir. */
export const YTB_MAKINE_HARCAMA_TIPI: YtbHarcamaTipi = "01";

export const ytbHarcamaTipiBul = (kod: string | null | undefined) =>
  YTB_HARCAMA_TIPLERI.find((h) => h.kod === kod);

export const ytbNormalize = (deger: string | null | undefined): string => (deger ?? "").trim();

/** Teşvik belge numarası girilmiş fatura YTB kapsamındadır. */
export function ytbBelgesiMi(ytbNo: string | null | undefined): boolean {
  return ytbNormalize(ytbNo).length > 0;
}

/**
 * e-Arşiv'e düşen YTB faturasının tipi. Kılavuz e-Arşiv tarafında YTB önekli
 * tipleri ister; e-Faturada tip olduğu gibi kalır.
 */
export function ytbFaturaTipi(tip: string, tur: "efatura" | "earsiv"): string {
  if (tur !== "earsiv") return tip;
  return (YTB_FATURA_TIPLERI as readonly string[]).includes(tip) ? `${YTB_TIP_ONEKI}${tip}` : tip;
}

export interface YtbSatirGirdi {
  sira: number;
  harcamaTipi?: string | null;
  makineAdi?: string | null;
  makineId?: string | null;
  makineSiraNo?: string | null;
  kdvOrani: number;
  gibIstisnaKodu?: string | null;
}

export interface YtbBilgisi {
  ytbNo?: string | null;
  ytbTarihi?: Date | string | null;
  /** Belgenin gideceği kanal; e-Arşiv'de tipler YTB önekli olur. */
  tur?: "efatura" | "earsiv";
  satirlar?: YtbSatirGirdi[];
}

export interface YtbEngel {
  alan: string;
  mesaj: string;
  satirIndeksi?: number;
}

/**
 * Gönderimi durduran eksikler (kılavuz §2 ve §2.1.5). Boş dizi dönerse belge
 * gönderilebilir. YTB numarası yoksa fatura zaten YTB kapsamında değildir ve
 * hiçbir kural çalışmaz.
 */
export function ytbEngelleri(bilgi: YtbBilgisi): YtbEngel[] {
  if (!ytbBelgesiMi(bilgi.ytbNo)) return [];
  const engeller: YtbEngel[] = [];
  const satirlar = bilgi.satirlar ?? [];

  if (!bilgi.ytbTarihi) {
    engeller.push({ alan: "ytbTarihi", mesaj: "Yatırım teşvik belge tarihi zorunludur." });
  }

  // Harcama tipi belgede en az bir satırda bulunmalı; girilen her değer de
  // listeden olmalı.
  if (!satirlar.some((s) => ytbHarcamaTipiBul(s.harcamaTipi))) {
    engeller.push({ alan: "harcamaTipi", mesaj: "Yatırım teşvik faturasında en az bir satıra harcama tipi (01–04) girilmelidir." });
  }

  for (const [indeks, satir] of satirlar.entries()) {
    const harcama = ytbHarcamaTipiBul(satir.harcamaTipi);
    if (satir.harcamaTipi && !harcama) {
      engeller.push({ alan: "harcamaTipi", satirIndeksi: indeks, mesaj: `${satir.sira}. satırdaki harcama tipi tanımsız; 01–04 arasından seçin.` });
      continue;
    }
    if (!harcama) continue;

    // Arsa/arazi ve diğer harcamalar KDV'siz düzenlenemez (kılavuz §2).
    if (!harcama.kdvsizOlabilir && satir.kdvOrani === 0) {
      engeller.push({
        alan: "kdv",
        satirIndeksi: indeks,
        mesaj: `${satir.sira}. satır ${harcama.ad} kapsamında; bu harcama tipi KDV'siz düzenlenemez.`,
      });
    }

    // KDV sıfırsa istisna kodu harcama tipinin kodu olmalı (01 → 308, 02 → 339).
    if (harcama.kdvsizOlabilir && satir.kdvOrani === 0 && satir.gibIstisnaKodu !== harcama.istisnaKodu) {
      engeller.push({
        alan: "istisnaKodu",
        satirIndeksi: indeks,
        mesaj: `${satir.sira}. satır KDV'siz düzenlendiği için istisna kodu ${harcama.istisnaKodu} olmalıdır (${harcama.ad}).`,
      });
    }

    // Makine-teçhizat satırında makine kimliği zorunludur.
    if (harcama.kod === YTB_MAKINE_HARCAMA_TIPI) {
      if (!ytbNormalize(satir.makineAdi)) {
        engeller.push({ alan: "makineAdi", satirIndeksi: indeks, mesaj: `${satir.sira}. satırda makine adı zorunludur.` });
      }
      if (!ytbNormalize(satir.makineId)) {
        engeller.push({ alan: "makineId", satirIndeksi: indeks, mesaj: `${satir.sira}. satırda makine ID zorunludur.` });
      }
      if (!ytbNormalize(satir.makineSiraNo)) {
        engeller.push({ alan: "makineSiraNo", satirIndeksi: indeks, mesaj: `${satir.sira}. satırda makine teçhizat sıra no zorunludur.` });
      }
    }
  }

  return engeller;
}

/**
 * Vazgeçilen KDV (kılavuz §2.1.4): istisna tipindeki YTB faturasında, KDV
 * alınmasaydı ne kadar olacağı belgeye yazılır. Oran satırın kendi oranı değil
 * — o sıfırdır — stok kartındaki normal KDV oranıdır. Tutar fatura toplamına
 * **eklenmez**; UBL'de `CalculationSequenceNumeric = -1` bunu söyler.
 */
export const VAZGECILEN_KDV_SIRA_NO = -1;

export function vazgecilenKdv(matrah: number, oran: number): number {
  return Math.round(matrah * (oran / 100) * 100) / 100;
}
