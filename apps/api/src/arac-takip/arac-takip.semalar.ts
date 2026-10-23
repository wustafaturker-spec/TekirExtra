import { z } from "zod";
import { GIDER_KATEGORILERI, YUKUMLULUK_TURLERI } from "./arac-hesap";

const tarih = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalıdır");
const metin = (azami: number) => z.string().trim().max(azami);
const km = z.coerce.number().int().min(0).max(5_000_000);

/** ARC-01/02/07: araç kartının takip alanları (plaka ve e-İrsaliye alanları sevkiyat ekranındadır). */
export const aracGuncelleSemasi = z
  .object({
    marka: metin(80).nullable(),
    model: metin(80).nullable(),
    modelYili: z.coerce.number().int().min(1950).max(2100).nullable(),
    saseNo: metin(40).nullable(),
    tur: z.enum(["binek", "hafif_ticari", "agir_vasita", "motosiklet", "is_makinesi", "diger"]).nullable(),
    yakitTuru: z.enum(["benzin", "dizel", "lpg", "elektrik", "hibrit", "diger"]).nullable(),
    mulkiyet: z.enum(["oz", "kiralik", "diger"]).nullable(),
    demirbasId: z.string().uuid().nullable(),
    kiraSozlesmeId: z.string().uuid().nullable(),
    sorumluPersonelId: z.string().uuid().nullable(),
    binekSinirYok: z.boolean(),
    bakimKmAraligi: z.coerce.number().int().min(100).max(500_000).nullable(),
    bakimAyAraligi: z.coerce.number().int().min(1).max(120).nullable(),
    sonBakimTarihi: tarih.nullable(),
    sonBakimKm: km.nullable(),
    aciklama: metin(500).nullable(),
    aktif: z.boolean(),
  })
  .partial();

export const yukumlulukSemasi = z.object({
  tur: z.enum(YUKUMLULUK_TURLERI),
  baslangic: tarih.nullable().optional(),
  bitis: tarih,
  belgeNo: metin(80).nullable().optional(),
  tutar: z.coerce.number().positive().max(1e12).nullable().optional(),
  aciklama: metin(500).nullable().optional(),
});

export const giderBagSemasi = z
  .object({
    masrafId: z.string().uuid().optional(),
    faturaSatirId: z.string().uuid().optional(),
    kategori: z.enum(GIDER_KATEGORILERI),
    litre: z.coerce.number().positive().max(100_000).nullable().optional(),
    km: km.nullable().optional(),
    kmGerekcesi: metin(300).nullable().optional(),
  })
  .refine((g) => Boolean(g.masrafId) !== Boolean(g.faturaSatirId), "Bir masraf ya da bir fatura satırı seçilmelidir");

export const kmSemasi = z.object({ tarih, km, gerekce: metin(300).nullable().optional() });

export const bakimSemasi = z.object({
  tarih,
  km: km.nullable().optional(),
  aciklama: metin(500).min(2, "Açıklama zorunludur"),
  aracGiderId: z.string().uuid().nullable().optional(),
  kmGerekcesi: metin(300).nullable().optional(),
});

export const cezaSemasi = z.object({
  tarih,
  tutar: z.coerce.number().positive().max(1e9),
  ihlal: metin(300).min(2, "İhlal zorunludur"),
  yer: metin(200).nullable().optional(),
  personelId: z.string().uuid().nullable().optional(),
  tahsilNotu: metin(500).nullable().optional(),
  aracGiderId: z.string().uuid().nullable().optional(),
});

export const donemSemasi = z.object({ baslangic: tarih, bitis: tarih }).refine((d) => d.baslangic <= d.bitis, "Başlangıç bitişten sonra olamaz");
