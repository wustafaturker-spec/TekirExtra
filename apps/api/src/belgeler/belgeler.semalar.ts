import { z } from "zod";

const pozitifOndalik = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli");

const partiBilgisiSemasi = z.object({
  lotNo: z.string().min(1).max(100), seriNo: z.string().min(1).max(160).optional().nullable(),
  sonKullanmaTarihi: z.string().date().optional().nullable(), uretimTarihi: z.string().date().optional().nullable(),
  miktar: pozitifOndalik,
});

export const BELGE_TURLERI = ["teklif", "siparis", "irsaliye"] as const;
export const BELGE_YONLERI = ["satis", "alis"] as const;

export const belgeSatirSemasi = z.object({
  stokId: z.string().uuid(),
  varyantId: z.string().uuid().optional().nullable(),
  partiBilgileri: z.array(partiBilgisiSemasi).optional(),
  miktar: pozitifOndalik,
  birim: z.string().min(1).max(20).default("adet"),
  birimFiyat: pozitifOndalik,
  iskontoOrani: pozitifOndalik.default("0"),
  kdvOrani: pozitifOndalik.default("20"),
  tevkifatPay: z.number().int().min(1).max(10).optional().nullable(),
  tevkifatPayda: z.number().int().min(1).max(10).optional().nullable(),
});

export const belgeOlusturSemasi = z.object({
  tur: z.enum(BELGE_TURLERI),
  yon: z.enum(BELGE_YONLERI).default("satis"),
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  /// Teklif geçerlilik süresi (diğer türlerde yok sayılır)
  gecerlilikTarihi: z
    .string()
    .date("Geçersiz tarih formatı (YYYY-MM-DD)")
    .optional()
    .nullable(),
  cariId: z.string().uuid(),
  /** STK-07: rezerv/yoldaki ve stok etkisinin işleneceği depo; boşsa varsayılan */
  depoId: z.string().uuid().optional().nullable(),
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
  kur: pozitifOndalik.default("1"),
  genelIskontoYuzdesi: pozitifOndalik.default("0"),
  genelIskontoTutari: pozitifOndalik.default("0"),
  aciklama: z.string().max(500).optional().nullable(),
  notlar: z.string().max(2000).optional().nullable(),
  satirlar: z.array(belgeSatirSemasi).min(1, "Belgede en az bir satır bulunmalıdır"),
});

export const belgeGuncelleSemasi = belgeOlusturSemasi
  .omit({ tur: true, yon: true })
  .partial();

export const belgeDonusturSemasi = z.object({
  hedef: z.enum(["siparis", "irsaliye", "fatura"]),
});

/** FTR-13: bekleyen sipariş/irsaliyeleri tek faturada birleştirme. */
export const topluFaturaSemasi = z.object({
  belgeIds: z.array(z.string().uuid()).min(1, "En az bir belge seçin"),
});
