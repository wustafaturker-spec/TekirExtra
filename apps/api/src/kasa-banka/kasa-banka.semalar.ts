import { z } from "zod";

const pozitifOndalik = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli");

export const kasaOlusturSemasi = z.object({
  ad: z.string().min(2).max(100),
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
});

export const kasaGuncelleSemasi = kasaOlusturSemasi.partial().extend({
  aktif: z.boolean().optional(),
});

export const bankaHesapOlusturSemasi = z.object({
  ad: z.string().min(2).max(100),
  bankaAdi: z.string().min(2).max(100),
  sube: z.string().max(100).optional().nullable(),
  hesapNo: z.string().max(50).optional().nullable(),
  iban: z.string().max(34).optional().nullable(),
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
});

export const bankaHesapGuncelleSemasi = bankaHesapOlusturSemasi.partial().extend({
  aktif: z.boolean().optional(),
});

export const kasaBankaHareketOlusturSemasi = z.object({
  kasaId: z.string().uuid().optional().nullable(),
  bankaHesapId: z.string().uuid().optional().nullable(),
  tip: z.enum(["tahsilat", "tediye"]),
  tutar: pozitifOndalik,
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
  kur: pozitifOndalik.default("1"),
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  aciklama: z.string().max(500).optional().nullable(),
  cariId: z.string().uuid().optional().nullable(),
  faturaId: z.string().uuid().optional().nullable(), // fatura kapama için (KSB-07)
}).refine((data) => data.kasaId || data.bankaHesapId, {
  message: "Kasa veya Banka Hesabından en az biri seçilmelidir",
  path: ["kasaId"],
});

export const virmanOlusturSemasi = z.object({
  kaynakKasaId: z.string().uuid().optional().nullable(),
  kaynakBankaHesapId: z.string().uuid().optional().nullable(),
  hedefKasaId: z.string().uuid().optional().nullable(),
  hedefBankaHesapId: z.string().uuid().optional().nullable(),
  tutar: pozitifOndalik,
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  aciklama: z.string().max(500).optional().nullable(),
}).refine((data) => data.kaynakKasaId || data.kaynakBankaHesapId, {
  message: "Kaynak Kasa veya Banka Hesabından en az biri seçilmelidir",
  path: ["kaynakKasaId"],
}).refine((data) => data.hedefKasaId || data.hedefBankaHesapId, {
  message: "Hedef Kasa veya Banka Hesabından en az biri seçilmelidir",
  path: ["hedefKasaId"],
});

export const cekSenetOlusturSemasi = z.object({
  tur: z.enum(["cek", "senet"]),
  portfoyNo: z.string().min(1).max(50),
  vadeTarihi: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  tutar: pozitifOndalik,
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
  kur: pozitifOndalik.default("1"),
  borclu: z.string().min(2).max(255),
  kesideYeri: z.string().max(100).optional().nullable(),
  banka: z.string().max(100).optional().nullable(),
  sube: z.string().max(100).optional().nullable(),
  hesapNo: z.string().max(50).optional().nullable(),
  cariId: z.string().uuid().optional().nullable(),
  aciklama: z.string().max(500).optional().nullable(),
});

export const cekSenetGuncelleSemasi = z
  .object({
    durum: z.enum(["portfoyde", "ciro_edildi", "tahsil_edildi", "karsiliksiz", "iade_edildi"]),
    ciroCariId: z.string().uuid().optional().nullable(),
    aciklama: z.string().max(500).optional().nullable(),
    /** Tahsilde paranın gireceği hesap; kasa ya da bankadan biri (KSB-05). */
    tahsilKasaId: z.string().uuid().optional().nullable(),
    tahsilBankaHesapId: z.string().uuid().optional().nullable(),
    tahsilTarihi: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)").optional(),
  })
  .refine((d) => d.durum !== "ciro_edildi" || !!d.ciroCariId, {
    message: "Ciro için ciro edilen cari seçilmelidir",
    path: ["ciroCariId"],
  })
  .refine(
    (d) => d.durum !== "tahsil_edildi" || !!d.tahsilKasaId || !!d.tahsilBankaHesapId,
    {
      message: "Tahsil için kasa veya banka hesabından biri seçilmelidir",
      path: ["tahsilKasaId"],
    },
  )
  .refine((d) => !(d.tahsilKasaId && d.tahsilBankaHesapId), {
    message: "Tahsil için yalnız bir hesap seçilebilir (kasa ya da banka)",
    path: ["tahsilKasaId"],
  });
