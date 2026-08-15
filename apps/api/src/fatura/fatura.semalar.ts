import { z } from "zod";

const pozitifOndalik = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli");
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
  tevkifatPay: z.number().int().min(1).max(10).optional().nullable(),
  tevkifatPayda: z.number().int().min(1).max(10).optional().nullable(),
  gibIstisnaKodu: z.string().max(20).optional().nullable(),
});

const faturaOlusturGovde = z.object({
  tip: z.enum(["satis", "alis", "satis_iade", "alis_iade", "proforma"]),
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  vadeTarihi: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)").optional().nullable(),
  siparisNo: z.string().trim().max(100).optional().nullable(),
  siparisTarihi: z.string().date("Geçersiz sipariş tarihi").optional().nullable(),
  cariId: z.string().uuid(),
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
const tevkifatlariDogrula = (fatura: { satirlar?: Array<{ tevkifatPay?: number | null; tevkifatPayda?: number | null }> }, ctx: z.RefinementCtx) => {
  fatura.satirlar?.forEach((satir, index) => {
    if (satir.tevkifatPay != null && satir.tevkifatPayda != null && satir.tevkifatPay > satir.tevkifatPayda) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["satirlar", index, "tevkifatPay"], message: "Tevkifat payı paydadan büyük olamaz" });
    }
  });
};
const faturaFinansalDogrula = (fatura: { satirlar?: Array<{ miktar?: string; birimFiyat?: string; iskontoOrani?: string; tevkifatPay?: number | null; tevkifatPayda?: number | null }>; genelIskontoTutari?: string }, ctx: z.RefinementCtx) => {
  tevkifatlariDogrula(fatura, ctx);
  const araToplam = (fatura.satirlar ?? []).reduce((toplam, satir) => toplam + Number(satir.miktar ?? 0) * Number(satir.birimFiyat ?? 0) * (1 - Number(satir.iskontoOrani ?? 0) / 100), 0);
  if (Number(fatura.genelIskontoTutari ?? 0) > araToplam + 0.01) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["genelIskontoTutari"], message: "Genel iskonto tutarı ara toplamı aşamaz" });
};
export const faturaOlusturSemasi = faturaOlusturGovde.superRefine((fatura, ctx) => faturaFinansalDogrula(fatura, ctx));
export const faturaGuncelleSemasi = faturaOlusturGovde.partial().superRefine((fatura, ctx) => faturaFinansalDogrula(fatura, ctx));

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
