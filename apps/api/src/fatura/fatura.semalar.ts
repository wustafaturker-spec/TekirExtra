import { z } from "zod";
import { guncellemeSemasi } from "../core/sema";
import { ihracKayitliHatalari, senaryoHatalari } from "@tekirextra/shared";

const pozitifOndalik = z
  .union([z.string(), z.number()])
  .transform((val) => String(val))
  .pipe(z.string().regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli"));
const yuzde = pozitifOndalik.refine((deger) => Number(deger) <= 100, "Oran %100'ü aşamaz");

const partiBilgisiSemasi = z.object({
  lotNo: z.string().min(1).max(100), seriNo: z.string().min(1).max(160).optional().nullable(),
  sonKullanmaTarihi: z.string().date().optional().nullable(), uretimTarihi: z.string().date().optional().nullable(),
  miktar: pozitifOndalik,
});

export const faturaSatirSemasi = z.object({
  stokId: z.string().uuid(),
  varyantId: z.string().uuid().optional().nullable(),
  partiBilgileri: z.array(partiBilgisiSemasi).optional(),
  miktar: pozitifOndalik,
  birim: z.string().min(1).max(20).default("adet"),
  birimFiyat: pozitifOndalik,
  iskontoOrani: yuzde.default("0"),
  kdvOrani: yuzde.default("20"),
  /**
   * Tevkifat GİB koduyla girilir; oran koddan türer (FTR-18). Pay/payda artık
   * girdi değildir, servis bunları koddan hesaplayıp saklar.
   */
  tevkifatKodu: z.string().max(10).optional().nullable(),
  /** Yalnız `650 Diğerleri` için anlamlı; diğer kodlarda oran tektir. */
  tevkifatOrani: z.string().max(10).optional().nullable(),
  gibIstisnaKodu: z.string().max(20).optional().nullable(),
  projeId: z.string().uuid().optional().nullable(),
  projeAltKirilimId: z.string().uuid().optional().nullable(),
});

const tarihSemasi = z
  .string()
  .transform((val) => (val.includes("T") ? val.slice(0, 10) : val))
  .pipe(z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"));

const faturaOlusturGovde = z.object({
  tip: z.enum(["satis", "alis", "satis_iade", "alis_iade", "proforma"]),
  gelirTuru: z.enum(["ticari_satis", "kira_geliri", "varlik_satisi", "yansitma", "hizmet_diger"]).optional().nullable(),
  no: z.string().trim().max(100).optional().nullable(),
  tarih: tarihSemasi,
  vadeTarihi: tarihSemasi.optional().nullable(),
  siparisNo: z.string().trim().max(100).optional().nullable(),
  siparisTarihi: tarihSemasi.optional().nullable(),
  cariId: z.string().uuid(),
  /**
   * e-Fatura profili (FTR-19). Boş bırakılırsa cari kartındaki varsayılan
   * kullanılır; UBL'e `ProfileID` olarak bu değer yazılır.
   */
  efaturaProfili: z.enum(["temel", "ticari"]).optional().nullable(),
  /**
   * e-Arşiv teslim şekli (EBLG-26). Boş bırakılırsa cari kartındaki varsayılan
   * kullanılır; e-Belge sihirbazında da değiştirilebilir.
   */
  earsivGonderimSekli: z.enum(["elektronik", "kagit"]).optional().nullable(),
  /** EBLG-60: ihraç kayıtlı satış kodu (701/702); doluysa KDV tahsil edilmez. */
  ihracKayitliKodu: z.string().optional().nullable(),
  /** STK-07: stok hareketlerinin işleneceği depo; boşsa varsayılan depo */
  depoId: z.string().uuid().optional().nullable(),
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
  kur: pozitifOndalik.default("1"),
  genelIskontoYuzdesi: yuzde.default("0"),
  genelIskontoTutari: pozitifOndalik.default("0"),
  aciklama: z.string().max(500).optional().nullable(),
  notlar: z.string().max(2000).optional().nullable(),
  satirlar: z.array(faturaSatirSemasi).min(1, "Faturada en az bir satır bulunmalıdır"),
});
/**
 * GİB senaryo kuralları (FTR-17, FTR-18). Kural kümesi `@tekirextra/shared`
 * içindedir; arayüz kaydetmeden önce aynı işlevi çağırır, böylece iki taraf
 * kuralı ayrı ayrı yorumlamaz.
 */
const senaryolariDogrula = (
  fatura: { satirlar?: Array<{ kdvOrani?: string; tevkifatKodu?: string | null; tevkifatOrani?: string | null; gibIstisnaKodu?: string | null }> },
  ctx: z.RefinementCtx,
) => {
  const satirlar = (fatura.satirlar ?? []).map((satir) => ({
    kdvOrani: Number(satir.kdvOrani ?? 0),
    tevkifatKodu: satir.tevkifatKodu,
    tevkifatOrani: satir.tevkifatOrani,
    gibIstisnaKodu: satir.gibIstisnaKodu,
  }));
  for (const hata of senaryoHatalari(satirlar)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["satirlar", hata.satirIndeksi, hata.alan], message: hata.mesaj });
  }
};
const faturaFinansalDogrula = (fatura: { satirlar?: Array<{ miktar?: string; birimFiyat?: string; iskontoOrani?: string; kdvOrani?: string; tevkifatKodu?: string | null; tevkifatOrani?: string | null; gibIstisnaKodu?: string | null }>; genelIskontoTutari?: string; dovizCinsi?: string; kur?: string; tip?: string; ihracKayitliKodu?: string | null }, ctx: z.RefinementCtx) => {
  senaryolariDogrula(fatura, ctx);
  // Güncellemede tip gelmeyebilir; kural tam hâliyle serviste yeniden uygulanır.
  if (fatura.ihracKayitliKodu && fatura.tip) {
    for (const mesaj of ihracKayitliHatalari({ tip: fatura.tip, ihracKayitliKodu: fatura.ihracKayitliKodu, satirlar: fatura.satirlar ?? [] })) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ihracKayitliKodu"], message: mesaj });
    }
  }
  // EBLG-57: dövizli belgede 1 "tutar zaten TL" demektir; e-belgenin TL
  // karşılığı ve cari/rapor tutarları yanlış çıkar (masraf ve gelirle aynı kural).
  if (fatura.dovizCinsi !== undefined && fatura.dovizCinsi !== "TRY" && Number(fatura.kur ?? 1) === 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["kur"], message: "Dövizli faturada belge tarihindeki kur girilmelidir" });
  }
  const araToplam = (fatura.satirlar ?? []).reduce((toplam, satir) => toplam + Number(satir.miktar ?? 0) * Number(satir.birimFiyat ?? 0) * (1 - Number(satir.iskontoOrani ?? 0) / 100), 0);
  if (Number(fatura.genelIskontoTutari ?? 0) > araToplam + 0.01) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["genelIskontoTutari"], message: "Genel iskonto tutarı ara toplamı aşamaz" });
};
export const faturaOlusturSemasi = faturaOlusturGovde.superRefine((fatura, ctx) => faturaFinansalDogrula(fatura, ctx));
export const faturaGuncelleSemasi = guncellemeSemasi(faturaOlusturGovde).superRefine((fatura, ctx) => faturaFinansalDogrula(fatura, ctx));

export const faturaSeriSemasi = z.object({
  seri: z.string().regex(/^[A-Z]{3}$/, "Seri 3 büyük harf olmalıdır (örn. TKR)"),
  yil: z.number().int().min(2000).max(2100),
  sonSira: z.number().int().min(0).optional().default(0),
});

export const tekrarlayanFaturaSemasi = z.object({
  ad: z.string().trim().min(1).max(100),
  sablonFaturaId: z.string().uuid(),
  siklik: z.enum(["haftalik", "aylik", "yillik"]),
  aralik: z.number().int().min(1).max(36).default(1),
  sonrakiTarih: z.string().date(),
  bitisTarihi: z.string().date().optional().nullable(),
});

export const tekrarlayanFaturaGuncelleSemasi = z.object({
  ad: z.string().trim().min(1).max(100).optional(),
  aktif: z.boolean().optional(),
  sonrakiTarih: z.string().date().optional(),
  bitisTarihi: z.string().date().optional().nullable(),
});
