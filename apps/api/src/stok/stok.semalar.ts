import { z } from "zod";
import { SARJ_TURLERI, birimCoz, DOVIZ_CINSLERI } from "@tekirextra/shared";
import { guncellemeSemasi } from "../core/sema";

const pozitifOndalik = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli");

/**
 * Birim listeden gelir (STK-01); "Kg.", "lt" gibi yazımlar listedeki ada
 * çevrilir, karşılığı olmayan birim reddedilir — GİB koduna düşmeyen birim
 * giden belgeye adet olarak yazılıyordu.
 */
export const birimAlani = z.string().min(1).max(20).transform((birim, ctx) => {
  const ad = birimCoz(birim);
  if (!ad) {
    ctx.addIssue({ code: "custom", message: `'${birim}' birimi tanınmıyor; listeden bir birim seçin` });
    return z.NEVER;
  }
  return ad;
});

export const STOK_TIPLERI = ["urun", "hizmet", "sarf"] as const;

/** STK-19: fire/zayi/numune/promosyon çıkış gibi, acilis giriş gibi işlenir. */
export const STOK_HAREKET_TIPLERI = [
  "giris",
  "cikis",
  "sayim_duzeltme",
  "fire",
  "zayi",
  "numune",
  "promosyon",
  "acilis",
] as const;

export const stokKartOlusturSemasi = z.object({
  kod: z.string().min(1).max(32),
  ad: z.string().min(2).max(255),
  kisaAd: z.string().max(80).optional().nullable(),
  aciklama: z.string().max(2000).optional().nullable(),
  tip: z.enum(STOK_TIPLERI).default("urun"),
  marka: z.string().max(120).optional().nullable(),
  model: z.string().max(120).optional().nullable(),
  mensei: z.string().max(60).optional().nullable(),
  gtipKodu: z.string().max(20).optional().nullable(),
  /** EBLG-71: kart satıra düştüğünde fatura tipi buradan türer. */
  sarjTuru: z.enum(SARJ_TURLERI).optional().nullable(),
  ureticiUrunKodu: z.string().max(64).optional().nullable(),
  barkod: z.string().max(120).optional().nullable(),
  kategoriId: z.string().uuid().optional().nullable(),
  anaBirim: birimAlani.default("adet"),
  kdvOrani: pozitifOndalik.default("20"),
  alisFiyati: pozitifOndalik.optional().nullable(),
  satisFiyati: pozitifOndalik.optional().nullable(),
  alisFiyatiDoviz: z.enum(DOVIZ_CINSLERI).default("TRY"),
  satisFiyatiDoviz: z.enum(DOVIZ_CINSLERI).default("TRY"),
  kritikSeviye: pozitifOndalik.optional().nullable(),
  minStok: pozitifOndalik.optional().nullable(),
  maksStok: pozitifOndalik.optional().nullable(),
  guvenlikStogu: pozitifOndalik.optional().nullable(),
  tedarikSuresiGun: z.number().int().min(0).max(365).optional().nullable(),
  gorselUrl: z.string().url().max(500).optional().nullable(),
  takipTipi: z.enum(["yok", "lot", "seri"]).default("yok"),
});

export const stokKartGuncelleSemasi = guncellemeSemasi(stokKartOlusturSemasi).extend({
  aktif: z.boolean().optional(),
});

export const kategoriSemasi = z.object({
  ad: z.string().min(2).max(100),
  ustId: z.string().uuid().optional().nullable(),
});

export const stokBirimSemasi = z.object({
  ad: birimAlani,
  katsayi: pozitifOndalik,
});

