/**
 * CNL-11 kuralları (saf işlevler). Fikirler rapor satırlarından belirlenimci hesaplanır; metin
 * hazırdır. Model yalnız aynı olguları başka sözlerle anlatabilir: anlatımdaki her sayı olgularda
 * bulunmazsa model metni atılır (`anlatimGecerliMi`).
 */

export type FikirTuru = "marj" | "yavas_stok" | "gec_odeme" | "erken_odeme";
export type Isaret = "yarar" | "yaramaz" | "getirme";
export const HAFTALIK_FIKIR = 3;
/** "İşe yaramaz" denen kayıt bu süre içinde yeniden önerilmez. */
export const YARAMAZ_SURESI_MS = 90 * 24 * 60 * 60 * 1000;

export interface FikirAdayi {
  tur: FikirTuru;
  varlikId: string | null;
  baslik: string;
  metin: string;
  olgular: Record<string, number | string>;
  raporKodu: string | null;
  hedefYol: string;
  etkiTl: number;
}

const tl = (n: number) => `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
const yuzde = (n: number) => `%${n.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
const tarihTr = (g: string) => `${g.slice(8, 10)}.${g.slice(5, 7)}.${g.slice(0, 4)}`;
const sayi = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number(x));
const yuvarla = (n: number) => Math.round(n * 100) / 100;

