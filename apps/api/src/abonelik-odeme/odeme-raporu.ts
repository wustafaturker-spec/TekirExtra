import { Prisma } from "@prisma/client";
import { takvimGunuMu } from "@tekirextra/shared";
import { ABONELIK_KDV_ORANI } from "./abonelik-tutari";

/**
 * PLT-32…34: platform ödeme raporunun saf hesapları. Veri `platform_odeme_raporu`
 * işlevinden gelir; süzme, özet, önceki dönem ve aylık toplam burada yapılır.
 */

/** Ödemenin geldiği yol: elle kayıt ya da sağlayıcı ödemesinin kanalı. */
export const ODEME_KANALLARI = ["elle", "panel", "eposta", "otomatik", "saglayici"] as const;
export type OdemeKanali = (typeof ODEME_KANALLARI)[number];
export const FATURA_DURUMLARI = ["yok", "bekliyor", "taslak", "kesinlesti", "tahsil_edildi", "hata"] as const;
export type RaporFaturaDurumu = (typeof FATURA_DURUMLARI)[number];

/** Türkiye saati sabit UTC+3 (2016'dan beri yaz saati yok). */
const TR_OFSET_MS = 3 * 60 * 60 * 1000;
const GUN_MS = 24 * 60 * 60 * 1000;
/** PLT-37: tek sorguda en çok 24 ay (+1 gün tolerans; SQL işleviyle aynı sınır). */
export const AZAMI_ARALIK_AY = 24;

export interface HamOdemeSatiri {
  odeme_id: string;
  tenant_id: string;
  unvan: string;
  vkn: string | null;
  odeme_at: Date;
  ay_sayisi: number;
  tutar: Prisma.Decimal | string | number;
  matrah: Prisma.Decimal | string | number | null;
  kdv: Prisma.Decimal | string | number | null;
  kaynak: string;
  saglayici: string | null;
  kanal: string | null;
  onceki_donem_sonu: Date | null;
  yeni_donem_sonu: Date;
  odeme_notu: string | null;
  kaydeden: string | null;
  fatura_no: string | null;
  fatura_durumu: string | null;
}

export interface OdemeSatiri {
  odemeId: string;
  tenantId: string;
  unvan: string;
  vkn: string | null;
  zaman: Date;
  aySayisi: number;
  toplam: string;
  matrah: string;
  kdv: string;
  /** Elle kayıtta matrah/KDV toplamdan %20 ile ayrıştırıldı. */
  kdvHesaplandi: boolean;
  kaynak: "elle" | "saglayici";
  saglayici: string | null;
  kanal: OdemeKanali;
  oncekiDonemSonu: Date | null;
  yeniDonemSonu: Date;
  not: string | null;
  kaydeden: string | null;
  fatura: { no: string | null; durum: string } | null;
}

export interface RaporSuzgeci {
  arama?: string;
  kanal?: OdemeKanali;
  saglayici?: string;
  faturaDurumu?: RaporFaturaDurumu;
}

const d = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);
const yaz = (v: Prisma.Decimal) => v.toFixed(2);

/** Toplamı (KDV dahil) %20 KDV ile ayrıştırır; matrah yuvarlanır, KDV kalandır (toplam korunur). */
export function kdvAyristir(toplam: Prisma.Decimal | string | number): { matrah: Prisma.Decimal; kdv: Prisma.Decimal } {
  const t = d(toplam);
  const matrah = t.mul(100).div(100 + ABONELIK_KDV_ORANI).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { matrah, kdv: t.sub(matrah) };
}

export function satirCevir(h: HamOdemeSatiri): OdemeSatiri {
  const toplam = d(h.tutar);
  const elle = h.kaynak !== "saglayici";
  const hesapla = h.matrah === null || h.kdv === null;
  const { matrah, kdv } = hesapla ? kdvAyristir(toplam) : { matrah: d(h.matrah!), kdv: d(h.kdv!) };
  const kanal: OdemeKanali = elle
    ? "elle"
    : h.kanal === "panel" || h.kanal === "eposta" || h.kanal === "otomatik"
      ? h.kanal
      : "saglayici";
  return {
    odemeId: h.odeme_id,
    tenantId: h.tenant_id,
    unvan: h.unvan.trim(),
    vkn: h.vkn,
    zaman: h.odeme_at,
    aySayisi: h.ay_sayisi,
    toplam: yaz(toplam),
    matrah: yaz(matrah),
    kdv: yaz(kdv),
    kdvHesaplandi: hesapla,
    kaynak: elle ? "elle" : "saglayici",
    saglayici: h.saglayici,
    kanal,
    oncekiDonemSonu: h.onceki_donem_sonu,
    yeniDonemSonu: h.yeni_donem_sonu,
    not: h.odeme_notu,
    kaydeden: h.kaydeden,
    fatura: h.fatura_durumu ? { no: h.fatura_no, durum: h.fatura_durumu } : null,
  };
}

const normalize = (m: string) => m.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export function suz(satirlar: OdemeSatiri[], s: RaporSuzgeci): OdemeSatiri[] {
  const arama = s.arama ? normalize(s.arama) : "";
  return satirlar.filter(
    (x) =>
      (!arama || normalize(`${x.unvan} ${x.vkn ?? ""}`).includes(arama)) &&
      (!s.kanal || x.kanal === s.kanal) &&
      (!s.saglayici || x.saglayici === s.saglayici) &&
      (!s.faturaDurumu || (s.faturaDurumu === "yok" ? x.fatura === null : x.fatura?.durum === s.faturaDurumu)),
  );
}

