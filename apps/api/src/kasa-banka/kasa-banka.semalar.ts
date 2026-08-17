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

export const posHesapOlusturSemasi = z.object({
  ad: z.string().min(2).max(100), saglayici: z.enum(["iyzico", "paytr"]),
  baglantiId: z.string().uuid().optional().nullable(), varsayilanBankaHesapId: z.string().uuid().optional().nullable(),
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
});

export const posBankaAktarimSemasi = z.object({
  posHesapId: z.string().uuid(), bankaHesapId: z.string().uuid().optional(),
  ekstreSatirId: z.string().uuid().optional(),
  brutTutar: pozitifOndalik, komisyonTutar: pozitifOndalik.or(z.literal("0")).default("0"),
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"), aciklama: z.string().max(500).optional().nullable(),
}).refine((g) => Number(g.komisyonTutar) < Number(g.brutTutar), { message: "Komisyon brüt tutardan küçük olmalıdır", path: ["komisyonTutar"] });

export const kasaBankaHareketOlusturSemasi = z.object({
  kasaId: z.string().uuid().optional().nullable(),
  bankaHesapId: z.string().uuid().optional().nullable(),
  posHesapId: z.string().uuid().optional().nullable(),
  tip: z.enum(["tahsilat", "tediye"]),
  tutar: pozitifOndalik,
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
  kur: pozitifOndalik.optional(),
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  aciklama: z.string().max(500).optional().nullable(),
  cariId: z.string().uuid().optional().nullable(),
  faturaId: z.string().uuid().optional().nullable(), // fatura kapama için (KSB-07)
}).refine((data) => [data.kasaId, data.bankaHesapId, data.posHesapId].filter(Boolean).length === 1, {
  message: "Kasa, banka veya POS hesaplarından yalnızca biri seçilmelidir",
  path: ["kasaId"],
});

export const virmanOlusturSemasi = z.object({
  kaynakKasaId: z.string().uuid().optional().nullable(),
  kaynakBankaHesapId: z.string().uuid().optional().nullable(),
  kaynakPosHesapId: z.string().uuid().optional().nullable(),
  hedefKasaId: z.string().uuid().optional().nullable(),
  hedefBankaHesapId: z.string().uuid().optional().nullable(),
  hedefPosHesapId: z.string().uuid().optional().nullable(),
  tutar: pozitifOndalik,
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  aciklama: z.string().max(500).optional().nullable(),
}).refine((data) => [data.kaynakKasaId, data.kaynakBankaHesapId, data.kaynakPosHesapId].filter(Boolean).length === 1, {
  message: "Kaynak Kasa veya Banka Hesabından en az biri seçilmelidir",
  path: ["kaynakKasaId"],
}).refine((data) => [data.hedefKasaId, data.hedefBankaHesapId, data.hedefPosHesapId].filter(Boolean).length === 1, {
  message: "Hedef Kasa veya Banka Hesabından en az biri seçilmelidir",
  path: ["hedefKasaId"],
});

/* ─── BANKA EKSTRESİ (KSB-06) ────────────────────────────────────────────── */

/** Sütun indisleri; boş bırakılan alanlar dosyada yok demektir. */
const sutunIndisi = z.number().int().min(0).max(200);

export const ekstreSutunEslemesiSemasi = z
  .object({
    baslikSatiri: z.number().int().min(0).max(50).default(0),
    tarih: sutunIndisi,
    aciklama: sutunIndisi,
    tutar: sutunIndisi.optional().nullable(),
    borc: sutunIndisi.optional().nullable(),
    alacak: sutunIndisi.optional().nullable(),
    dekontNo: sutunIndisi.optional().nullable(),
    karsiIban: sutunIndisi.optional().nullable(),
    karsiUnvan: sutunIndisi.optional().nullable(),
    bakiye: sutunIndisi.optional().nullable(),
  })
  // Tutar ya tek işaretli sütundan ya da borç/alacak ikilisinden okunur.
  .refine(
    (d) =>
      (d.tutar !== undefined && d.tutar !== null) ||
      ((d.borc !== undefined && d.borc !== null) &&
        (d.alacak !== undefined && d.alacak !== null)),
    {
      message: "Tutar sütunu ya da borç+alacak sütunlarının ikisi de seçilmelidir",
      path: ["tutar"],
    },
  );

export const ekstreYukleSemasi = z.object({
  bankaHesapId: z.string().uuid(),
  esleme: ekstreSutunEslemesiSemasi,
  /** Eşleme banka hesabına kaydedilsin mi (sonraki yüklemede sorulmaz). */
  eslemeyiKaydet: z.boolean().default(true),
});

export const ekstreEslestirSemasi = z.object({
  cariId: z.string().uuid(),
  faturaId: z.string().uuid().optional().nullable(),
});

/** Paranın gireceği/çıkacağı durumlar: alınanda tahsil, verilende ödeme. */
export const CEK_SENET_PARA_DURUMLARI = ["tahsil_edildi", "odendi"] as const;

export const cekSenetOlusturSemasi = z
  .object({
    tur: z.enum(["cek", "senet"]),
    /** alinan = müşteri çeki (varlık); verilen = kendi çekimiz (borç). */
    yon: z.enum(["alinan", "verilen"]).default("alinan"),
    portfoyNo: z.string().min(1).max(50),
    cekNo: z.string().min(1).max(50).optional().nullable(),
    islemTarihi: z.string().date("Geçersiz işlem tarihi (YYYY-MM-DD)"),
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
    fizikselKonum: z.string().max(150).optional().nullable(),
  })
  // Verilen çekte borç azalışı bir cariye yazılmalı, aksi hâlde kayıt eksik kalır
  .refine((d) => d.yon !== "verilen" || !!d.cariId, {
    message: "Verilen çek/senet için lehtar cari seçilmelidir",
    path: ["cariId"],
  })
  .refine((d) => d.tur !== "cek" || !!d.cekNo, {
    message: "Çek numarası zorunludur",
    path: ["cekNo"],
  });

export const cekSenetGuncelleSemasi = z
  .object({
    durum: z.enum([
      "portfoyde",
      "tahsile_verildi",
      "teminata_verildi",
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
    fizikselKonum: z.string().max(150).optional().nullable(),
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
  })
  .refine((d) => !["karsiliksiz", "iade_edildi"].includes(d.durum) || !!d.aciklama?.trim(), {
    message: "Karşılıksız/iade işlemi için açıklama zorunludur",
    path: ["aciklama"],
  });
