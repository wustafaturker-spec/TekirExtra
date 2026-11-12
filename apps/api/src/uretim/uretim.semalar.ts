import { z } from "zod";

const sifirVeyaPozitif = z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,11}(\.\d{1,4})?$/.test(v), "Geçerli, negatif olmayan tutar gerekli");

const pozitif = z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,13}(\.\d{1,6})?$/.test(v) && Number(v) > 0, "Pozitif miktar gerekli");

const receteMiktari = z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,12}(\.\d{1,8})?$/.test(v) && Number(v) > 0, "Pozitif, en çok 8 ondalıklı miktar gerekli");

export const receteKaydetSemasi = z.object({
  /** Boşsa genel reçete; doluysa yalnız bu varyantın üretiminde kullanılır. */
  varyantId: z.string().uuid().optional().nullable(),
  ciktiMiktari: pozitif.default("1"),
  aciklama: z.string().max(500).optional().nullable(),
  degisiklikNedeni: z.string().min(3).max(500).optional().nullable(),
  yururlukBaslangic: z.string().date().optional().nullable(),
  kaliteKontrolGerekli: z.boolean().default(false),
  /** Yan/ortak ürünlerin üretim maliyetinden alacağı pay. */
  yanUrunMaliyetYontemi: z.enum(["sifir", "sabit_deger", "satis_degeri"]).default("sifir"),
  kalemler: z.array(z.object({
    malzemeStokId: z.string().uuid(),
    malzemeVaryantId: z.string().uuid().optional().nullable(),
    /** `birim` cinsinden; kg kimyasalın mg sarfı için 8 basamak. */
    miktar: receteMiktari,
    /** Boşsa malzemenin ana birimi; aynı ölçü ailesinden (g, mg, ml…) ya da kartın ek birimi. */
    birim: z.string().trim().min(1).max(20).optional().nullable(),
    fireOrani: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,3}(\.\d{1,6})?$/.test(v) && Number(v) <= 100, "Fire oranı 0-100 arasında, en çok 6 ondalıklı olmalı").default("0"),
  })).min(1, "En az bir reçete kalemi gerekli"),
  ciktilar: z.array(z.object({
    stokId: z.string().uuid(), varyantId: z.string().uuid().optional().nullable(), tip: z.enum(["yan_urun", "ortak_urun"]), miktar: pozitif,
    /** Sabit değer yönteminde birim maliyet (0 kabul edilir). */
    birimMaliyet: sifirVeyaPozitif.optional().nullable(),
  })).max(20).optional().default([]),
  /** Süreye bağlı olmayan ek giderler (enerji, ambalaj, genel gider payı…). */
  giderler: z.array(z.object({
    ad: z.string().trim().min(1).max(120),
    yontem: z.enum(["malzeme_yuzdesi", "birim_basi", "emir_basi"]),
    deger: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,11}(\.\d{1,4})?$/.test(v), "Ek gider değeri negatif olmayan, en çok 4 ondalıklı olmalı"),
  })).max(30).optional().default([]),
  operasyonlar: z.array(z.object({
    isMerkeziId: z.string().uuid(), operasyonKodu: z.string().trim().min(1).max(30), operasyonAdi: z.string().trim().min(1).max(120),
    hazirlikDakika: z.union([z.string(), z.number()]).transform(String).refine((v) => Number(v) >= 0, "Hazırlık süresi negatif olamaz"),
    cevrimDakika: z.union([z.string(), z.number()]).transform(String).refine((v) => Number(v) >= 0, "Çevrim süresi negatif olamaz"),
  })).max(100).optional().default([]),
}).superRefine((girdi, ctx) => {
  girdi.giderler.forEach((g, i) => {
    if (g.yontem === "malzeme_yuzdesi" && Number(g.deger) > 1000) ctx.addIssue({ code: "custom", path: ["giderler", i, "deger"], message: "Malzeme yüzdesi en çok %1000 olabilir" });
  });
  if (girdi.yanUrunMaliyetYontemi === "sabit_deger") {
    girdi.ciktilar.forEach((c, i) => {
      if (c.birimMaliyet == null) ctx.addIssue({ code: "custom", path: ["ciktilar", i, "birimMaliyet"], message: "Sabit değer yönteminde her yan/ortak ürüne birim maliyet girin" });
    });
  }
});

