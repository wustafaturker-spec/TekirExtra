import { Prisma } from "@prisma/client";
import { metinNormalize } from "@tekirextra/shared";

type Tx = Prisma.TransactionClient;

/**
 * AI-44: gönderen bir cariyle kesin (adres) eşleşmediğinde yaklaşık adaylar.
 * Model kullanılmaz; her aday gerekçesini taşır. Yalnız VKN/TCKN güçlü
 * sayılır, diğer ipuçları kullanıcıya seçtirilir.
 */

/** Birçok müşterinin paylaştığı alan adları: ücretsiz posta ve pazaryeri aktarma adresleri. */
const ORTAK_ALAN_ADLARI = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.com.tr", "outlook.com", "outlook.com.tr", "live.com", "msn.com",
  "yahoo.com", "yahoo.com.tr", "yandex.com", "yandex.com.tr", "icloud.com", "me.com", "mail.com", "mynet.com", "proton.me", "protonmail.com",
  "trendyolmail.com", "hepsifatura.com", "hepsiburada.com", "n11mail.com", "n11.com", "amazon.com.tr", "marketplace.amazon.com.tr", "ciceksepeti.com", "pazarama.com",
]);

/** Unvandaki tüzel ekler ve bağlaçlar karşılaştırmada sayılmaz. */
const DOLGU = new Set(["ltd", "sti", "ltdsti", "as", "anonim", "sirketi", "sirket", "limited", "san", "sanayi", "tic", "ticaret", "ve", "ith", "ihr", "ithalat", "ihracat", "insaat", "paz", "pazarlama", "dis", "ic", "gida", "a", "s", "ltd.sti", "co", "inc", "llc", "gmbh"]);

/** Cari `aramaNormal` sütunuyla aynı katlama (küçük harf, aksansız). */
export const harfKatla = (metin: string) => metinNormalize(metin);

export function unvanKelimeleri(unvan: string): string[] {
  return [...new Set(harfKatla(unvan).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((k) => k.length >= 2 && !DOLGU.has(k)))];
}

/** Ortak kelime oranı (kısa unvana göre); en az bir kelime 4+ harf olmalı. */
export function unvanBenzerligi(a: string, b: string): number {
  const ka = unvanKelimeleri(a), kb = unvanKelimeleri(b);
  if (!ka.length || !kb.length) return 0;
  const ortak = ka.filter((k) => kb.includes(k));
  if (!ortak.some((k) => k.length >= 4)) return 0;
  return ortak.length / Math.min(ka.length, kb.length);
}

export const ASGARI_UNVAN_BENZERLIGI = 0.6;

/** Telefonun son 10 hanesi (ülke kodu ve baştaki 0 düşer); 10 haneden kısaysa yok sayılır. */
export function telefonAnahtari(telefon: string | null | undefined): string | null {
  const rakam = (telefon ?? "").replace(/\D/g, "");
  return rakam.length >= 10 ? rakam.slice(-10) : null;
}

/** Kurumsal alan adı; ortak/ücretsiz/pazaryeri adresinde null. */
export function kurumsalAlanAdi(eposta: string): string | null {
  const alan = eposta.trim().toLowerCase().split("@")[1];
  if (!alan || !alan.includes(".")) return null;
  return ORTAK_ALAN_ADLARI.has(alan) ? null : alan;
}

export const vknGecerliMi = (v: string | null | undefined) => Boolean(v && /^\d{10,11}$/.test(v));

export interface CariAdayi { cariId: string; kod: string | null; unvan: string; vknTckn: string | null; gerekceler: string[]; guclu: boolean; puan: number }

