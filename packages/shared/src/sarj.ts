/**
 * Elektrikli araç şarj faturaları (14.09.2026 şematronu §1;
 * `docs/e-belge/SEMATRONDEGISIKLIKLERI_484.pdf`).
 *
 * İki tür vardır ve ikisi de e-Arşiv'de de geçerlidir: **SARJ** (araca verilen
 * şarj hizmeti) ve **SARJANLIK** (şarj ünitesi/işletmeciliği). Her ikisinde
 * şarj edilen aracın **plakası**, şarjın **başlangıç ve bitiş tarih-saati**
 * zorunludur; SARJ'da ayrıca ESU rapor kimliği (GUID), SARJANLIK'ta satırda
 * şarj ünitesinin seri numarası aranır.
 *
 * Karar (2026-09-20): tür **stok kartından türer** — hizmet kartına konan
 * işaret satıra düştüğünde fatura tipi kendiliğinden SARJ ya da SARJANLIK
 * olur; kullanıcı fatura tipini seçmez (S-01). Diğer alanlar sihirbazda
 * toplanır, ünite seri numarası satırda girilir.
 */

export const SARJ_TURLERI = ["sarj", "sarjanlik"] as const;
export type SarjTuru = (typeof SARJ_TURLERI)[number];

/**
 * Şarj faturasının **profili**: NES şematronu SARJ/SARJANLIK tipini yalnız
 * `ENERJI` profilinde kabul eder ("cbc:ProfileID değeri ENERJI olduğu durumda
 * cbc:InvoiceTypeCode değeri SARJ veya SARJANLIK olmalıdır", 2026-09-20 test
 * gönderimi). Belge e-Arşiv'e düşerse profil EARSIVFATURA kalır.
 */
export const SARJ_PROFILI = "ENERJI";

/** UBL'e `InvoiceTypeCode` olarak yazılan karşılıkları. */
export const SARJ_FATURA_TIPLERI: Record<SarjTuru, string> = {
  sarj: "SARJ",
  sarjanlik: "SARJANLIK",
};

export const SARJ_TURU_ADLARI: Record<SarjTuru, string> = {
  sarj: "Elektrikli araç şarj hizmeti",
  sarjanlik: "Şarj ünitesi / işletmecilik",
};

/**
 * Şarj belgesindeki plaka kuralı **irsaliyedekinden gevşektir**: şematron
 * burada yalnız büyük harf, rakam, alt çizgi ve tireye bakar (`01ADS123`,
 * `AFK-159` geçerli örnekler). İl kodu aranmaz — yabancı plakalı araç da
 * şarj olabilir.
 */
export const sarjPlakaNormalize = (plaka: string | null | undefined): string =>
  (plaka ?? "").replace(/\s/g, "").toLocaleUpperCase("tr-TR");

export function sarjPlakaGecerliMi(plaka: string | null | undefined): boolean {
  return /^[A-Z0-9_-]{2,20}$/.test(sarjPlakaNormalize(plaka));
}

/** ESU rapor kimliği GUID olmalıdır; belgede birden çok bulunabilir. */
export const GUID_DESENI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EsuRaporu {
  raporId: string;
  tarih: string;
}

export interface SarjBilgisi {
  turu?: SarjTuru | null;
  plaka?: string | null;
  baslangic?: string | null;
  bitis?: string | null;
  esuRaporlari?: EsuRaporu[] | null;
  /** SARJANLIK'ta her satırda şarj ünitesi seri numarası aranır. */
  satirlar?: { sira: number; uniteSeriNo?: string | null }[];
}

export type SarjAlan = "turu" | "plaka" | "baslangic" | "bitis" | "esuRaporlari" | "uniteSeriNo";

export interface SarjEngeli {
  alan: SarjAlan;
  mesaj: string;
}

/** Şarj faturasının gönderimini engelleyen eksikler. */
export function sarjEngelleri(bilgi: SarjBilgisi): SarjEngeli[] {
  if (!bilgi.turu) return [];
  const engeller: SarjEngeli[] = [];

  if (!sarjPlakaGecerliMi(bilgi.plaka)) {
    engeller.push({ alan: "plaka", mesaj: "Şarj edilen aracın plakası girilmelidir (yalnız büyük harf, rakam, _ ve -)" });
  }
  if (!bilgi.baslangic) {
    engeller.push({ alan: "baslangic", mesaj: "Şarjın başlangıç tarihi ve saati girilmelidir" });
  }
  if (!bilgi.bitis) {
    engeller.push({ alan: "bitis", mesaj: "Şarjın bitiş tarihi ve saati girilmelidir" });
  }
  if (bilgi.baslangic && bilgi.bitis && bilgi.bitis < bilgi.baslangic) {
    engeller.push({ alan: "bitis", mesaj: "Şarj bitişi başlangıcından önce olamaz" });
  }

  const raporlar = bilgi.esuRaporlari ?? [];
  if (bilgi.turu === "sarj") {
    if (raporlar.length === 0) {
      engeller.push({ alan: "esuRaporlari", mesaj: "En az bir ESU rapor kimliği (GUID) girilmelidir" });
    }
    for (const rapor of raporlar) {
      if (!GUID_DESENI.test(rapor.raporId.trim())) {
        engeller.push({ alan: "esuRaporlari", mesaj: `ESU rapor kimliği GUID biçiminde olmalıdır: ${rapor.raporId}` });
      }
      if (!rapor.tarih) {
        engeller.push({ alan: "esuRaporlari", mesaj: `ESU raporunun tarihi girilmelidir: ${rapor.raporId}` });
      }
    }
  }

  if (bilgi.turu === "sarjanlik") {
    for (const satir of bilgi.satirlar ?? []) {
      if (!satir.uniteSeriNo?.trim()) {
        engeller.push({ alan: "uniteSeriNo", mesaj: `${satir.sira}. satırda şarj ünitesi seri numarası girilmelidir` });
      }
    }
  }

  return engeller;
}

/**
 * Satırlardaki stok kartlarından belgenin şarj türünü çözer. İki tür aynı
 * belgede karışamaz: şematron tek `InvoiceTypeCode` yazdırır, karışık belge
 * hangi kurala uyacağını söyleyemez.
 */
export function sarjTuruCoz(satirlar: { sarjTuru?: string | null }[]): { turu: SarjTuru | null; karisik: boolean } {
  const turler = new Set(satirlar.map((s) => s.sarjTuru).filter((t): t is SarjTuru => t === "sarj" || t === "sarjanlik"));
  if (turler.size === 0) return { turu: null, karisik: false };
  if (turler.size > 1) return { turu: null, karisik: true };
  return { turu: [...turler][0], karisik: false };
}