export interface RaporOzeti {
  adet: number;
  toplam: string;
  matrah: string;
  kdv: string;
  /** Toplamlarda elle kayıttan ayrıştırılmış KDV var. */
  hesaplananVar: boolean;
  kanallar: { kanal: OdemeKanali; adet: number; toplam: string }[];
}

export function ozetle(satirlar: OdemeSatiri[]): RaporOzeti {
  let toplam = d(0), matrah = d(0), kdv = d(0);
  const kanallar = new Map<OdemeKanali, { adet: number; toplam: Prisma.Decimal }>();
  for (const x of satirlar) {
    toplam = toplam.add(x.toplam);
    matrah = matrah.add(x.matrah);
    kdv = kdv.add(x.kdv);
    const k = kanallar.get(x.kanal) ?? { adet: 0, toplam: d(0) };
    kanallar.set(x.kanal, { adet: k.adet + 1, toplam: k.toplam.add(x.toplam) });
  }
  return {
    adet: satirlar.length,
    toplam: yaz(toplam),
    matrah: yaz(matrah),
    kdv: yaz(kdv),
    hesaplananVar: satirlar.some((x) => x.kdvHesaplandi),
    kanallar: ODEME_KANALLARI.filter((k) => kanallar.has(k)).map((k) => ({ kanal: k, adet: kanallar.get(k)!.adet, toplam: yaz(kanallar.get(k)!.toplam) })),
  };
}

/** "YYYY-MM-DD" (TR) gününün başlangıç anı (UTC Date). */
export const gunBasi = (gun: string) => new Date(Date.parse(`${gun}T00:00:00Z`) - TR_OFSET_MS);

/** TR saatine göre Date → "YYYY-MM-DD". */
export const trGunu = (an: Date) => new Date(an.getTime() + TR_OFSET_MS).toISOString().slice(0, 10);

/** TR gününe ay ekler (ay sonu taşmasını güne kırpar). */
function ayEkle(gun: string, ay: number): string {
  const [y, m, g] = gun.split("-").map(Number);
  const hedef = new Date(Date.UTC(y, m - 1 + ay, 1));
  const sonGun = new Date(Date.UTC(hedef.getUTCFullYear(), hedef.getUTCMonth() + 1, 0)).getUTCDate();
  hedef.setUTCDate(Math.min(g, sonGun));
  return hedef.toISOString().slice(0, 10);
}

export type AralikHatasi = "gecersiz_tarih" | "ters_aralik" | "aralik_cok_uzun";

/**
 * Kapsayıcı TR günleri [baslangic, bitis] → yarı açık an aralığı [bas, bit).
 * Hata kodu döner (denetleyici 400'e çevirir).
 */
export function aralikCoz(baslangic: string, bitis: string): { bas: Date; bit: Date } | { hata: AralikHatasi } {
  if (!takvimGunuMu(baslangic) || !takvimGunuMu(bitis)) return { hata: "gecersiz_tarih" };
  if (bitis < baslangic) return { hata: "ters_aralik" };
  if (bitis >= ayEkle(baslangic, AZAMI_ARALIK_AY)) return { hata: "aralik_cok_uzun" };
  return { bas: gunBasi(baslangic), bit: new Date(gunBasi(bitis).getTime() + GUN_MS) };
}

/** Bir önceki eşit uzunluktaki dönem (gün sayısı aynı). */
export function oncekiAralik(bas: Date, bit: Date): { bas: Date; bit: Date } {
  const uzunluk = bit.getTime() - bas.getTime();
  return { bas: new Date(bas.getTime() - uzunluk), bit: bas };
}

/** Son 12 ayın (bu ay dahil, TR) başlangıç günü ve ay anahtarları. */
export function son12Ay(bugun: Date = new Date()): { baslangic: string; aylar: string[] } {
  const ayBasi = `${trGunu(bugun).slice(0, 7)}-01`;
  const baslangic = ayEkle(ayBasi, -11);
  return { baslangic, aylar: Array.from({ length: 12 }, (_, i) => ayEkle(baslangic, i).slice(0, 7)) };
}

export function aylikTopla(satirlar: OdemeSatiri[], aylar: string[]): { ay: string; adet: number; toplam: string; matrah: string }[] {
  const harita = new Map(aylar.map((a) => [a, { adet: 0, toplam: d(0), matrah: d(0) }]));
  for (const x of satirlar) {
    const k = harita.get(trGunu(x.zaman).slice(0, 7));
    if (!k) continue;
    k.adet += 1;
    k.toplam = k.toplam.add(x.toplam);
    k.matrah = k.matrah.add(x.matrah);
  }
  return aylar.map((ay) => {
    const k = harita.get(ay)!;
    return { ay, adet: k.adet, toplam: yaz(k.toplam), matrah: yaz(k.matrah) };
  });
}

export const KANAL_ADI: Record<OdemeKanali, string> = {
  elle: "Elle kayıt",
  panel: "Panelden kartla",
  eposta: "E-posta bağlantısı",
  otomatik: "Otomatik yenileme",
  saglayici: "Sağlayıcı",
};

export const FATURA_DURUMU_ADI: Record<RaporFaturaDurumu, string> = {
  yok: "Faturasız",
  bekliyor: "Fatura bekliyor",
  taslak: "Taslak",
  kesinlesti: "Kesinleşti, tahsilat bekliyor",
  tahsil_edildi: "Tahsil edildi",
  hata: "Hata",
};