export async function cariAdaylari(
  tx: Tx,
  tenantId: string,
  ipucu: { eposta?: string | null; vknTckn?: string | null; telefon?: string | null; unvan?: string | null },
): Promise<CariAdayi[]> {
  const adaylar = new Map<string, { gerekceler: string[]; puan: number; guclu: boolean }>();
  const ekle = (id: string, gerekce: string, puan: number, guclu = false) => {
    const a = adaylar.get(id) ?? { gerekceler: [], puan: 0, guclu: false };
    if (!a.gerekceler.includes(gerekce)) { a.gerekceler.push(gerekce); a.puan += puan; }
    a.guclu ||= guclu;
    adaylar.set(id, a);
  };

  if (vknGecerliMi(ipucu.vknTckn)) {
    const kartlar = await tx.cariHesap.findMany({ where: { tenantId, aktif: true, vknTckn: ipucu.vknTckn! }, select: { id: true }, take: 5 });
    for (const k of kartlar) ekle(k.id, `VKN/TCKN eşleşti (${ipucu.vknTckn})`, 100, kartlar.length === 1);
  }

  const tel = telefonAnahtari(ipucu.telefon);
  if (tel) {
    const satirlar = await tx.$queryRaw<{ id: string }[]>`
      SELECT c.id::text FROM cari_hesaplar c WHERE c.tenant_id = ${tenantId}::uuid AND c.aktif AND right(regexp_replace(coalesce(c.telefon, ''), '\\D', '', 'g'), 10) = ${tel}
      UNION SELECT k.cari_id::text FROM cari_kisiler k JOIN cari_hesaplar c ON c.id = k.cari_id WHERE k.tenant_id = ${tenantId}::uuid AND c.aktif AND right(regexp_replace(coalesce(k.telefon, ''), '\\D', '', 'g'), 10) = ${tel}
      LIMIT 5`;
    for (const s of satirlar) ekle(s.id, "telefon eşleşti", 40);
  }

  const alan = ipucu.eposta ? kurumsalAlanAdi(ipucu.eposta) : null;
  if (alan) {
    const bitis = `@${alan}`;
    const [kartlar, kisiler] = await Promise.all([
      tx.cariHesap.findMany({ where: { tenantId, aktif: true, eposta: { endsWith: bitis, mode: "insensitive" } }, select: { id: true }, take: 5 }),
      tx.cariKisi.findMany({ where: { tenantId, eposta: { endsWith: bitis, mode: "insensitive" }, cari: { aktif: true } }, select: { cariId: true }, take: 5 }),
    ]);
    const idler = [...new Set([...kartlar.map((k) => k.id), ...kisiler.map((k) => k.cariId)])];
    // Alan adı birden çok cariye aitse (grup şirketleri, ortak alan) ipucu sayılmaz.
    if (idler.length === 1) ekle(idler[0], `alan adı ${alan}`, 40);
  }

  const unvan = ipucu.unvan?.trim();
  if (unvan && unvan.length >= 3) {
    const kelime = unvanKelimeleri(unvan).filter((k) => k.length >= 4).sort((a, b) => b.length - a.length)[0];
    if (kelime) {
      const kartlar = await tx.cariHesap.findMany({ where: { tenantId, aktif: true, aramaNormal: { contains: kelime } }, select: { id: true, unvan: true }, take: 50 });
      for (const k of kartlar) {
        const benzerlik = unvanBenzerligi(unvan, k.unvan);
        if (benzerlik >= ASGARI_UNVAN_BENZERLIGI) ekle(k.id, `unvan benzer (%${Math.round(benzerlik * 100)})`, Math.round(30 * benzerlik));
      }
    }
  }

  if (!adaylar.size) return [];
  const kartlar = await tx.cariHesap.findMany({ where: { tenantId, id: { in: [...adaylar.keys()] } }, select: { id: true, kod: true, unvan: true, vknTckn: true } });
  return kartlar
    .map((k) => ({ cariId: k.id, kod: k.kod, unvan: k.unvan, vknTckn: k.vknTckn, ...adaylar.get(k.id)! }))
    .sort((a, b) => b.puan - a.puan)
    .slice(0, 5);
}
