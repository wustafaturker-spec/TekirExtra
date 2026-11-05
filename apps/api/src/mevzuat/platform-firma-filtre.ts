import { z } from "zod";
import { takvimGunuMu } from "@tekirextra/shared";

const gun = z.string().refine(takvimGunuMu, "Geçerli bir tarih girin (YYYY-MM-DD)");

export const firmaFiltreSemasi = z.object({
  arama: z.string().trim().max(200).default(""),
  goster: z.enum(["hepsi", "talep", "askiyaAlinacak", "askida", "iptal", "aktif", "deneme", "hicGirmeyen", "uzunSuredirGirmeyen", "yenilenecek", "denemesiBitecek", "baglantiHatali", "takibiGeciken", "sorumluUygunDegil"]).default("hepsi"),
  baglanti: z.enum(["hepsi", "hata", "ebelgeAktif", "ebelgeYok"]).default("hepsi"),
  plan: z.string().trim().max(40).default(""),
  siralama: z.enum(["unvan", "kayitYeni", "sonGiris", "yenileme"]).default("unvan"),
  sayfa: z.coerce.number().int().min(1).max(100000).default(1),
  sayfaBoyutu: z.coerce.number().int().min(1).max(100).default(25),
  firma: z.uuid().optional(),
  kayitBaslangic: gun.optional(),
  kayitBitis: gun.optional(),
  yenilemeBaslangic: gun.optional(),
  yenilemeBitis: gun.optional(),
}).refine((f) => !f.kayitBaslangic || !f.kayitBitis || f.kayitBaslangic <= f.kayitBitis, "Kayıt tarih aralığı ters olamaz")
  .refine((f) => !f.yenilemeBaslangic || !f.yenilemeBitis || f.yenilemeBaslangic <= f.yenilemeBitis, "Yenileme tarih aralığı ters olamaz");
export type FirmaFiltresi = z.infer<typeof firmaFiltreSemasi>;
