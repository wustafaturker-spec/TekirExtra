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

/** Paranın gireceği/çıkacağı durumlar: alınanda tahsil, verilende ödeme. */
export const CEK_SENET_PARA_DURUMLARI = ["tahsil_edildi", "odendi"] as const;

export const cekSenetOlusturSemasi = z
  .object({
    tur: z.enum(["cek", "senet"]),
    /** alinan = müşteri çeki (varlık); verilen = kendi çekimiz (borç). */
    yon: z.enum(["alinan", "verilen"]).default("alinan"),
    portfoyNo: z.string().min(1).max(50),
    vadeTarihi: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
    tutar: pozitifOndalik,
    dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
    kur: pozitifOndalik.default("1"),
    /** Alınanda keşideci, verilende kendi firmamız. */
    borclu: z.string().min(2).max(255),
    kesideYeri: z.string().max(100).optional().nullable(),
    banka: z.string().max(100).optional().nullable(),
    sube: z.string().max(100).optional().nullable(),
    hesapNo: z.string().max(50).optional().nullable(),
    /** Alınanda çeki veren müşteri, verilende lehtar. */
    cariId: z.string().uuid().optional().nullable(),
    aciklama: z.string().max(500).optional().nullable(),
  })
  // Verilen çekte borç azalışı bir cariye yazılmalı, aksi hâlde kayıt eksik kalır
  .refine((d) => d.yon !== "verilen" || !!d.cariId, {
    message: "Verilen çek/senet için lehtar cari seçilmelidir",
    path: ["cariId"],
  });

export const cekSenetGuncelleSemasi = z
  .object({
    durum: z.enum([
      "portfoyde",
      "ciro_edildi",
      "tahsil_edildi",
      "karsiliksiz",
      "iade_edildi",
      "verildi",
      "odendi",
    ]),
    ciroCariId: z.string().uuid().optional().nullable(),
    aciklama: z.string().max(500).optional().nullable(),
    /**
     * Paranın gireceği (tahsil) ya da çıkacağı (ödeme) hesap; kasa ya da
     * bankadan biri (KSB-05).
     */
    hesapKasaId: z.string().uuid().optional().nullable(),
    hesapBankaHesapId: z.string().uuid().optional().nullable(),
    islemTarihi: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)").optional(),
  })
  .refine((d) => d.durum !== "ciro_edildi" || !!d.ciroCariId, {
    message: "Ciro için ciro edilen cari seçilmelidir",
    path: ["ciroCariId"],
  })
  .refine(
    (d) =>
      !CEK_SENET_PARA_DURUMLARI.includes(d.durum as (typeof CEK_SENET_PARA_DURUMLARI)[number]) ||
      !!d.hesapKasaId ||
      !!d.hesapBankaHesapId,
    {
      message: "Tahsil/ödeme için kasa veya banka hesabından biri seçilmelidir",
      path: ["hesapKasaId"],
    },
  )
  .refine((d) => !(d.hesapKasaId && d.hesapBankaHesapId), {
    message: "Yalnız bir hesap seçilebilir (kasa ya da banka)",
    path: ["hesapKasaId"],
  });
