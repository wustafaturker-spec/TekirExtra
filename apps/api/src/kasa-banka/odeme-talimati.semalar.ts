import { z } from "zod";

const tutar = z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,13}(\.\d{1,2})?$/.test(v) && Number(v) > 0, "Pozitif tutar girin");
const faturaBaglari = z.array(z.object({ faturaId: z.uuid(), tutar })).max(100).default([]);

/** ENT-07: tek talimat; IBAN cari banka hesabından ya da elle. */
export const odemeTalimatiOlusturSemasi = z.object({
  bankaHesapId: z.uuid(),
  cariId: z.uuid().optional().nullable(),
  cariBankaHesapId: z.uuid().optional().nullable(),
  aliciUnvan: z.string().trim().min(2).max(200).optional().nullable(),
  aliciIban: z.string().optional().nullable(),
  /** Boşsa fatura tutarlarının toplamı. */
  tutar: tutar.optional().nullable(),
  odemeTarihi: z.string().date("Ödeme tarihi YYYY-MM-DD biçiminde olmalıdır").optional().nullable(),
  aciklama: z.string().trim().max(140).optional().nullable(),
  faturalar: faturaBaglari,
}).refine((g) => g.cariBankaHesapId || g.aliciIban, { message: "Alıcı IBAN'ı seçin ya da girin", path: ["aliciIban"] })
  .refine((g) => g.tutar || g.faturalar.length, { message: "Tutar girin ya da fatura seçin", path: ["tutar"] });

/** ENT-07: vadesi gelen borçlardan cari başına talimat. */
export const odemeTalimatiTopluSemasi = z.object({
  bankaHesapId: z.uuid(),
  odemeTarihi: z.string().date(),
  aciklama: z.string().trim().max(140).optional().nullable(),
  kalemler: z.array(z.object({
    cariId: z.uuid(),
    cariBankaHesapId: z.uuid({ message: "Her cari için IBAN seçin" }),
    faturalar: faturaBaglari.refine((f) => f.length > 0, "Her cari için en az bir fatura seçin"),
  })).min(1, "En az bir cari seçin").max(200),
});
