import { sozGunuGecerli } from "./odeme-sozu";
export type TakipDurumu = "acik" | "beklemede" | "tamamlandi" | "iptal";
export interface TahsilatTakibi {
  id: string; cari: { id: string; unvan: string }; sorumlu: { id: string; adSoyad: string; aktif: boolean };
  konu: string; neden: "tahsilat" | "itiraz"; durum: TakipDurumu; sonrakiIslemTarihi: string | null;
  sonrakiIslem: string | null; sonIslemGerekcesi: string | null; surum: number; createdAt: string; updatedAt: string;
}
export interface TakipListesi {
  kullanimModu: "pilot" | "acik" | "salt_okunur"; bugun: string; alindigiZaman: string; cariId: string | null;
  gorunum: string; sorumluUserId: string | null; toplam: number; sonrakiImlec: string | null; kayitlar: TahsilatTakibi[];
}
export interface TakipDetayi {
  kullanimModu: TakipListesi["kullanimModu"]; kayit: TahsilatTakibi; gorusmeSayisi: number; olaySayisi: number;
  gorusmeler: { id: string; kanal: string; gorusmeTarihi: string; not: string; createdAt: string }[];
  olaylar: { id: string; islem: string; createdAt: string; aciklama: string }[];
}
export const takipAktif = (s: { durum: string }) => ["acik", "beklemede"].includes(s.durum);
export const takipDurumAdi: Record<TakipDurumu, string> = { acik: "Açık", beklemede: "Beklemede", tamamlandi: "Tamamlandı", iptal: "İptal" };
export const takipUuid = (v: unknown): v is string => typeof v === "string" && /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
const tarih = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
function kontrol(v: unknown): asserts v { if (!v) throw new Error("Tahsilat takibi yanıtı veya kapsamı doğrulanamadı. Yenileyin."); }
function nesne(v: unknown): Record<string, any> { kontrol(v && typeof v === "object" && !Array.isArray(v)); return v as Record<string, any>; }
const mod = (v: unknown) => ["pilot", "acik", "salt_okunur"].includes(String(v));
function kayit(v: unknown): TahsilatTakibi {
  const s = nesne(v), c = nesne(s.cari), u = nesne(s.sorumlu);
  kontrol(takipUuid(s.id) && takipUuid(c.id) && typeof c.unvan === "string" && takipUuid(u.id) && typeof u.adSoyad === "string" && typeof u.aktif === "boolean");
  kontrol(typeof s.konu === "string" && ["tahsilat", "itiraz"].includes(s.neden) && Object.hasOwn(takipDurumAdi, s.durum) && Number.isInteger(s.surum) && s.surum > 0 && s.surum <= 2147483647);
  kontrol(tarih(s.createdAt) && tarih(s.updatedAt) && (s.sonIslemGerekcesi === null || typeof s.sonIslemGerekcesi === "string"));
  if (takipAktif({ durum:s.durum })) kontrol(typeof s.sonrakiIslemTarihi === "string" && sozGunuGecerli(s.sonrakiIslemTarihi) && typeof s.sonrakiIslem === "string" && s.sonrakiIslem.length >= 2);
  else kontrol(s.sonrakiIslemTarihi === null && s.sonrakiIslem === null);
  return s as TahsilatTakibi;
}
export function takipListesiniDogrula(v: unknown, kapsam: { cariId?: string; gorunum: string; sorumluUserId?: string }): TakipListesi {
  const r = nesne(v);
  kontrol(mod(r.kullanimModu) && r.cariId === (kapsam.cariId ?? null) && r.gorunum === kapsam.gorunum && r.sorumluUserId === (kapsam.sorumluUserId ?? null));
  kontrol(typeof r.bugun === "string" && sozGunuGecerli(r.bugun) && tarih(r.alindigiZaman) && Number.isSafeInteger(r.toplam) && r.toplam >= 0 && (r.sonrakiImlec === null || takipUuid(r.sonrakiImlec)) && Array.isArray(r.kayitlar) && r.kayitlar.length <= 50 && r.toplam >= r.kayitlar.length);
  const kimlikler = new Set<string>();
  for (const ham of r.kayitlar) {
    const s = kayit(ham); kontrol(!kimlikler.has(s.id)); kimlikler.add(s.id);
    kontrol(!kapsam.cariId || s.cari.id === kapsam.cariId); kontrol(!kapsam.sorumluUserId || s.sorumlu.id === kapsam.sorumluUserId);
    if (kapsam.gorunum !== "tum") kontrol(takipAktif(s));
    if (kapsam.gorunum === "itiraz") kontrol(s.neden === "itiraz");
    if (kapsam.gorunum === "bugun") kontrol(s.sonrakiIslemTarihi! <= r.bugun);
  }
  return r as TakipListesi;
}
export function takipDetayiniDogrula(v: unknown, id: string, cariId?: string): TakipDetayi {
  const r = nesne(v), s = kayit(r.kayit);
  kontrol(mod(r.kullanimModu) && s.id === id && (!cariId || s.cari.id === cariId));
  for (const [alan, adet] of [["gorusmeler", "gorusmeSayisi"], ["olaylar", "olaySayisi"]]) kontrol(Array.isArray(r[alan]) && r[alan].length <= 100 && Number.isSafeInteger(r[adet]) && r[adet] >= r[alan].length);
  for (const ham of r.gorusmeler) { const g = nesne(ham); kontrol(takipUuid(g.id) && ["telefon", "eposta", "ziyaret", "not"].includes(g.kanal) && tarih(g.gorusmeTarihi) && tarih(g.createdAt) && typeof g.not === "string"); }
  for (const ham of r.olaylar) { const o = nesne(ham); kontrol(takipUuid(o.id) && typeof o.islem === "string" && tarih(o.createdAt) && typeof o.aciklama === "string"); }
  return r as TakipDetayi;
}
export function sorumlulariDogrula(v: unknown): { kayitlar: { id: string; adSoyad: string }[]; varsayilanUserId: string | null } {
  const r = nesne(v); kontrol(Array.isArray(r.kayitlar) && r.kayitlar.length <= 1000 && (r.varsayilanUserId === null || takipUuid(r.varsayilanUserId)));
  for (const u of r.kayitlar) kontrol(takipUuid(u.id) && typeof u.adSoyad === "string");
  kontrol(r.varsayilanUserId === null || r.kayitlar.some((u: any) => u.id === r.varsayilanUserId)); return r as any;
}
