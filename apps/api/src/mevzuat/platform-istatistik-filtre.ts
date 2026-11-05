import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { bugunTR, takvimGunuMu } from "@tekirextra/shared";

const gun = z.string().refine(takvimGunuMu, "Geçerli bir tarih girin (YYYY-MM-DD).");
export const istatistikFiltreSemasi = z.object({
  baslangic: gun, bitis: gun, plan: z.string().trim().max(40).default(""), firma: z.uuid().optional(),
  olcut: z.enum(["etkin", "giris", "islem"]).default("etkin"),
  sayfa: z.coerce.number().int().min(1).max(100000).default(1),
  baslamaDurum: z.enum(["baslamayan", "baslayan", "belirsiz"]).default("baslamayan"),
  baslamaSayfa: z.coerce.number().int().min(1).max(100000).default(1),
  operasyon: z.enum(["hepsi", "gorev", "fatura", "iade"]).default("hepsi"),
  operasyonSayfa: z.coerce.number().int().min(1).max(100000).default(1),
  operasyonGun: gun.optional(),
  operasyonGecmisSayfa: z.coerce.number().int().min(1).max(100000).default(1),
}).strict();
export type IstatistikFiltresi = z.infer<typeof istatistikFiltreSemasi>;
export const gunEkle = (gun: string, fark: number) => new Date(Date.parse(`${gun}T00:00:00Z`) + fark * 86400000).toISOString().slice(0, 10);
export function aralikDogrula(baslangic: string, bitis: string, ustSinir = 93) {
  const adet = Math.round((Date.parse(`${bitis}T00:00:00Z`) - Date.parse(`${baslangic}T00:00:00Z`)) / 86400000) + 1;
  if (!takvimGunuMu(baslangic) || !takvimGunuMu(bitis) || adet < 1 || adet > ustSinir || bitis > bugunTR()) {
    throw new BadRequestException(`Tarih aralığı en çok ${ustSinir} gün olabilir ve gelecekte bitemez.`);
  }
  const oncekiBaslangic = gunEkle(baslangic, -adet);
  if (!takvimGunuMu(oncekiBaslangic)) throw new BadRequestException("Önceki dönemi hesaplanabilen bir tarih aralığı seçin.");
  return { adet, oncekiBaslangic, oncekiBitis: gunEkle(baslangic, -1) };
}
