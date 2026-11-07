import { z } from "zod";
import { DOVIZ_CINSLERI } from "@tekirextra/shared";

const satir = z.object({
  hariciSatirId: z.string().min(1), sku: z.string().min(1), barkod: z.string().optional(),
  // PZR-01: birim fiyat KDV dahil, indirimler düşülmüş (müşterinin ödediği). PZR-03: oran yoksa boş (stok kartından).
  urunAdi: z.string().min(1), miktar: z.number().positive(), birimFiyat: z.number().nonnegative(),
  kdvOrani: z.number().min(0).max(100).nullable().optional(),
});

export const pazaryeriSiparisSemasi = z.object({
  baglantiId: z.string().uuid(), hariciId: z.string().min(1), siparisNo: z.string().min(1),
  hariciDurum: z.string().optional(), siparisTarihi: z.string().datetime({ offset: true }),
  musteriUnvani: z.string().min(1), musteriEposta: z.string().email().optional(),
  musteriTelefon: z.string().optional(), vknTckn: z.string().optional(),
  dovizCinsi: z.enum(DOVIZ_CINSLERI).default("TRY"), toplam: z.number().nonnegative(),
  teslimatAdresi: z.record(z.string(), z.unknown()).optional(), satirlar: z.array(satir).min(1),
});

/** PZR-07: bağlantının fatura kesen VKN'si (null: kaldır). */
export const pazaryeriFaturaVknSemasi = z.object({ vkn: z.string().regex(/^\d{10,11}$/, "VKN 10, TCKN 11 haneli olmalıdır").nullable() });
/** PZR-07: kesintileri pazaryerinin komisyon e-Faturasına bağla. */
export const pazaryeriKesintiEslestirSemasi = z.object({ gelenEbelgeId: z.string().uuid(), kesintiIds: z.array(z.string().uuid()).min(1).max(2000) });

/** PZR-10: faturasız kesintileri masraf kaydına dönüştür. */
export const pazaryeriKesintiMasrafSemasi = z.object({
  kesintiIds: z.array(z.string().uuid()).min(1).max(100), kategoriId: z.string().uuid(), cariId: z.string().uuid(),
  kur: z.number().positive().optional(),
});

/** PZR-08: kesinti türünün sınıfı (kullanıcı seçer, kalıcı kural). */
export const pazaryeriKesintiSinifSemasi = z.object({
  baglantiId: z.string().uuid(), tur: z.string().min(1).max(80),
  sinif: z.enum(["faturali", "stopaj", "ceza", "diger_faturasiz"]),
});

export const pazaryeriFaturalastirSemasi = z.object({
  siparisler: z.array(z.object({ siparisId: z.string().uuid(), cariId: z.string().uuid() })).min(1).max(100),
});

export const pazaryeriSatirEsleSemasi = z.object({
  stokId: z.string().uuid(),
  varyantId: z.string().uuid().nullable().optional(),
});

export const pazaryeriKesintiSemasi = z.object({
  baglantiId: z.string().uuid(),
  hariciId: z.string().min(1),
  siparisNo: z.string().min(1).optional(),
  tur: z.string().min(1).max(80),
  aciklama: z.string().max(500).optional(),
  tarih: z.string().date(),
  tutar: z.number().positive(),
  dovizCinsi: z.enum(DOVIZ_CINSLERI).default("TRY"),
  hamVeri: z.record(z.string(), z.unknown()).optional(),
});

export const pazaryeriKesintiGiderlestirSemasi = z.object({
  kesintiIds: z.array(z.string().uuid()).min(1).max(100),
  kasaId: z.string().uuid().optional(),
  bankaHesapId: z.string().uuid().optional(),
  kur: z.number().positive().optional(),
}).refine((g) => Boolean(g.kasaId) !== Boolean(g.bankaHesapId), "Kasa veya banka hesabından yalnızca biri seçilmelidir");
