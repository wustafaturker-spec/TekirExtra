import { vknTcknGecerliMi } from "@tekirextra/shared";
import { z } from "zod";

export const CARI_TIPLERI = [
  "musteri",
  "tedarikci",
  "her_ikisi",
  "personel",
  "ortak",
  "diger",
] as const;
export const KISI_TIPLERI = ["gercek", "tuzel"] as const;
export const DOVIZLER = ["TRY", "USD", "EUR"] as const;

/** Ondalık girdiler API'de string taşınır (hassasiyet korunur, NFR-10). */
const ondalik = z
  .string()
  .regex(/^-?\d{1,13}(\.\d{1,6})?$/, "Geçersiz sayısal değer");
const pozitifOndalik = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli");

export const cariOlusturSemasi = z.object({
  kod: z.string().min(1).max(32),
  unvan: z.string().min(2).max(255),
  kisaAd: z.string().max(80).optional(),
  tip: z.enum(CARI_TIPLERI),
  kisiTipi: z.enum(KISI_TIPLERI).default("tuzel"),
  sektor: z.string().max(120).optional(),
  temsilciUserId: z.uuid().optional(),
  vknTckn: z
    .string()
    .regex(/^\d{10,11}$/)
    .refine(vknTcknGecerliMi, "Geçersiz VKN/TCKN (kontrol hanesi tutmuyor)")
    .optional(),
  vergiDairesi: z.string().max(120).optional(),
  mersisNo: z.string().regex(/^\d{16}$/, "MERSİS no 16 haneli olmalıdır").optional(),
  ticaretSicilNo: z.string().max(32).optional(),
  kvkkOnayTarihi: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)").optional(),
  eposta: z.email("Geçerli bir e-posta adresi girilmelidir").optional().nullable(),
  telefon: z.string().max(32, "Telefon en fazla 32 karakter olabilir").optional().nullable(),
  webSitesi: z.url("Geçerli bir web sitesi adresi girilmelidir").optional().nullable(),
  faks: z.string().max(32, "Faks en fazla 32 karakter olabilir").optional().nullable(),
  iban: z.string().max(34).optional(),
  karaListe: z.boolean().default(false),
  karaListeNotu: z.string().max(500).optional(),
  dovizCinsi: z.enum(DOVIZLER).default("TRY"),
  fiyatListesiId: z.uuid().optional(),
  varsayilanIskonto: pozitifOndalik.optional(),
  varsayilanVadeGun: z.number().int().min(0).max(365).optional(),
  riskLimiti: pozitifOndalik.optional(),
  notlar: z.string().max(2000).optional(),
});
export const cariGuncelleSemasi = cariOlusturSemasi.partial().extend({
  aktif: z.boolean().optional(),
  kisaAd: z.string().max(120).optional().nullable(),
  sektor: z.string().max(80).optional().nullable(),
  vknTckn: z.string().regex(/^\d{10}$|^\d{11}$/, "VKN 10, TCKN 11 haneli olmalıdır").optional().nullable(),
  vergiDairesi: z.string().max(120).optional().nullable(),
  mersisNo: z.string().regex(/^\d{16}$/, "MERSİS no 16 haneli olmalıdır").optional().nullable(),
  ticaretSicilNo: z.string().max(32).optional().nullable(),
});

export const adresSemasi = z.object({
  tip: z.enum(["fatura", "sevk", "merkez", "sube", "depo"]),
  baslik: z.string().min(1).max(80),
  adres: z.string().min(2).max(500),
  il: z.string().max(60).optional(),
  ilce: z.string().max(60).optional(),
  postaKodu: z.string().max(10).optional(),
  ulke: z.string().length(2).default("TR"),
});

export const bankaHesapSemasi = z.object({
  bankaAdi: z.string().min(2).max(120),
  subeAdi: z.string().max(120).optional(),
  hesapSahibi: z.string().max(160).optional(),
  iban: z
    .string()
    .regex(/^TR\d{24}$/i, "IBAN 'TR' + 24 rakam olmalıdır")
    .transform((v) => v.toUpperCase()),
  swift: z.string().max(11).optional(),
  paraBirimi: z.enum(DOVIZLER).default("TRY"),
});

export const etiketSemasi = z.object({
  ad: z.string().min(1).max(40),
  renk: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Renk #RRGGBB biçiminde olmalıdır")
    .optional(),
});

export const kisiSemasi = z.object({
  adSoyad: z.string().min(2).max(120),
  gorev: z.string().max(80).optional(),
  telefon: z.string().max(32).optional(),
  eposta: z.email().optional(),
});

export const cariHareketSemasi = z.object({
  tip: z.enum(["borc", "alacak"]),
  tutar: pozitifOndalik,
  dovizCinsi: z.enum(DOVIZLER).default("TRY"),
  kur: pozitifOndalik.default("1"),
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  vadeTarihi: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)").optional(),
  aciklama: z.string().max(500).optional(),
});

export const crmEtkilesimSemasi = z.object({
  tip: z.enum(["gorusme", "telefon", "eposta", "ziyaret", "not"]),
  konu: z.string().trim().min(2).max(160),
  aciklama: z.string().trim().max(4000).optional().nullable(),
  tarih: z.string().datetime({ offset: true }),
});

export const crmGorevSemasi = z.object({
  baslik: z.string().trim().min(2).max(200),
  aciklama: z.string().trim().max(4000).optional().nullable(),
  atananUserId: z.string().uuid().optional(),
  sonTarih: z.string().datetime({ offset: true }),
  hatirlatmaTarihi: z.string().datetime({ offset: true }).optional().nullable(),
  oncelik: z.enum(["dusuk", "normal", "yuksek"]).default("normal"),
});

export const crmGorevDurumSemasi = z.object({ durum: z.enum(["acik", "tamamlandi", "iptal"]) });

export const ekstreEpostaSemasi = z.object({
  baslangic: z.string().date().optional(),
  bitis: z.string().date().optional(),
  alici: z.email("Geçerli bir alıcı e-posta adresi girilmelidir").optional(),
}).refine((g) => !g.baslangic || !g.bitis || g.baslangic <= g.bitis, { message: "Başlangıç tarihi bitiş tarihinden sonra olamaz", path: ["bitis"] });

export type CariOlusturGirdisi = z.infer<typeof cariOlusturSemasi>;
export type CariHareketGirdisi = z.infer<typeof cariHareketSemasi>;
export { ondalik, pozitifOndalik };
