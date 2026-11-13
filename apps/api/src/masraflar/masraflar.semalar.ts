import { z } from "zod";
import { DOVIZ_CINSLERI } from "@tekirextra/shared";

const bosVeyaUuid = z.union([z.string().uuid(), z.literal(""), z.null()]).optional();
const bosVeyaMetin = z.union([z.string().trim().max(250), z.literal(""), z.null()]).optional();

export const kategoriOlusturSemasi = z.object({
  ad: z.string().trim().min(2).max(80),
  ustId: bosVeyaUuid,
  varsayilanKdvOrani: z.coerce.number().min(0).max(100).nullable().optional(),
  muhasebeKodu: bosVeyaMetin,
});

export const kategoriGuncelleSemasi = kategoriOlusturSemasi.partial().refine((girdi) => Object.keys(girdi).length > 0, "En az bir alan gönderilmelidir");

export const masrafOlusturSemasi = z.object({
  kategoriId: z.string().uuid(),
  cariId: bosVeyaUuid,
  belgeTuru: z.enum(["fis", "fatura", "kira", "dekont", "serbest_meslek_makbuzu", "diger"]),
  belgeNo: bosVeyaMetin,
  tarih: z.coerce.date(),
  vadeTarihi: z.coerce.date().nullable().optional(),
  saticiUnvan: bosVeyaMetin,
  vknTckn: bosVeyaMetin,
  vergiDairesi: bosVeyaMetin,
  iban: bosVeyaMetin,
  aciklama: z.union([z.string().trim().max(1000), z.literal(""), z.null()]).optional(),
  matrah: z.coerce.number().positive(),
  kdvOrani: z.coerce.number().min(0).max(100),
  kdvTutari: z.coerce.number().min(0),
  toplam: z.coerce.number().positive(),
  dovizCinsi: z.enum(DOVIZ_CINSLERI).default("TRY"),
  kur: z.coerce.number().positive().default(1),
  stopajOrani: z.coerce.number().min(0).max(100).nullable().optional(),
  stopajTutari: z.coerce.number().min(0).nullable().optional(),
  projeId: bosVeyaUuid,
  projeAltKirilimId: bosVeyaUuid,
}).superRefine((girdi, ctx) => {
  if (!girdi.cariId && !girdi.saticiUnvan) {
    ctx.addIssue({ code: "custom", path: ["saticiUnvan"], message: "Cari seçilmediğinde satıcı/kiraya veren adı zorunludur" });
  }
  const hesaplanan = girdi.matrah + girdi.kdvTutari;
  if (Math.abs(hesaplanan - girdi.toplam) > 0.02) {
    ctx.addIssue({ code: "custom", path: ["toplam"], message: "Toplam, matrah ve KDV toplamıyla uyuşmuyor" });
  }
  // Kur olmadan dövizli masrafın TL karşılığı yazılamaz; 1 kabul etmek döviz
  // tutarını TL sanmak demektir.
  if (girdi.dovizCinsi !== "TRY" && girdi.kur === 1) {
    ctx.addIssue({ code: "custom", path: ["kur"], message: "Dövizli masrafta belge tarihindeki kur girilmelidir" });
  }
});

export const masrafGuncelleSemasi = masrafOlusturSemasi;

/**
 * AI-13: çok oranlı fiş — oran başına ayrı masraf taslağı (aynı belge no, satıcı, tarih ve döviz).
 * Ortak alanlar bir kez gelir; her oranın tutarları ayrı satırdır.
 */
export const oranlaraGoreMasrafSemasi = z.object({
  ortak: z.record(z.string(), z.unknown()),
  oranlar: z.array(z.object({
    kdvOrani: z.coerce.number().min(0).max(100),
    matrah: z.coerce.number().positive(),
    kdvTutari: z.coerce.number().min(0),
  })).min(2, "Oran başına ayırma için en az iki oran gerekir").max(10),
  ocrKayitId: z.string().uuid().optional(),
}).superRefine((g, ctx) => {
  if (new Set(g.oranlar.map((o) => o.kdvOrani)).size !== g.oranlar.length) ctx.addIssue({ code: "custom", path: ["oranlar"], message: "Her KDV oranı bir kez yazılmalı" });
});


export const masrafOdemeSemasi = z.object({
  kasaId: bosVeyaUuid,
  bankaHesapId: bosVeyaUuid,
  krediKartiId: bosVeyaUuid,
  odemeTarihi: z.coerce.date(),
  tutar: z.coerce.number().positive("Ödeme tutarı sıfırdan büyük olmalıdır"),
  taksitSayisi: z.coerce.number().int().min(1).max(36).default(1),
  ilkTaksitTarihi: z.coerce.date().optional(),
  aciklama: z.union([z.string().trim().max(500), z.literal(""), z.null()]).optional(),
}).superRefine((girdi, ctx) => {
  if ([girdi.kasaId, girdi.bankaHesapId, girdi.krediKartiId].filter(Boolean).length !== 1) {
    ctx.addIssue({ code: "custom", message: "Tam olarak bir kasa, banka hesabı veya kredi kartı seçilmelidir" });
  }
});

export const kiraSozlesmeOlusturSemasi = z.object({
  kategoriId: z.string().uuid(),
  cariId: bosVeyaUuid,
  baslik: z.string().trim().min(2).max(120),
  tasinmazAdresi: z.union([z.string().trim().max(500), z.literal(""), z.null()]).optional(),
  kirayaVeren: bosVeyaMetin,
  vknTckn: bosVeyaMetin,
  iban: bosVeyaMetin,
  baslangicTarihi: z.coerce.date(),
  bitisTarihi: z.coerce.date().nullable().optional(),
  odemeGunu: z.coerce.number().int().min(1).max(31),
  matrah: z.coerce.number().positive(),
  kdvOrani: z.coerce.number().min(0).max(100).default(0),
  stopajOrani: z.coerce.number().min(0).max(100).default(0),
  dovizCinsi: z.enum(DOVIZ_CINSLERI).default("TRY"),
}).superRefine((girdi, ctx) => {
  if (!girdi.cariId && !girdi.kirayaVeren) ctx.addIssue({ code: "custom", path: ["kirayaVeren"], message: "Cari seçilmediğinde kiraya veren adı zorunludur" });
  if (girdi.bitisTarihi && girdi.bitisTarihi < girdi.baslangicTarihi) ctx.addIssue({ code: "custom", path: ["bitisTarihi"], message: "Bitiş tarihi başlangıçtan önce olamaz" });
});

export const kiraSozlesmeGuncelleSemasi = kiraSozlesmeOlusturSemasi;

export const kiraDonemOlusturSemasi = z.object({ donem: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Dönem YYYY-AA biçiminde olmalıdır") });
