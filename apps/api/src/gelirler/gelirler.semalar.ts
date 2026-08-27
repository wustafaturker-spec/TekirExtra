import { z } from "zod";

const pozitifOndalik = z
  .union([z.string(), z.number()])
  .transform((val) => String(val))
  .pipe(z.string().regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli"));

const yuzde = pozitifOndalik.refine((deger) => Number(deger) <= 100, "Oran %100'ü aşamaz");

export const gelirKategoriOlusturSemasi = z.object({
  ad: z.string().trim().min(2, "Kategori adı en az 2 karakter olmalıdır").max(100),
  varsayilanStopajOrani: yuzde.optional().nullable(),
  varsayilanKdvOrani: yuzde.optional().nullable(),
  muhasebeKodu: z.string().trim().max(50).optional().nullable(),
  ustId: z.string().uuid().optional().nullable(),
});

export const gelirKategoriGuncelleSemasi = gelirKategoriOlusturSemasi.partial();

export const gelirKaydiOlusturSemasi = z.object({
  kategoriId: z.string().uuid("Geçerli bir gelir kategorisi seçilmelidir"),
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  brutTutar: pozitifOndalik,
  stopajOrani: yuzde.default("0"),
  stopajTutari: pozitifOndalik.default("0"),
  kdvOrani: yuzde.default("0"),
  kdvTutari: pozitifOndalik.default("0"),
  netTutar: pozitifOndalik,
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
  kur: pozitifOndalik.default("1"),
  aciklama: z.string().trim().max(500).optional().nullable(),
  belgeNo: z.string().trim().max(100).optional().nullable(),
  cariId: z.string().uuid().optional().nullable(),
  kasaId: z.string().uuid().optional().nullable(),
  bankaHesapId: z.string().uuid().optional().nullable(),
}).refine((data) => Boolean(data.kasaId || data.bankaHesapId), {
  message: "Tahsilatın aktarılacağı bir kasa veya banka hesabı seçilmelidir",
  path: ["kasaId"],
});