export const isMerkeziKaydetSemasi = z.object({
  kod: z.string().trim().min(1).max(30).transform((v) => v.toUpperCase()), ad: z.string().trim().min(2).max(120),
  gunlukKapasiteDakika: z.coerce.number().int().min(1).max(1440).default(480),
  verimlilikYuzdesi: z.coerce.number().min(1).max(200).default(100),
  /** Saatlik maliyet kırılımı; toplamı operasyon maliyetidir. */
  iscilikSaatlik: z.coerce.number().min(0).default(0),
  makineSaatlik: z.coerce.number().min(0).default(0),
  genelGiderSaatlik: z.coerce.number().min(0).default(0),
  /** Eski istemciler: yalnız toplam gönderilirse işçilik sayılır. */
  saatlikMaliyet: z.coerce.number().min(0).optional(),
  aktif: z.boolean().default(true),
}).transform(({ saatlikMaliyet, ...g }) => (g.iscilikSaatlik + g.makineSaatlik + g.genelGiderSaatlik === 0 && saatlikMaliyet ? { ...g, iscilikSaatlik: saatlikMaliyet } : g));

export const operasyonTamamlaSemasi = z.object({
  gerceklesenDakika: z.coerce.number().positive().max(100000).optional(),
});

export const vardiyaKaydetSemasi = z.object({
  kod: z.string().trim().min(1).max(20).transform((v) => v.toUpperCase()),
  ad: z.string().trim().min(2).max(100),
  baslangicSaati: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Başlangıç saati SS:DD biçiminde olmalı"),
  bitisSaati: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Bitiş saati SS:DD biçiminde olmalı"),
  aktif: z.boolean().default(true),
});

export const operasyonBaslatSemasi = z.object({
  vardiyaId: z.string().uuid(),
  operatorId: z.string().uuid(),
});

export const operasyonBekletSemasi = z.object({
  nedenKodu: z.enum(["ariza", "malzeme_bekleme", "kalite_bekleme", "ayar", "mola", "planli_bakim", "diger"]),
  aciklama: z.string().trim().min(3).max(500).optional().nullable(),
  planli: z.boolean().default(false),
});