export const stokHareketOlusturSemasi = z.object({
  stokId: z.string().uuid(),
  varyantId: z.string().uuid().optional().nullable(),
  /** STK-07: boşsa varsayılan depo kullanılır (tek depolu firmalarda arayüz sormaz) */
  depoId: z.string().uuid().optional().nullable(),
  tip: z.enum(STOK_HAREKET_TIPLERI),
  miktar: pozitifOndalik,
  girilenBirim: z.string().min(1).max(20),
  girilenMiktar: pozitifOndalik,
  maliyet: pozitifOndalik.default("0"),
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  aciklama: z.string().max(500).optional().nullable(),
  partiler: z.array(z.object({
    lotNo: z.string().min(1).max(100),
    seriNo: z.string().min(1).max(160).optional().nullable(),
    sonKullanmaTarihi: z.string().date().optional().nullable(),
    uretimTarihi: z.string().date().optional().nullable(),
    miktar: pozitifOndalik,
  })).optional().default([]),
});

export const stokBarkodSemasi = z.object({
  barkod: z.string().min(3).max(120),
  birim: z.string().max(20).optional().nullable(),
  satisFiyati: pozitifOndalik.optional().nullable(),
});

export const stokTedarikciSemasi = z.object({
  cariId: z.string().uuid(),
  tedarikciUrunKodu: z.string().max(64).optional().nullable(),
  alisFiyati: pozitifOndalik.optional().nullable(),
  dovizCinsi: z.enum(DOVIZ_CINSLERI).default("TRY"),
  tedarikSuresiGun: z.number().int().min(0).max(365).optional().nullable(),
  varsayilan: z.boolean().default(false),
  /** STK-23: verilirse tedarikçinin varyant kodları bu listeyle değiştirilir. */
  varyantKodlari: z.array(z.object({ varyantId: z.string().uuid(), tedarikciUrunKodu: z.string().trim().min(1).max(64) })).optional(),
});

export const stokVaryantSemasi = z.object({
  kod: z.string().min(1).max(64),
  ad: z.string().min(1).max(160),
  nitelikler: z.record(z.string(), z.string().min(1).max(80)).refine((v) => Object.keys(v).length > 0, "En az bir nitelik gerekli"),
  barkod: z.string().min(3).max(120).optional().nullable(),
  alisFiyati: pozitifOndalik.optional().nullable(),
  satisFiyati: pozitifOndalik.optional().nullable(),
});

/** Kombinasyon üretecinden gelen varyantlar tek seferde, hep ya da hiç oluşturulur. */
export const stokVaryantTopluSemasi = z.object({
  varyantlar: z.array(stokVaryantSemasi).min(1, "En az bir varyant seçin").max(200, "Tek seferde en fazla 200 varyant oluşturulabilir"),
});

export const stokVaryantGuncelleSemasi = stokVaryantSemasi.partial().extend({ aktif: z.boolean().optional() });

export const stokFiyatSemasi = z.object({
  varyantId: z.string().uuid().optional().nullable(),
  tip: z.enum(["alis", "satis"]),
  dovizCinsi: z.enum(DOVIZ_CINSLERI),
  tutar: pozitifOndalik,
  aktif: z.boolean().optional().default(true),
});

/** Barkod etiket basımı (STK-15 devamı, 4. aşama). */
export const etiketBasSemasi = z.object({
  kalemler: z
    .array(
      z.object({
        stokId: z.string().uuid(),
        adet: z.number().int().min(1).max(500).default(1),
        /** Belirli bir barkod seçimi; boşsa ürünün ilk barkodu kullanılır. */
        barkod: z.string().max(120).optional(),
      }),
    )
    .min(1, "En az bir etiket kalemi gerekli"),
});

export const sayimKalemSemasi = z.object({
  stokId: z.string().uuid(),
  fiiliMiktar: pozitifOndalik,
});

export const sayimOlusturSemasi = z.object({
  /** STK-07: bir sayım tek depoyu kapsar; boşsa varsayılan depo */
  depoId: z.string().uuid().optional().nullable(),
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  aciklama: z.string().max(500).optional().nullable(),
  kalemler: z.array(sayimKalemSemasi).min(1, "En az bir sayım kalemi eklemelisiniz"),
});
