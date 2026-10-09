import { z } from "zod";
const para = z.coerce.number().positive().max(100_000_000);
const oran = z.coerce.number().min(0).max(100);

export const bordroHesaplamaSemasi = z.object({
  yil: z.coerce.number().int().min(2020).max(2100), ay: z.coerce.number().int().min(1).max(12),
  brutUcret: para, ucretDisiOdeme: z.coerce.number().min(0).default(0), sgkMatrahDevirleri: z.array(z.object({ tutar: z.coerce.number().positive(), kalanAy: z.union([z.literal(1), z.literal(2)]) })).max(2).default([]), primGunu: z.coerce.number().int().min(1).max(30).default(30), primeEsasKazanc: para.optional(), sgkTesvikOrani: oran.default(0), nakitYemekYardimi: z.coerce.number().min(0).default(0), fiiliCalismaGunu: z.coerce.number().int().min(0).max(31).default(0), engellilikDerecesi: z.coerce.number().int().min(1).max(3).optional(),
  sahisSigortaPrimi: z.coerce.number().min(0).default(0), hayatSigortaPrimi: z.coerce.number().min(0).default(0), sendikaAidati: z.coerce.number().min(0).default(0), oncekiKumulatifSigortaIndirimi: z.coerce.number().min(0).default(0),
  oncekiKumulatifMatrah: z.coerce.number().min(0).default(0), oncekiAsgariKumulatifMatrah: z.coerce.number().min(0).default(0),
});
