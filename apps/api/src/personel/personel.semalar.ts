import { z } from "zod";
import { guncellemeSemasi } from "../core/sema";
import { tcknGecerliMi } from "@tekirextra/shared";

const bosVeyaUuid = z.union([z.string().uuid(), z.literal(""), z.null()]).optional();
const bosVeyaMetin = z.union([z.string().trim().max(250), z.literal(""), z.null()]).optional();

export const personelOlusturSemasi = z.object({
  ad: z.string().trim().min(2, "Ad en az 2 karakter olmalıdır").max(50),
  soyad: z.string().trim().min(2, "Soyad en az 2 karakter olmalıdır").max(50),
  tckn: z.union([
    z.string().trim().regex(/^\d{11}$/, "TCKN 11 haneli olmalıdır").refine(tcknGecerliMi, "Geçersiz TCKN"),
    z.literal(""),
    z.null(),
  ]).optional(),
  eposta: z.union([z.string().email("Geçerli bir e-posta giriniz"), z.literal(""), z.null()]).optional(),
  telefon: bosVeyaMetin,
  departman: bosVeyaMetin,
  unvan: bosVeyaMetin,
  calismaTipi: z.enum(["tam_zamanli", "yari_zamanli", "sozlesmeli"]).default("tam_zamanli"),
  girisTarihi: z.coerce.date(),
  cikisTarihi: z.coerce.date().nullable().optional(),
  netMaas: z.coerce.number().positive("Net maaş sıfırdan büyük olmalıdır"),
  brutMaas: z.coerce.number().positive("Brüt maaş sıfırdan büyük olmalıdır").optional().nullable(),
  engellilikDerecesi: z.coerce.number().int().min(1).max(3).optional().nullable(),
  sgkTesvikOrani: z.coerce.number().min(0).max(100).default(0),
  iban: z.union([
    z.string().transform((deger) => deger.replace(/\s/g, "").toUpperCase()).pipe(z.string().regex(/^TR\d{24}$/, "Geçerli bir TR IBAN giriniz")),
    z.literal(""),
    z.null(),
  ]).optional(),
  cariOlustur: z.boolean().default(true),
});

export const personelGuncelleSemasi = guncellemeSemasi(personelOlusturSemasi);

export const personelIstenCikarSemasi = z.object({
  cikisTarihi: z.coerce.date(),
  ayrilisNedeni: z.string().trim().min(3, "Ayrılış nedeni en az 3 karakter olmalıdır").max(500),
});

export const personelYenidenBaslatSemasi = z.object({
  girisTarihi: z.coerce.date(),
});

export const bordroTahakkukSemasi = z.object({
  donemYil: z.coerce.number().int().min(2020).max(2100),
  donemAy: z.coerce.number().int().min(1).max(12),
});

export const donemCalismaSemasi = z.object({
  personelId: z.string().uuid(), yil: z.coerce.number().int().min(2020).max(2100), ay: z.coerce.number().int().min(1).max(12),
  primGunu: z.coerce.number().int().min(0).max(30),
  eksikGunNedeni: z.enum(["istirahat", "ucretsiz_izin", "disiplin", "gozaltina_alinma", "kismi_istihdam", "puantaj", "diger"]).optional().nullable(),
  aciklama: z.string().trim().max(500).optional().nullable(),
  sgkTesvikOrani: z.coerce.number().min(0).max(100).optional().nullable(),
  sahisSigortaPrimi: z.coerce.number().min(0).max(100_000_000).default(0),
  hayatSigortaPrimi: z.coerce.number().min(0).max(100_000_000).default(0),
  sendikaAidati: z.coerce.number().min(0).max(100_000_000).default(0),
  fazlaMesaiBrut: z.coerce.number().min(0).max(100_000_000).default(0),
  primIkramiyeBrut: z.coerce.number().min(0).max(100_000_000).default(0),
  nakitYemekYardimi: z.coerce.number().min(0).max(100_000_000).default(0),
  fiiliCalismaGunu: z.coerce.number().int().min(0).max(31).default(0),
}).superRefine((v, ctx) => {
  if (v.primGunu < 30 && !v.eksikGunNedeni) ctx.addIssue({ code: "custom", path: ["eksikGunNedeni"], message: "30 günden az bildirimde eksik gün nedeni zorunludur" });
  if (v.primGunu === 30 && v.eksikGunNedeni) ctx.addIssue({ code: "custom", path: ["eksikGunNedeni"], message: "30 günlük bildirimde eksik gün nedeni seçilemez" });
  if (v.primGunu === 0 && (v.fazlaMesaiBrut > 0 || v.primIkramiyeBrut > 0 || v.nakitYemekYardimi > 0)) ctx.addIssue({ code: "custom", path: ["primGunu"], message: "Kazanç veya yemek yardımı bulunan dönemde prim günü sıfır olamaz" });
  if (v.nakitYemekYardimi > 0 && v.fiiliCalismaGunu === 0) ctx.addIssue({ code: "custom", path: ["fiiliCalismaGunu"], message: "Yemek yardımında fiilî çalışma günü zorunludur" });
});

