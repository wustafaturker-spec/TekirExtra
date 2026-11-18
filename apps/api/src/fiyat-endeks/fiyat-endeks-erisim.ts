import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { ENDEKS_YETKI_ROLLERI, type Rol } from "@tekirextra/shared";
import { planOzelligiAcik } from "../core/abonelik-erisim.service";
import { baglamAl } from "../core/istek-baglami";

/**
 * END-23 (kullanıcı kararı 2026-11-14): erişimi firma yöneticisi belirler.
 * Özel rolde satış ve alış/maliyet iki bağımsız izin kutusudur. Özel rolü
 * olmayan kullanıcıda hazır rol listeleri uygulanır. Plan ve Raporlar
 * kutusu üst sınırdır (`fiyat-endeks` yolu raporlar modülündedir).
 */
export const FIYAT_ENDEKS_MODULU = "fiyat_endeks";
/** Yöneticinin açabileceği roller; bayi, çalışan gibi dış/self-servis roller seçilemez. */
export const FIYAT_ENDEKS_ROLLERI = ENDEKS_YETKI_ROLLERI satisfies readonly Rol[];
const rolListesi = z.array(z.enum(FIYAT_ENDEKS_ROLLERI)).max(FIYAT_ENDEKS_ROLLERI.length)
  .refine((r) => new Set(r).size === r.length, "Rol tekrar edemez");
export const fiyatEndeksAyariSemasi = z.object({
  satisRolleri: rolListesi, alisRolleri: rolListesi,
  /** END-13: maliyet artışı satış fiyatı artışını bu kadar puan aşınca ürün marj makası listesinde işaretlenir. */
  makasEsigi: z.number().min(1).max(100).optional(),
  /** END-20: açık teklifte teklif tarihinden bu yana kur bu yüzdeyi aşınca uyarı. */
  teklifKurEsigi: z.number().min(0.1).max(100).optional(),
  /** END-20: açık teklifte teklif ayından bu yana TÜFE bu yüzdeyi aşınca uyarı. */
  teklifEndeksEsigi: z.number().min(0.1).max(100).optional(),
}).strict();
export type FiyatEndeksAyari = z.infer<typeof fiyatEndeksAyariSemasi>;
/** Varsayılan: muhasebe iki tarafa da erişir, diğer roller kapalı (yönetici değiştirene kadar). */
export const FIYAT_ENDEKS_VARSAYILAN: FiyatEndeksAyari = { satisRolleri: ["muhasebe"], alisRolleri: ["muhasebe"], makasEsigi: 10, teklifKurEsigi: 3, teklifEndeksEsigi: 2 };

/** END-20: kiracının teklif uyarısı eşikleri (yüzde). */
export async function teklifEsikleri(tx: Prisma.TransactionClient, tenantId: string): Promise<{ kur: number; endeks: number }> {
  const kayit = await tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: FIYAT_ENDEKS_MODULU } }, select: { ayarlar: true } });
  const ayar = fiyatEndeksAyariSemasi.safeParse(kayit?.ayarlar ?? FIYAT_ENDEKS_VARSAYILAN);
  return { kur: (ayar.success ? ayar.data.teklifKurEsigi : undefined) ?? 3, endeks: (ayar.success ? ayar.data.teklifEndeksEsigi : undefined) ?? 2 };
}
export const VARSAYILAN_MAKAS_ESIGI = 10;

/** END-13: kiracının marj makası eşiği (puan). */
export async function makasEsigi(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
  const kayit = await tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: FIYAT_ENDEKS_MODULU } }, select: { ayarlar: true } });
  const ayar = fiyatEndeksAyariSemasi.safeParse(kayit?.ayarlar ?? FIYAT_ENDEKS_VARSAYILAN);
  return ayar.success ? ayar.data.makasEsigi ?? VARSAYILAN_MAKAS_ESIGI : VARSAYILAN_MAKAS_ESIGI;
}

export type FiyatTarafi = "satis" | "alis";
export interface FiyatEndeksErisimi { satis: boolean; alis: boolean }

export function rolErisimi(ayar: FiyatEndeksAyari, rol: Rol, kapali: readonly string[] = [], ozelRol = false): FiyatEndeksErisimi {
  if (rol === "yonetici" && !kapali.length) return { satis: true, alis: true };
  const ozelRolAcik = ozelRol && (FIYAT_ENDEKS_ROLLERI as readonly string[]).includes(rol);
  return {
    satis: (rol === "yonetici" || ozelRolAcik || (!ozelRol && (ayar.satisRolleri as readonly string[]).includes(rol))) && !kapali.includes("raporlar.goruntule") && !kapali.includes("fiyat_endeks_satis.goruntule"),
    alis: (rol === "yonetici" || ozelRolAcik || (!ozelRol && (ayar.alisRolleri as readonly string[]).includes(rol))) && !kapali.includes("raporlar.goruntule") && !kapali.includes("fiyat_endeks_alis.goruntule"),
  };
}

/** Plan özelliği kapalıysa ya da kullanıcının hiçbir tarafa erişimi yoksa reddeder. */
export async function fiyatEndeksErisimi(tx: Prisma.TransactionClient, tenantId: string, rol: Rol): Promise<FiyatEndeksErisimi> {
  if (!(await planOzelligiAcik(tx, tenantId, "fiyatEndeksAnalizi"))) {
    throw new ForbiddenException("Fiyat ve endeks analizi abonelik planınızda açık değil.");
  }
  const kayit = await tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: FIYAT_ENDEKS_MODULU } }, select: { ayarlar: true } });
  const ayar = fiyatEndeksAyariSemasi.safeParse(kayit?.ayarlar ?? FIYAT_ENDEKS_VARSAYILAN);
  const erisim = rolErisimi(ayar.success ? ayar.data : FIYAT_ENDEKS_VARSAYILAN, rol, baglamAl()?.ozelRol?.kapali, Boolean(baglamAl()?.ozelRol));
  if (!erisim.satis && !erisim.alis) throw new ForbiddenException("Fiyat ve endeks analizine erişiminiz yok; yönetici Ayarlar › Modül Ayarları'ndan açabilir.");
  return erisim;
}

export function tarafDenetle(erisim: FiyatEndeksErisimi, taraf: FiyatTarafi): void {
  if (!erisim[taraf]) throw new ForbiddenException(taraf === "alis" ? "Alış fiyatı ve maliyet tarafına erişiminiz yok." : "Satış fiyatı tarafına erişiminiz yok.");
}
