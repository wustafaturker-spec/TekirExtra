import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Rol } from "@tekirextra/shared";

/** SAT-02: talep açamayan roller. */
export const TALEP_ACAMAYAN_ROLLER: readonly string[] = ["salt_okunur", "mali_musavir", "b2b_bayi"];

/** SAT-02, SAT-05/06: tüm talepleri gören, teklif giren ve siparişe dönüştüren roller. */
export const SATIN_ALMA_YETKILI_ROLLER: readonly string[] = ["muhasebe", "yonetici"];

/** SAT-03: `satin_alma` modül ayarı yoksa kullanılan onay eşiği (TL). */
export const VARSAYILAN_ONAY_ESIGI = 25_000;

const tl = (tutar: number) => tutar.toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
const kurus = (tutar: number) => Math.round(tutar * 100) / 100;

export const talepAcabilirMi = (rol: string) => !TALEP_ACAMAYAN_ROLLER.includes(rol);
export const tumTalepleriGorurMu = (rol: string) => SATIN_ALMA_YETKILI_ROLLER.includes(rol);

/** SAT-03: eşik dahil muhasebe, eşiğin üstünde yalnız yönetici onaylar. */
export function onaylayabilecekRoller(tutar: number, esik: number): Rol[] {
  return tutar <= esik ? ["muhasebe", "yonetici"] : ["yonetici"];
}

/**
 * SAT-03: kullanıcı talebi onaylayabilir mi? Onaylayabilirse null, yoksa
 * kullanıcıya gösterilecek sebep. Görev ayrılığı yöneticiye de uygulanır.
 */
export function onayYetkisi(p: { rol: string; userId: string; talepEdenUserId: string; tutar: number; esik: number }): string | null {
  if (p.userId === p.talepEdenUserId) return "Kendi talebinizi onaylayamazsınız; talebi başka bir yetkili onaylamalıdır";
  if ((onaylayabilecekRoller(p.tutar, p.esik) as string[]).includes(p.rol)) return null;
  return p.rol === "muhasebe" ? `Onay eşiğini (${tl(p.esik)}) aşan talebi yalnız yönetici onaylayabilir` : "Satın alma talebini onaylama yetkiniz yok";
}

export interface ButceDurumu {
  /** Talebin yılı için onaylı bütçe var mı? */
  tanimli: boolean;
  butce: number;
  gerceklesen: number;
  digerTalepler: number;
  kalan: number;
  talep: number;
  /** Talebin kalanı aştığı tutar; aşmıyorsa 0. */
  asim: number;
}

/** SAT-04: kalan = bütçe − gerçekleşen − diğer onaylı talepler. Bütçe yoksa aşım aranmaz. */
export function butceDurumuHesapla(p: { butce: number | null; gerceklesen: number; digerTalepler: number; talep: number }): ButceDurumu {
  const ortak = { gerceklesen: kurus(p.gerceklesen), digerTalepler: kurus(p.digerTalepler), talep: kurus(p.talep) };
  if (p.butce === null) return { tanimli: false, butce: 0, kalan: 0, asim: 0, ...ortak };
  const kalan = kurus(p.butce - p.gerceklesen - p.digerTalepler);
  return { tanimli: true, butce: kurus(p.butce), kalan, asim: Math.max(0, kurus(p.talep - kalan)), ...ortak };
}

/** SAT-05: TL toplamı en düşük teklif(ler); eşit en düşüklerin hepsi sayılır. */
export function enDusukTeklifler(teklifler: { id: string; toplamTry: number }[]): Set<string> {
  if (teklifler.length === 0) return new Set();
  const enDusuk = Math.min(...teklifler.map((t) => t.toplamTry));
  return new Set(teklifler.filter((t) => t.toplamTry === enDusuk).map((t) => t.id));
}

/**
 * SAT-05: teklif talebin her kalemine tam bir fiyat vermelidir. Toplam KDV
 * hariç ve teklif dövizindedir; TL karşılığı teklifin kuruyla bulunur.
 */
export function teklifHesapla(
  talepKalemleri: { id: string; miktar: Prisma.Decimal }[],
  fiyatlar: { talepKalemiId: string; birimFiyat: string }[],
  kur: string,
): { toplam: Prisma.Decimal; toplamTry: Prisma.Decimal } {
  const girilen = new Map<string, string>();
  for (const f of fiyatlar) {
    if (girilen.has(f.talepKalemiId)) throw new BadRequestException("Aynı talep kalemi için birden çok fiyat girilmiş");
    if (!talepKalemleri.some((k) => k.id === f.talepKalemiId)) throw new BadRequestException("Teklifte talepte bulunmayan bir kalem var");
    girilen.set(f.talepKalemiId, f.birimFiyat);
  }
  let toplam = new Prisma.Decimal(0);
  for (const k of talepKalemleri) {
    const fiyat = girilen.get(k.id);
    if (fiyat === undefined) throw new BadRequestException("Teklif talebin tüm kalemlerine fiyat vermelidir");
    toplam = toplam.add(k.miktar.mul(fiyat));
  }
  toplam = toplam.toDecimalPlaces(2);
  return { toplam, toplamTry: toplam.mul(kur).toDecimalPlaces(2) };
}
