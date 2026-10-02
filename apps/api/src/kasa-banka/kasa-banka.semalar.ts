import { z } from "zod";
import { guncellemeSemasi } from "../core/sema";

const pozitifOndalik = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli");

export const kasaOlusturSemasi = z.object({
  ad: z.string().min(2).max(100),
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
});

export const kasaGuncelleSemasi = guncellemeSemasi(kasaOlusturSemasi).extend({
  aktif: z.boolean().optional(),
});

export const bankaHesapOlusturSemasi = z.object({
  ad: z.string().min(2).max(100),
  bankaAdi: z.string().min(2).max(100),
  sube: z.string().max(100).optional().nullable(),
  hesapNo: z.string().max(50).optional().nullable(),
  iban: z.string().max(34).optional().nullable(),
  // EBLG-101: firma tasarımının banka tablosu.
  swift: z.union([z.string().trim().toUpperCase().regex(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, "SWIFT kodu 8 ya da 11 karakterdir"), z.literal("")]).transform((d) => d || null).nullable().optional(),
  faturadaGoster: z.boolean().optional(),
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
});

export const bankaHesapGuncelleSemasi = guncellemeSemasi(bankaHesapOlusturSemasi).extend({
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
  /**
   * KSB-07: hesap dövizi faturanınkinden farklıysa ödemenin fatura dövizindeki
   * karşılığı (bankanın uyguladığı kurla). Boşsa işlem günü kuruyla hesaplanır;
   * aynı dövizde yok sayılır.
   */
  faturaKarsiligi: pozitifOndalik.optional().nullable(),
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

/** KSB-06: "benzer satırlar için kural kaydet" seçeneği. */
const ekstreKuralGirdisi = z.object({
  /** Açıklamada aranacak metin parçası (ör. "EFT UCRETI"). */
  anahtar: z.string().trim().min(3, "Kural metni en az 3 karakter olmalıdır").max(120),
  /** true: firmanın bütün banka hesaplarında geçerli. */
  tumHesaplar: z.boolean().default(false),
});

const eslestirOrtak = {
  /** Kural önerisiyle eşleştirildiyse kullanım sayacı artar. */
  kuralId: z.uuid().optional().nullable(),
  kural: ekstreKuralGirdisi.optional().nullable(),
};

/**
 * KSB-06: ekstre satırını eşleştirme; `tur` alanına göre ayrışır.
 * Tutarlar hesabın dövizindedir; işaret satırdan gelir.
 */
export const ekstreEslestirSemasi = z.discriminatedUnion("tur", [
  z.object({
    tur: z.literal("cari"),
    cariId: z.uuid(),
    /** Faturalara dağıtım; toplamı satırı aşamaz, kalan cariye avans olarak işlenir. */
    dagitim: z.array(z.object({ faturaId: z.uuid(), tutar: pozitifOndalik })).max(50).default([]),
    ...eslestirOrtak,
  }),
  z.object({ tur: z.literal("mevcut_fis"), hareketIdleri: z.array(z.uuid()).min(1).max(20), ...eslestirOrtak }),
  z.object({
    tur: z.literal("masraf"),
    kategoriId: z.uuid(),
    kdvOrani: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, "Geçerli KDV oranı girin").default("0"),
    aciklama: z.string().trim().max(500).optional().nullable(),
    ...eslestirOrtak,
  }),
  z.object({ tur: z.literal("gelir"), kategoriId: z.uuid(), aciklama: z.string().trim().max(500).optional().nullable(), ...eslestirOrtak }),
  z.object({
    tur: z.literal("virman"),
    karsiKasaId: z.uuid().optional().nullable(),
    karsiBankaHesapId: z.uuid().optional().nullable(),
    aciklama: z.string().trim().max(500).optional().nullable(),
    ...eslestirOrtak,
  }).refine((d) => Boolean(d.karsiKasaId) !== Boolean(d.karsiBankaHesapId), { message: "Karşı hesap olarak bir kasa ya da bir banka hesabı seçin", path: ["karsiKasaId"] }),
  z.object({ tur: z.literal("cek"), cekSenetId: z.uuid(), ...eslestirOrtak }),
  z.object({ tur: z.literal("kredi_karti"), krediKartiId: z.uuid(), ...eslestirOrtak }),
]);

export const ekstreKuralGuncelleSemasi = z.object({
  aktif: z.boolean().optional(),
  anahtar: z.string().trim().min(3).max(120).optional(),
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
    /** KSB-11: tahsile/teminata verilirken çekin bırakıldığı banka hesabı. */
    bankaHesapId: z.string().uuid().optional().nullable(),
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

/** KSB-08: geri alma ve düzeltmede gerekçe zorunludur; denetim izine yazılır. */
export const geriAlmaSemasi = z.object({
  neden: z.string().trim().min(3, "Geri alma gerekçesi en az 3 karakter olmalıdır").max(300),
});

/** KSB-09: makbuz serisi ayarı (önek + devir sırası). */
export const makbuzSerisiSemasi = z.object({
  tur: z.enum(["tahsilat", "tediye"]),
  yil: z.number().int().min(2000).max(2100),
  onek: z.string().trim().toUpperCase().regex(/^[A-Z]{1,5}$/, "Önek 1-5 harf olmalıdır (Türkçe karakter ve rakam olmadan)"),
  sonSira: z.number().int().min(0).max(999999),
});
