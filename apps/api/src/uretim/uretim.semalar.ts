import { z } from "zod";

const pozitif = z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,13}(\.\d{1,6})?$/.test(v) && Number(v) > 0, "Pozitif miktar gerekli");

export const receteKaydetSemasi = z.object({
  ciktiMiktari: pozitif.default("1"),
  aciklama: z.string().max(500).optional().nullable(),
  kalemler: z.array(z.object({
    malzemeStokId: z.string().uuid(),
    malzemeVaryantId: z.string().uuid().optional().nullable(),
    miktar: pozitif,
    fireOrani: z.union([z.string(), z.number()]).transform(String).refine((v) => Number(v) >= 0 && Number(v) <= 100, "Fire oranı 0-100 arasında olmalı").default("0"),
  })).min(1, "En az bir reçete kalemi gerekli"),
});

export const uretimEmriOlusturSemasi = z.object({
  stokId: z.string().uuid(),
  hedefDepoId: z.string().uuid(),
  planlananMiktar: pozitif,
  tarih: z.string().date(),
  aciklama: z.string().max(500).optional().nullable(),
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
