import { z } from "zod";

const bosVeyaUuid = z.union([z.string().uuid(), z.literal(""), z.null()]).optional();
const bosVeyaMetin = z.union([z.string().trim().max(500), z.literal(""), z.null()]).optional();

export const firsatOlusturSemasi = z.object({
  baslik: z.string().trim().min(2, "Fırsat başlığı en az 2 karakter olmalıdır").max(100),
  cariId: z.string().uuid("Lütfen geçerli bir cari hesap seçiniz"),
  tahminiTutar: z.coerce.number().positive("Tahmini tutar sıfırdan büyük olmalıdır"),
  asama: z.enum([
    "yeni_lead",
    "iletisim_kuruldu",
    "teklif_verildi",
    "pazarlik",
    "kazanildi",
    "kaybedildi"
  ]).default("yeni_lead"),
  kapanisTarihi: z.coerce.date().nullable().optional(),
  sorumluUserId: bosVeyaUuid,
  notlar: bosVeyaMetin,
});

export const firsatGuncelleSemasi = firsatOlusturSemasi.partial();

export const firsatAsamaDegistirSemasi = z.object({
  asama: z.enum([
    "yeni_lead",
    "iletisim_kuruldu",
    "teklif_verildi",
    "pazarlik",
    "kazanildi",
    "kaybedildi"
  ]),
});

export const firsatAsamaFiltreSemasi = z.enum([
  "yeni_lead",
  "iletisim_kuruldu",
  "teklif_verildi",
  "pazarlik",
  "kazanildi",
  "kaybedildi",
]);
