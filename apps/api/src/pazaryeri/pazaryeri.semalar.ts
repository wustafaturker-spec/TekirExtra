import { z } from "zod";

const satir = z.object({
  hariciSatirId: z.string().min(1), sku: z.string().min(1), barkod: z.string().optional(),
  urunAdi: z.string().min(1), miktar: z.number().positive(), birimFiyat: z.number().nonnegative(),
  kdvOrani: z.number().min(0).max(100).default(20),
});

export const pazaryeriSiparisSemasi = z.object({
  baglantiId: z.string().uuid(), hariciId: z.string().min(1), siparisNo: z.string().min(1),
  hariciDurum: z.string().optional(), siparisTarihi: z.string().datetime({ offset: true }),
  musteriUnvani: z.string().min(1), musteriEposta: z.string().email().optional(),
  musteriTelefon: z.string().optional(), vknTckn: z.string().optional(),
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"), toplam: z.number().nonnegative(),
  teslimatAdresi: z.record(z.string(), z.unknown()).optional(), satirlar: z.array(satir).min(1),
});

export const pazaryeriFaturalastirSemasi = z.object({
  siparisler: z.array(z.object({ siparisId: z.string().uuid(), cariId: z.string().uuid() })).min(1).max(100),
});
