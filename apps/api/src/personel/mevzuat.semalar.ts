import { z } from "zod";
const para = z.coerce.number().positive().max(100_000_000);
const oran = z.coerce.number().min(0).max(100);
export const mevzuatParametreleriSemasi = z.object({
  asgariUcretBrut: para,
  sgkTavan: para,
  sgkIsciOrani: oran,
  issizlikIsciOrani: oran,
  sgkIsverenOrani: oran,
  issizlikIsverenOrani: oran,
  sgkTesvikAzamiOrani: oran.default(0),
  yemekGelirVergisiGunlukIstisna: z.coerce.number().min(0).default(0),
  yemekSgkGunlukIstisna: z.coerce.number().min(0).default(0),
  engellilikIndirimi: z.object({ derece1: z.coerce.number().min(0), derece2: z.coerce.number().min(0), derece3: z.coerce.number().min(0) }).default({ derece1: 0, derece2: 0, derece3: 0 }),
  damgaVergisiOrani: oran,
  gelirVergisiDilimleri: z.array(z.object({ ustSinir: z.coerce.number().positive().nullable(), oran: oran })).min(1).max(10),
}).superRefine((v, ctx) => {
  if (v.sgkTavan < v.asgariUcretBrut) ctx.addIssue({ code: "custom", path: ["sgkTavan"], message: "SGK tavanı asgari ücretten düşük olamaz" });
  const sinirlar = v.gelirVergisiDilimleri.map((d) => d.ustSinir); if (sinirlar.at(-1) !== null) ctx.addIssue({ code: "custom", path: ["gelirVergisiDilimleri"], message: "Son vergi dilimi üst sınırsız olmalıdır" });
  for (let i=1;i<sinirlar.length-1;i++) if (sinirlar[i]! <= sinirlar[i-1]!) ctx.addIssue({ code: "custom", path: ["gelirVergisiDilimleri",i,"ustSinir"], message: "Vergi dilimleri artan sırada olmalıdır" });
});
export const mevzuatSetiSemasi = z.object({
  ad: z.string().trim().min(3).max(100), yururlukBaslangic: z.coerce.date(), yururlukBitis: z.coerce.date().nullable().optional(),
  kaynakNotu: z.string().trim().min(10).max(1000), parametreler: mevzuatParametreleriSemasi,
}).superRefine((v,ctx)=>{if(v.yururlukBitis&&v.yururlukBitis<v.yururlukBaslangic)ctx.addIssue({code:"custom",path:["yururlukBitis"],message:"Bitiş başlangıçtan önce olamaz"});});

export const bordroHesaplamaSemasi = z.object({
  yil: z.coerce.number().int().min(2020).max(2100), ay: z.coerce.number().int().min(1).max(12),
  brutUcret: para, ucretDisiOdeme: z.coerce.number().min(0).default(0), sgkMatrahDevirleri: z.array(z.object({ tutar: z.coerce.number().positive(), kalanAy: z.union([z.literal(1), z.literal(2)]) })).max(2).default([]), primGunu: z.coerce.number().int().min(1).max(30).default(30), primeEsasKazanc: para.optional(), sgkTesvikOrani: oran.default(0), nakitYemekYardimi: z.coerce.number().min(0).default(0), fiiliCalismaGunu: z.coerce.number().int().min(0).max(31).default(0), engellilikDerecesi: z.coerce.number().int().min(1).max(3).optional(),
  sahisSigortaPrimi: z.coerce.number().min(0).default(0), hayatSigortaPrimi: z.coerce.number().min(0).default(0), sendikaAidati: z.coerce.number().min(0).default(0), oncekiKumulatifSigortaIndirimi: z.coerce.number().min(0).default(0),
  oncekiKumulatifMatrah: z.coerce.number().min(0).default(0), oncekiAsgariKumulatifMatrah: z.coerce.number().min(0).default(0),
});

export const kabulSenaryosuSemasi = z.object({
  mevzuatSetiId: z.string().uuid(), ad: z.string().trim().min(3).max(120),
  girdiler: bordroHesaplamaSemasi.omit({ yil: true, ay: true }),
  beklenen: z.object({
    netUcret: para,
    sgkIsci: z.coerce.number().min(0),
    issizlikIsci: z.coerce.number().min(0),
    gelirVergisi: z.coerce.number().min(0),
    damgaVergisi: z.coerce.number().min(0),
    primeEsasKazanc: z.coerce.number().min(0).optional(),
    sgkDevredenUygulanan: z.coerce.number().min(0).optional(),
    sgkCariAyDevreden: z.coerce.number().min(0).optional(),
    sahisSigortaPrimi: z.coerce.number().min(0).optional(),
    hayatSigortaPrimi: z.coerce.number().min(0).optional(),
    sendikaAidati: z.coerce.number().min(0).optional(),
  }),
  tolerans: z.coerce.number().min(0).max(10).default(0.01),
});