/** ISO 8601 hafta (Türkiye takvimine göre gün verilir): 2026-W46. */
export function isoHafta(gun: string): string {
  const t = new Date(`${gun}T00:00:00Z`);
  const haftaGunu = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - haftaGunu);
  const yilBasi = Date.UTC(t.getUTCFullYear(), 0, 1);
  const no = Math.ceil(((t.getTime() - yilBasi) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(no).padStart(2, "0")}`;
}

type Satir = Record<string, unknown>;

/** Marjı düşen ürün: son 30 gün ile önceki 90 gün; ciro iki dönemde de en az 1.000 TL, düşüş en az 5 puan. */
export function marjAdayi(son: Satir[], once: Satir[]): FikirAdayi | null {
  const onceki = new Map(once.map((r) => [String(r.stokId), r]));
  let enIyi: FikirAdayi | null = null;
  for (const r of son) {
    const o = onceki.get(String(r.stokId));
    const [ciro, marj, oCiro, oMarj] = [sayi(r.ciro), sayi(r.marj), sayi(o?.ciro), sayi(o?.marj)];
    if (!o || ciro === null || marj === null || oCiro === null || oMarj === null || ciro < 1000 || oCiro < 1000) continue;
    const dusus = yuvarla(oMarj - marj);
    if (dusus < 5) continue;
    const etki = yuvarla((ciro * dusus) / 100);
    if (enIyi && enIyi.etkiTl >= etki) continue;
    const ad = `${String(r.ad)} (${String(r.kod)})`;
    enIyi = {
      tur: "marj", varlikId: String(r.stokId), raporKodu: "stok.urun-karlilik", hedefYol: "/panel/raporlar?rapor=stok.urun-karlilik", etkiTl: etki,
      baslik: `Marjı düşen ürün: ${ad}`,
      olgular: { urun: ad, marjSon: marj, marjOnce: oMarj, dusus, ciroSon: ciro, etki },
      metin: `${ad} ürününde marj son 30 günde ${yuzde(marj)}; önceki 90 günde ${yuzde(oMarj)} idi (${dusus.toLocaleString("tr-TR")} puan düşüş). Son 30 günün cirosu ${tl(ciro)}; bu düşüş yaklaşık ${tl(etki)} kâr demek. Öneri: maliyet artışını fiyata yansıtın ya da bu üründeki iskontoları gözden geçirin.`,
    };
  }
  return enIyi;
}

/** Yavaş dönen stok: 90 gündür hareketsiz ürünlerde bağlı sermaye en az 1.000 TL. */
export function yavasStokAdayi(satirlar: Satir[]): FikirAdayi | null {
  const l = satirlar.map((r) => ({ ad: `${String(r.ad)} (${String(r.kod)})`, deger: sayi(r.envanterDegeri) ?? 0 })).filter((r) => r.deger > 0).sort((a, b) => b.deger - a.deger);
  const toplam = yuvarla(l.reduce((t, r) => t + r.deger, 0));
  if (toplam < 1000) return null;
  const ilk = l.slice(0, 3);
  return {
    tur: "yavas_stok", varlikId: null, raporKodu: "stok.hareketsiz", hedefYol: "/panel/raporlar?rapor=stok.hareketsiz", etkiTl: toplam,
    baslik: `90 gündür hareketsiz stokta ${tl(toplam)} bağlı`,
    olgular: { urunSayisi: l.length, toplam, ...Object.fromEntries(ilk.flatMap((r, i) => [[`urun${i + 1}`, r.ad], [`deger${i + 1}`, r.deger]])) },
    metin: `${l.length} üründe 90 gündür hareket yok; bağlı sermaye ${tl(toplam)}. En büyükleri: ${ilk.map((r) => `${r.ad} ${tl(r.deger)}`).join(", ")}. Öneri: kampanya, tedarikçiye iade ya da takas düşünün; satın alma önerilerinde bu ürünleri dışarıda tutun.`,
  };
}

/** Geç ödeyen müşteri: ortalama tahsil süresi anlaşılan vadeyi (yoksa 30 gün) en az 15 gün aşar, açık bakiye en az 1.000 TL. */
export function gecOdemeAdayi(satirlar: Satir[], vadeler: Map<string, { vadeGun: number | null; riskLimiti: number | null }>): FikirAdayi | null {
  let enIyi: FikirAdayi | null = null;
  for (const r of satirlar) {
    const [gun, bakiye] = [sayi(r.ortalamaGun), sayi(r.acikBakiye)];
    const cari = vadeler.get(String(r.cariId));
    const vade = cari?.vadeGun ?? 30;
    if (gun === null || bakiye === null || bakiye < 1000 || gun < vade + 15) continue;
    if (enIyi && enIyi.etkiTl >= bakiye) continue;
    const unvan = String(r.unvan);
    const limit = cari?.riskLimiti ? `risk limitini (${tl(cari.riskLimiti)}) gözden geçirin` : "bir risk limiti tanımlayın";
    enIyi = {
      tur: "gec_odeme", varlikId: String(r.cariId), raporKodu: "cari.tahsilat-performansi", hedefYol: `/panel/cari/${String(r.cariId)}`, etkiTl: yuvarla(bakiye),
      baslik: `Geç ödeyen müşteri: ${unvan}`,
      olgular: { cari: unvan, ortalamaGun: Math.round(gun), vadeGun: vade, acikBakiye: yuvarla(bakiye), ...(cari?.riskLimiti ? { riskLimiti: cari.riskLimiti } : {}) },
      metin: `${unvan} ortalama ${Math.round(gun)} günde ödüyor; anlaşılan vade ${vade} gün. Açık bakiyesi ${tl(yuvarla(bakiye))}. Öneri: yeni siparişte vadeyi kısaltın ya da peşinat isteyin, ${limit}.`,
    };
  }
  return enIyi;
}

/**
 * Erken ödeme iskontosu: 15–60 gün içinde vadesi gelen en büyük tedarikçi borcu en az 5.000 TL ve
 * önümüzdeki 30 günün en düşük nakit tahmini bu borcun 1,2 katını karşılıyorsa; %2 iskonto örneklenir.
 */
export function erkenOdemeAdayi(enDusukNakit: number, borclar: Array<{ cariId: string; unvan: string; kalan: number; vade: string }>): FikirAdayi | null {
  const b = [...borclar].sort((x, y) => y.kalan - x.kalan)[0];
  if (!b || b.kalan < 5000 || enDusukNakit < b.kalan * 1.2) return null;
  const iskonto = yuvarla(b.kalan * 0.02);
  return {
    tur: "erken_odeme", varlikId: b.cariId, raporKodu: null, hedefYol: "/panel/nakit-akisi", etkiTl: iskonto,
    baslik: `Erken ödeme iskontosu fırsatı: ${b.unvan}`,
    olgular: { tedarikci: b.unvan, kalan: yuvarla(b.kalan), vade: tarihTr(b.vade), enDusukNakit: yuvarla(enDusukNakit), oran: 2, iskonto },
    metin: `${b.unvan} carisine ${tarihTr(b.vade)} vadeli ${tl(yuvarla(b.kalan))} borcunuz var; önümüzdeki 30 günde en düşük nakit tahmini ${tl(yuvarla(enDusukNakit))}. Erken ödeme karşılığında %2 iskonto isterseniz kazanç ${tl(iskonto)} olur.`,
  };
}

export interface FikirIsareti { tur: FikirTuru; varlikId: string | null; isaret: Isaret; at: Date }

/**
 * CNL-11: işaretler seçimi etkiler. "Getirme" türü kapatır; "yaramaz" aynı kaydı 90 gün getirmez ve
 * türün ağırlığını düşürür (×0,7); "yarar" türün ağırlığını artırır (×1,5). En çok üç fikir.
 */
export function fikirleriSec(adaylar: FikirAdayi[], isaretler: FikirIsareti[], simdi: Date): FikirAdayi[] {
  const kapali = new Set(isaretler.filter((i) => i.isaret === "getirme").map((i) => i.tur));
  const agirlik = (tur: FikirTuru) => isaretler.filter((i) => i.tur === tur).reduce((a, i) => a * (i.isaret === "yarar" ? 1.5 : i.isaret === "yaramaz" ? 0.7 : 1), 1);
  const yakindaYaramaz = (a: FikirAdayi) => isaretler.some((i) => i.isaret === "yaramaz" && i.tur === a.tur && i.varlikId === a.varlikId && simdi.getTime() - i.at.getTime() < YARAMAZ_SURESI_MS);
  return adaylar
    .filter((a) => !kapali.has(a.tur) && !yakindaYaramaz(a))
    .sort((x, y) => y.etkiTl * agirlik(y.tur) - x.etkiTl * agirlik(x.tur))
    .slice(0, HAFTALIK_FIKIR);
}

/** Türkçe yazılmış sayıları değere çevirir: "1.250,50" → 1250.5, "%2" → 2. */
export function metindekiSayilar(metin: string): number[] {
  return (metin.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g) ?? []).map((s) => yuvarla(Number(s.replace(/\./g, "").replace(",", "."))));
}

/** Model anlatımı yalnız olgulardaki ve hazır metindeki sayıları içerebilir; kısa ve boş olmamalı. */
export function anlatimGecerliMi(anlatim: string, aday: Pick<FikirAdayi, "metin" | "olgular">): boolean {
  const m = anlatim.trim();
  if (m.length < 20 || m.length > 700) return false;
  const izinli = new Set([...metindekiSayilar(aday.metin), ...Object.values(aday.olgular).flatMap((v) => (typeof v === "number" ? [yuvarla(v)] : metindekiSayilar(v)))]);
  return metindekiSayilar(m).every((n) => izinli.has(n));
}

/** Telegram düğme verisi: "f:<uuid>:<işaret>" (64 bayt sınırı içinde). */
export const fikirDugmesi = (id: string, isaret: Isaret) => `f:${id}:${isaret}`;
export function fikirDugmesiCoz(veri: string): { fikirId: string; isaret: Isaret } | null {
  const m = /^f:([0-9a-f-]{36}):(yarar|yaramaz|getirme)$/.exec(veri);
  return m ? { fikirId: m[1], isaret: m[2] as Isaret } : null;
}
/** CNL-11: fikirler iş günü bu saatler arasında, haftada bir gider. */
export const FIKIR_BASLANGIC = "10:00";
export const FIKIR_BITIS = "12:00";