export const kaliteKararSemasi = z.object({
  karar: z.enum(["kabul", "red", "yeniden_isleme"]),
  kontrolNotu: z.string().trim().min(3).max(1000),
  olcumler: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const yenidenIslemeTamamlaSemasi = z.object({
  aciklama: z.string().trim().min(3).max(500),
});

export const sarfDuzeltmeSemasi = z.object({
  idempotencyAnahtari: z.string().uuid(),
  uretimEmriKalemId: z.string().uuid(),
  depoId: z.string().uuid(),
  tip: z.enum(["ek_sarf", "iade"]),
  miktar: pozitif,
  neden: z.string().trim().min(3).max(500),
  lotNo: z.string().trim().min(1).max(100).optional().nullable(),
  seriNumaralari: z.array(z.string().trim().min(1).max(160)).max(1000).optional(),
});

export const uretimEmriOlusturSemasi = z.object({
  stokId: z.string().uuid(),
  /** Varyantlı mamulde zorunlu; siparişten açılan emirde sipariş satırının varyantıdır. */
  varyantId: z.string().uuid().optional().nullable(),
  satisSiparisSatirId: z.string().uuid().optional().nullable(),
  hedefDepoId: z.string().uuid(),
  planlananMiktar: pozitif,
  tarih: z.string().date(),
  /** Boşsa operasyon planının bittiği gün (operasyon yoksa emir tarihi). */
  planlananBitis: z.string().date().optional().nullable(),
  aciklama: z.string().max(500).optional().nullable(),
}).refine((g) => !g.planlananBitis || g.planlananBitis >= g.tarih, { path: ["planlananBitis"], message: "Planlanan bitiş emir tarihinden önce olamaz" });

export const uretimDonemKilidiSemasi = z.object({
  yil: z.coerce.number().int().min(2020).max(2100),
  ay: z.coerce.number().int().min(1).max(12),
  aciklama: z.string().trim().min(3).max(500).optional().nullable(),
});

/** Kapalı üretim dönemini yeniden açma: neden denetim kaydına yazılır. */
export const donemKilidiAcSemasi = z.object({
  neden: z.string().trim().min(5, "Dönemi açma nedeni en az 5 karakter olmalıdır").max(500),
});

export const uretimEmriListeSemasi = z.object({
  durum: z.enum(["taslak", "planlandi", "malzeme_bekliyor", "hazir", "uretimde", "kismen_tamamlandi", "kalite_bekliyor", "beklemede", "durduruldu", "tamamlandi", "iptal_talebi", "iptal"]).optional(),
  arama: z.string().trim().max(100).optional(),
  geciken: z.enum(["true", "false"]).optional(),
  /** V-2: imleçli sayfa. */
  imlec: z.string().uuid().optional(),
  adet: z.string().regex(/^\d{1,3}$/).optional(),
});

export const uretimTamamlaSemasi = z.object({
  lotNo: z.string().min(1).max(100).optional().nullable(),
  seriNo: z.string().min(1).max(160).optional().nullable(),
  seriNumaralari: z.array(z.string().trim().min(1).max(160)).max(1000).optional(),
  sonKullanmaTarihi: z.string().date().optional().nullable(),
  uretimTarihi: z.string().date().optional().nullable(),
}).superRefine((girdi, ctx) => {
  const seriler = [...(girdi.seriNumaralari ?? []), ...(girdi.seriNo ? [girdi.seriNo] : [])];
  if (new Set(seriler).size !== seriler.length) {
    ctx.addIssue({ code: "custom", path: ["seriNumaralari"], message: "Seri numaraları benzersiz olmalıdır" });
  }
});

/** Başlamış emri kalan miktarı üretmeden kapatır; neden denetim için zorunlu. */
export const uretimEmriKapatSemasi = z.object({
  neden: z.string().trim().min(3, "Kapatma nedeni en az 3 karakter olmalıdır").max(250),
});

export const uretimBildirimiSemasi =uretimTamamlaSemasi.and(z.object({
  idempotencyAnahtari: z.string().uuid(),
  uretilenMiktar: pozitif,
  hurdaMiktari: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,13}(\.\d{1,6})?$/.test(v), "Geçerli hurda miktarı gerekli").default("0"),
  hurdaNedeni: z.string().trim().min(3).max(250).optional().nullable(),
  yenidenIslemeMiktari: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,13}(\.\d{1,6})?$/.test(v), "Geçerli yeniden işleme miktarı gerekli").default("0"),
  yenidenIslemeNedeni: z.string().trim().min(3).max(250).optional().nullable(),
  bildirimTarihi: z.string().datetime().optional(),
  aciklama: z.string().max(500).optional().nullable(),
  sarflar: z.array(z.object({ uretimEmriKalemId: z.string().uuid(), miktar: pozitif })).optional(),
})).superRefine((girdi, ctx) => {
  if (Number(girdi.hurdaMiktari) > 0 && !girdi.hurdaNedeni) ctx.addIssue({ code: "custom", path: ["hurdaNedeni"], message: "Hurda miktarı için neden gerekli" });
  if (Number(girdi.yenidenIslemeMiktari) > 0 && !girdi.yenidenIslemeNedeni) ctx.addIssue({ code: "custom", path: ["yenidenIslemeNedeni"], message: "Yeniden işleme miktarı için neden gerekli" });
});

/** Reçete uçlarında kapsam: `?varyantId=` boşsa genel reçete. */
export const receteKapsamSemasi = z.object({ varyantId: z.string().uuid().optional() });
