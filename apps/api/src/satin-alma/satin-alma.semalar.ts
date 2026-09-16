import { z } from "zod";

const ondalik = (ad: string, basamak: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().regex(new RegExp(`^\\d{1,13}(\\.\\d{1,${basamak}})?$`), `${ad} sıfır ya da pozitif bir sayı olmalıdır`));

const pozitif = (ad: string, basamak: number) => ondalik(ad, basamak).refine((v) => Number(v) > 0, `${ad} sıfırdan büyük olmalıdır`);

const DOVIZLER = ["TRY", "USD", "EUR"] as const;

export const idSemasi = z.string().uuid("Geçersiz kimlik");

/** SAT-01 */
export const talepSemasi = z.object({
  departmanId: z.string().uuid().nullable().optional(),
  ihtiyacTarihi: z.string().date("İhtiyaç tarihi YYYY-AA-GG biçiminde olmalıdır"),
  gerekce: z.string().trim().min(3, "Gerekçe en az 3 karakter olmalıdır").max(1000),
  butceAnahtari: z.string().min(1, "Bütçe kalemi seçin").max(120),
  kalemler: z
    .array(
      z.object({
        stokId: z.string().uuid("Kalem için stok veya hizmet kartı seçin"),
        miktar: pozitif("Miktar", 3),
        tahminiBirimFiyat: ondalik("Tahmini birim fiyat", 4),
      }),
    )
    .min(1, "Talepte en az bir kalem bulunmalıdır")
    .max(200),
});

export const kapsamSemasi = z.enum(["benim", "onay", "tum"]).catch("benim");

/** SAT-04: bütçe aşılıyorsa gerekçe servis tarafında zorunlu tutulur. */
export const onaySemasi = z.object({ butceAsimGerekcesi: z.string().trim().max(500).optional() });

export const redSemasi = z.object({ gerekce: z.string().trim().min(5, "Red gerekçesi en az 5 karakter olmalıdır").max(500) });

export const iptalSemasi = z.object({ gerekce: z.string().trim().max(500).optional() });

const teklifTemeli = z.object({
  tedarikciCariId: z.string().uuid("Tedarikçi seçin"),
  dovizCinsi: z.enum(DOVIZLER).default("TRY"),
  kur: pozitif("Kur", 6).default("1"),
  kalemler: z
    .array(
      z.object({
        talepKalemiId: z.string().uuid(),
        birimFiyat: ondalik("Birim fiyat", 4),
        kdvOrani: ondalik("KDV oranı", 2).refine((v) => Number(v) <= 100, "KDV oranı 100'ü aşamaz"),
      }),
    )
    .min(1, "Teklifte en az bir kalem fiyatı bulunmalıdır"),
});

/** DVZ: dövizli kayıtta kur 1 "tutar zaten TL" demektir ve kabul edilmez. */
const kurKurali = (g: { dovizCinsi: string; kur: string }) => g.dovizCinsi === "TRY" || Number(g.kur) !== 1;
const kurMesaji = { message: "Dövizli teklifte kur 1 olamaz; teklif tarihindeki kuru girin", path: ["kur"] };

/** SAT-05 */
export const teklifSemasi = teklifTemeli
  .extend({
    teslimSuresiGun: z.number().int().min(0).max(365).nullable().optional(),
    gecerlilikTarihi: z.string().date("Geçerlilik tarihi YYYY-AA-GG biçiminde olmalıdır").nullable().optional(),
    aciklama: z.string().trim().max(1000).nullable().optional(),
  })
  .refine(kurKurali, kurMesaji);

export const teklifSecSemasi = z.object({ gerekce: z.string().trim().max(500).optional() });

/** SAT-06: teklif girilmemiş talepte tedarikçi ve fiyatlar `dogrudan` ile verilir. */
export const siparisSemasi = z.object({
  depoId: z.string().uuid().nullable().optional(),
  dogrudan: teklifTemeli.refine(kurKurali, kurMesaji).optional(),
});

export type TalepGirdisi = z.infer<typeof talepSemasi>;
export type TeklifGirdisi = z.infer<typeof teklifSemasi>;
export type SiparisGirdisi = z.infer<typeof siparisSemasi>;
