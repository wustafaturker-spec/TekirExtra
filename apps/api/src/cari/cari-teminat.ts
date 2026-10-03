import { Prisma } from "@prisma/client";
import { z } from "zod";
import { DOVIZ_CINSLERI } from "@tekirextra/shared";
import { guncelKurlar, guncelTlDegeri, type GuncelKurlar } from "./doviz-degerleme";

/**
 * CARI-39 (P2-6, karar 2026-10-04): müşteriden alınan teminatlar.
 *
 * - Türler: teminat mektubu, ipotek, DBS limiti, nakit, kefalet, diğer.
 * - Geçerli teminat = aktif (iade edilmemiş), başlangıcı gelmiş ve süresi
 *   dolmamış (bitişi boş ya da bugün/sonra). Geçerli teminatlar güncel döviz
 *   satış kuruyla TL'ye çevrilip **risk limitine eklenir**: kullanılabilir
 *   limit = risk limiti + teminat. Limit tanımlı değilse denetim yoktur.
 * - Bitişe 30 gün kala Bildirim Merkezi'ne uyarı, süresi geçip iade
 *   edilmemişse kritik bildirim düşer; süresi geçen teminat riske sayılmaz.
 * - Muhasebe (nazım hesap) fişi üretilmez; yalnız ticari takip.
 */
export const TEMINAT_TURLERI = ["teminat_mektubu", "ipotek", "dbs", "nakit", "kefalet", "diger"] as const;
export type TeminatTuru = (typeof TEMINAT_TURLERI)[number];
export const TEMINAT_TURU_ADLARI: Record<TeminatTuru, string> = {
  teminat_mektubu: "Teminat mektubu",
  ipotek: "İpotek",
  dbs: "DBS limiti",
  nakit: "Nakit teminat",
  kefalet: "Kefalet",
  diger: "Diğer",
};
export const TEMINAT_UYARI_GUNU = 30;

const tarih = z.string().date("Geçersiz tarih (YYYY-MM-DD)");
export const teminatSemasi = z
  .object({
    tur: z.enum(TEMINAT_TURLERI),
    tutar: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, "Tutar pozitif sayı olmalıdır").refine((t) => Number(t) > 0, "Tutar sıfırdan büyük olmalıdır"),
    dovizCinsi: z.enum(DOVIZ_CINSLERI).default("TRY"),
    banka: z.string().trim().max(200).optional().nullable(),
    belgeNo: z.string().trim().max(200).optional().nullable(),
    baslangicTarihi: tarih.optional().nullable(),
    bitisTarihi: tarih.optional().nullable(),
    aciklama: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((t) => !t.baslangicTarihi || !t.bitisTarihi || t.bitisTarihi >= t.baslangicTarihi, { message: "Bitiş tarihi başlangıçtan önce olamaz", path: ["bitisTarihi"] });
export type TeminatGirdisi = z.infer<typeof teminatSemasi>;

const gunBasi = (t: Date) => new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));

export type TeminatDurumu = "gecerli" | "baslamadi" | "suresi_doldu" | "iade_edildi";

/** Teminatın bugünkü durumu; yalnız `gecerli` olan riske eklenir. */
export function teminatDurumu(t: { durum: string; baslangicTarihi: Date | null; bitisTarihi: Date | null }, bugun = new Date()): TeminatDurumu {
  if (t.durum === "iade_edildi") return "iade_edildi";
  const gun = gunBasi(bugun).getTime();
  if (t.baslangicTarihi && t.baslangicTarihi.getTime() > gun) return "baslamadi";
  if (t.bitisTarihi && t.bitisTarihi.getTime() < gun) return "suresi_doldu";
  return "gecerli";
}

type TeminatKaydi = { cariId: string; durum: string; tutar: Prisma.Decimal; dovizCinsi: string; baslangicTarihi: Date | null; bitisTarihi: Date | null };

/** Saf: carilerin geçerli teminat toplamı (güncel kurla TL); kuru olmayan döviz `kurEksik`e. */
export function teminatToplamlari(kayitlar: TeminatKaydi[], kurlar: GuncelKurlar, bugun = new Date()) {
  const sonuc = new Map<string, { teminatTry: Prisma.Decimal; kurEksik: string[] }>();
  for (const t of kayitlar) {
    if (teminatDurumu(t, bugun) !== "gecerli") continue;
    const s = sonuc.get(t.cariId) ?? { teminatTry: new Prisma.Decimal(0), kurEksik: [] };
    const deger = guncelTlDegeri(t.dovizCinsi, t.tutar, new Prisma.Decimal(0), kurlar);
    // Kuru bulunamayan dövizli teminat limite eklenmez (tarihî karşılığı yok); işaretlenir.
    if (deger.kurEksik) { if (!s.kurEksik.includes(t.dovizCinsi)) s.kurEksik.push(t.dovizCinsi); }
    else s.teminatTry = s.teminatTry.add(deger.guncelTry);
    sonuc.set(t.cariId, s);
  }
  return sonuc;
}

export async function cariTeminatlari(tx: Prisma.TransactionClient, tenantId: string, cariIdler: string[], bugun = new Date()) {
  if (cariIdler.length === 0) return new Map<string, { teminatTry: Prisma.Decimal; kurEksik: string[] }>();
  const kayitlar = await tx.cariTeminat.findMany({
    where: { cariId: { in: cariIdler }, durum: "aktif" },
    select: { cariId: true, durum: true, tutar: true, dovizCinsi: true, baslangicTarihi: true, bitisTarihi: true },
  });
  const kurlar = await guncelKurlar(tx, tenantId, kayitlar.map((k) => k.dovizCinsi), bugun);
  return teminatToplamlari(kayitlar, kurlar, bugun);
}
