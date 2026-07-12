import { z } from "zod";

const pozitifOndalik = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli");

export const faturaSatirSemasi = z.object({
  stokId: z.string().uuid(),
  miktar: pozitifOndalik,
  birim: z.string().min(1).max(20).default("adet"),
  birimFiyat: pozitifOndalik,
  iskontoOrani: pozitifOndalik.default("0"),
  kdvOrani: pozitifOndalik.default("20"),
  tevkifatPay: z.number().int().min(1).max(10).optional().nullable(),
  tevkifatPayda: z.number().int().min(1).max(10).optional().nullable(),
});

export const faturaOlusturSemasi = z.object({
  tip: z.enum(["satis", "alis", "satis_iade", "alis_iade", "proforma"]),
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  vadeTarihi: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)").optional().nullable(),
  cariId: z.string().uuid(),
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
  kur: pozitifOndalik.default("1"),
  genelIskontoYuzdesi: pozitifOndalik.default("0"),
  genelIskontoTutari: pozitifOndalik.default("0"),
  aciklama: z.string().max(500).optional().nullable(),
  notlar: z.string().max(2000).optional().nullable(),
  satirlar: z.array(faturaSatirSemasi).min(1, "Faturada en az bir satır bulunmalıdır"),
});

export const faturaGuncelleSemasi = faturaOlusturSemasi.partial();

export const faturaSeriSemasi = z.object({
  seri: z.string().regex(/^[A-Z]{3}$/, "Seri 3 büyük harf olmalıdır (örn. TKR)"),
  yil: z.number().int().min(2000).max(2100),
  sonSira: z.number().int().min(0).optional().default(0),
});