export const bordroRetSemasi = z.object({
  neden: z.string().trim().min(3, "Ret nedeni en az 3 karakter olmalıdır").max(500),
});

export const bordroListeFiltreSemasi = z.object({
  yil: z.coerce.number().int().min(2020).max(2100).optional(),
  ay: z.coerce.number().int().min(1).max(12).optional(),
});

const pozitifPara = z.union([z.string(), z.number()]).transform(String)
  .refine((deger) => /^\d{1,13}(\.\d{1,2})?$/.test(deger) && Number(deger) > 0, "Pozitif ve en fazla iki ondalıklı tutar giriniz");

export const bordroKalemOlusturSemasi = z.object({
  tip: z.enum(["kazanc", "kesinti"]),
  kod: z.string().trim().min(2).max(40).regex(/^[a-z0-9_]+$/, "Kod küçük harf, rakam ve alt çizgi içerebilir"),
  aciklama: z.string().trim().min(2).max(120),
  tutar: pozitifPara,
});

export const bordroOdeSemasi = z.object({
  kasaId: bosVeyaUuid,
  bankaHesapId: bosVeyaUuid,
  odemeTarihi: z.coerce.date(),
  aciklama: bosVeyaMetin,
  tutar: pozitifPara,
}).superRefine((girdi, ctx) => {
  if ((!girdi.kasaId && !girdi.bankaHesapId) || (girdi.kasaId && girdi.bankaHesapId)) {
    ctx.addIssue({ code: "custom", message: "Tam olarak bir kasa veya banka hesabı seçilmelidir" });
  }
});

export const bordroOdemeIptalSemasi = z.object({
  neden: z.string().trim().min(3, "İptal nedeni en az 3 karakter olmalıdır").max(500),
});

export const avansOlusturSemasi = z.object({
  personelId: z.string().uuid(),
  tutar: z.coerce.number().positive("Avans tutarı sıfırdan büyük olmalıdır"),
  tarih: z.coerce.date(),
  aciklama: bosVeyaMetin,
});

export const avansOdeSemasi = z.object({
  tarih: z.coerce.date(),
  kasaId: bosVeyaUuid,
  bankaHesapId: bosVeyaUuid,
}).superRefine((girdi, ctx) => {
  if ((!girdi.kasaId && !girdi.bankaHesapId) || (girdi.kasaId && girdi.bankaHesapId)) {
    ctx.addIssue({ code: "custom", message: "Tam olarak bir kasa veya banka hesabı seçilmelidir" });
  }
});

export const avansKararSemasi = z.object({
  neden: z.string().trim().min(3).max(500).optional(),
});

export const avansRetSemasi = z.object({
  neden: z.string().trim().min(3, "Ret nedeni en az 3 karakter olmalıdır").max(500),
});

export const avansMahsupSemasi = z.object({
  avansId: z.string().uuid(),
  tutar: pozitifPara,
});
