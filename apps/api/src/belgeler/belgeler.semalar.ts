import { z } from "zod";
import { PLAKA_HATA_MESAJI, plakaGecerliMi, plakaNormalize } from "@tekirextra/shared";
import { guncellemeSemasi } from "../core/sema";

/** Plaka alanı: boşluk/küçük harf düzeltilir, biçim GİB kuralıyla sınanır. */
const plakaAlani = z
  .string()
  .max(20)
  .optional()
  .nullable()
  .transform((deger) => (deger ? plakaNormalize(deger) : deger))
  .refine((deger) => !deger || plakaGecerliMi(deger), PLAKA_HATA_MESAJI);

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
  /** İDİS etiket numarası (EBLG-72): 2 harf + 7 rakam; irsaliyede de zorunlu. */
  idisEtiketNo: z.string().max(20).optional().nullable(),
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
  /** Müşterinin sipariş referansı (EBLG-74); e-İrsaliyede OrderReference olur. */
  siparisNo: z.string().max(100).optional().nullable(),
  siparisTarihi: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)").optional().nullable(),
  /** FTR-27: alış irsaliyesinde tedarikçinin irsaliye numarası; diğerlerinde yok sayılır. */
  tedarikciBelgeNo: z.string().max(50).optional().nullable(),
  cariId: z.string().uuid(),
  faturaId: z.string().uuid().optional().nullable(),
  /** STK-07: rezerv/yoldaki ve stok etkisinin işleneceği depo; boşsa varsayılan */
  depoId: z.string().uuid().optional().nullable(),
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
  kur: pozitifOndalik.default("1"),
  genelIskontoYuzdesi: pozitifOndalik.default("0"),
  genelIskontoTutari: pozitifOndalik.default("0"),
  aciklama: z.string().max(500).optional().nullable(),
  notlar: z.string().max(2000).optional().nullable(),
  /**
   * e-İrsaliye taşıma bilgileri (EBLG-23). Diğer belge türlerinde yok sayılır;
   * zorunluluk irsaliye onayında değil, e-İrsaliye gönderiminde denetlenir.
   */
  fiiliSevkZamani: z.iso.datetime({ offset: true, message: "Geçersiz tarih/saat" }).optional().nullable(),
  /** Taşıyan nakliyeci/kargo carisi; boşsa mal kendi aracımızla götürülür. */
  tasiyiciCariId: z.string().uuid().optional().nullable(),
  // Şematron 14.09.2026 §3: plaka biçimi GİB tarafından denetleniyor; boşluklu
  // ya da küçük harfli yazım belgeyi reddettiriyor. Girdi normalize edilip
  // kalıba uymayan değer daha kayıt anında durdurulur.
  plaka: plakaAlani,
  dorsePlaka: plakaAlani,
  soforAdi: z.string().max(80).optional().nullable(),
  soforSoyadi: z.string().max(80).optional().nullable(),
  soforTckn: z.string().regex(/^\d{11}$/, "Şoför TCKN 11 haneli olmalıdır").optional().nullable(),
  /** İDİS sevkiyat numarası (EBLG-72): doluysa e-İrsaliye IDISIRSALIYE profiliyle gider. */
  idisSevkiyatNo: z.string().max(20).optional().nullable(),
  /**
   * EBLG-84: irsaliyeye özel teslimat adresi; ihracatta malın çıkacağı gümrük
   * kapısı. Doluysa carinin sevk adresinin önüne geçer.
   */
  teslimatAdres: z.string().max(500).optional().nullable(),
  teslimatIl: z.string().max(60).optional().nullable(),
  teslimatIlce: z.string().max(60).optional().nullable(),
  teslimatPostaKodu: z.string().max(10).optional().nullable(),
  /**
   * EBLG-87: ithal malın gümrükten depoya kısım kısım taşınması. Yalnız alış
   * irsaliyesinde geçerlidir; firma e-İrsaliye olarak gönderir.
   */
  gumrukDepoSevki: z.boolean().optional(),
  gumrukBeyannameNo: z.string().max(40).optional().nullable(),
  gumrukBeyannameTarihi: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)").optional().nullable(),
  yuklemeAdres: z.string().max(500).optional().nullable(),
  yuklemeIl: z.string().max(60).optional().nullable(),
  yuklemeIlce: z.string().max(60).optional().nullable(),
  yuklemePostaKodu: z.string().max(10).optional().nullable(),
  satirlar: z.array(belgeSatirSemasi).min(1, "Belgede en az bir satır bulunmalıdır"),
});

export const belgeGuncelleSemasi = guncellemeSemasi(belgeOlusturSemasi.omit({ tur: true, yon: true }));

export const belgeDonusturSemasi = z.object({
  hedef: z.enum(["siparis", "irsaliye", "fatura"]),
  /**
   * SAT-09: siparişten irsaliyeye kısmi teslim. Verilmezse her satırın kalanı
   * dönüşür; verilen miktarlar satırın kalanını aşamaz (sunucuda denetlenir).
   */
  kalemler: z
    .array(
      z.object({
        satirId: z.string().uuid(),
        miktar: z
          .union([z.string(), z.number()])
          .transform((v) => String(v).trim())
          .pipe(z.string().regex(/^\d{1,13}(\.\d{1,3})?$/, "Teslim miktarı sayı olmalıdır")),
      }),
    )
    .min(1)
    .max(500)
    .optional(),
});

/** FTR-13: bekleyen sipariş/irsaliyeleri tek faturada birleştirme. */
export const topluFaturaSemasi = z.object({
  belgeIds: z.array(z.string().uuid()).min(1, "En az bir belge seçin"),
});

/** FTR-26: onaylı irsaliyeleri var olan bir faturaya bağlar. */
export const irsaliyeBaglaSemasi = z.object({
  faturaId: z.string().uuid("Geçersiz fatura"),
  irsaliyeIds: z.array(z.string().uuid()).min(1, "Bağlanacak en az bir irsaliye seçin").max(100),
});

/**
 * Onaylanmış irsaliyede yalnız taşıma bilgileri düzenlenebilir (EBLG-23).
 * Mal yola çıkarken bilinen bilgiler bunlar; belgenin ticari içeriği kilitli
 * kalır, e-İrsaliye gönderildikten sonra bunlar da kilitlenir.
 */
export const tasimaBilgisiSemasi = belgeOlusturSemasi.pick({
  fiiliSevkZamani: true,
  // Sevkiyat numarası Darphane bildiriminden döner; irsaliye onaylandıktan
  // sonra girilebilmeli (EBLG-72).
  idisSevkiyatNo: true,
  // EBLG-84: gümrük kapısı çoğu zaman mal yüklenirken belli olur.
  teslimatAdres: true,
  teslimatIl: true,
  teslimatIlce: true,
  teslimatPostaKodu: true,
  tasiyiciCariId: true,
  plaka: true,
  dorsePlaka: true,
  soforAdi: true,
  soforSoyadi: true,
  soforTckn: true,
});

/**
 * FTR-27: tedarikçinin irsaliye numarası onaydan sonra da girilebilir —
 * kâğıt irsaliye çoğu zaman mal teslim alındıktan sonra elden gelir.
 */
export const tedarikciBelgeNoSemasi = z.object({
  tedarikciBelgeNo: z.string().max(50).nullable(),
});

/** EBLG-83: kâğıt irsaliyenin basımevi (matbu) numarası; onaydan sonra girilir. */
export const matbuBelgeNoSemasi = z.object({
  matbuBelgeNo: z.string().max(50).nullable(),
});
