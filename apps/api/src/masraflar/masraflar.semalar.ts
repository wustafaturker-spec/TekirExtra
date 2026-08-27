import { z } from "zod";

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
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
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
});

export const masrafGuncelleSemasi = masrafOlusturSemasi;

export const masrafOdemeSemasi = z.object({
  kasaId: bosVeyaUuid,
  bankaHesapId: bosVeyaUuid,
  odemeTarihi: z.coerce.date(),
  tutar: z.coerce.number().positive("Ödeme tutarı sıfırdan büyük olmalıdır"),
  aciklama: z.union([z.string().trim().max(500), z.literal(""), z.null()]).optional(),
}).superRefine((girdi, ctx) => {
  if ((!girdi.kasaId && !girdi.bankaHesapId) || (girdi.kasaId && girdi.bankaHesapId)) {
    ctx.addIssue({ code: "custom", message: "Tam olarak bir kasa veya banka hesabı seçilmelidir" });
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
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
}).superRefine((girdi, ctx) => {
  if (!girdi.cariId && !girdi.kirayaVeren) ctx.addIssue({ code: "custom", path: ["kirayaVeren"], message: "Cari seçilmediğinde kiraya veren adı zorunludur" });
  if (girdi.bitisTarihi && girdi.bitisTarihi < girdi.baslangicTarihi) ctx.addIssue({ code: "custom", path: ["bitisTarihi"], message: "Bitiş tarihi başlangıçtan önce olamaz" });
});

export const kiraSozlesmeGuncelleSemasi = kiraSozlesmeOlusturSemasi;

export const kiraDonemOlusturSemasi = z.object({ donem: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Dönem YYYY-AA biçiminde olmalıdır") });
