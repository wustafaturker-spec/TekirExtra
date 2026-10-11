/**
 * RPR-16 (inceleme P2-1): Excel ve PDF çıktısının ekrandakiyle aynı bilgiyi
 * taşıması için ortak parçalar — dönem ve süzgeç özeti (kimlikler adlarıyla),
 * ekrandaki kuralla toplam satırı ve dövizli hücrenin para birimi.
 */
import type { Prisma } from "@prisma/client";
import type { RaporGirdisi, RaporKolon, RaporSatiri, RaporTanimi } from "./rapor-kayit";

type Tx = Prisma.TransactionClient;

export interface DisaAktarimBilgisi {
  /** Başlıkta rapor adının önüne yazılır. */
  firma?: string;
  /** "Dönem: …", "Cari: …" gibi satırlar. */
  bilgiler: string[];
  /** `#rrggbb`; firmanın belge teması. */
  vurguRengi?: string;
}

const tarihTr = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}` : v);

/** Kayıt seçen süzgeçlerin (cari, stok, depo, etiket, hesap) değerlerini adlarına çevirir. */
async function kayitAdlari(tx: Tx, tip: string, degerler: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const uuid = degerler.filter((d) => /^[0-9a-f-]{36}$/i.test(d));
  if (tip === "cari" && uuid.length) {
    for (const c of await tx.cariHesap.findMany({ where: { id: { in: uuid } }, select: { id: true, kod: true, unvan: true } })) m.set(c.id, `${c.kod} · ${c.unvan}`);
  } else if (tip === "stok" && uuid.length) {
    for (const s of await tx.stokKart.findMany({ where: { id: { in: uuid } }, select: { id: true, kod: true, ad: true } })) m.set(s.id, `${s.kod} · ${s.ad}`);
  } else if (tip === "depo" && uuid.length) {
    for (const d of await tx.depo.findMany({ where: { id: { in: uuid } }, select: { id: true, ad: true } })) m.set(d.id, d.ad);
  } else if (tip === "etiket" && uuid.length) {
    for (const e of await tx.cariEtiket.findMany({ where: { id: { in: uuid } }, select: { id: true, ad: true } })) m.set(e.id, e.ad);
  } else if (tip === "hesap") {
    for (const d of degerler) {
      const [tur, id] = d.split(":");
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) continue;
      const kayit =
        tur === "kasa" ? await tx.kasa.findUnique({ where: { id }, select: { ad: true } })
        : tur === "banka" ? await tx.bankaHesap.findUnique({ where: { id }, select: { ad: true } })
        : tur === "pos" ? await tx.posHesap.findUnique({ where: { id }, select: { ad: true } })
        : null;
      if (kayit) m.set(d, `${tur === "kasa" ? "Kasa" : tur === "banka" ? "Banka" : "POS"} · ${kayit.ad}`);
    }
  }
  return m;
}

/** Girdiyi okunur satırlara çevirir: dönem tek satırda, diğer süzgeçler adlarıyla, sonra kırılım. */
export async function girdiOzeti(tx: Tx, tanim: Pick<RaporTanimi, "filtreler" | "gruplamalar">, girdi: RaporGirdisi): Promise<string[]> {
  const f = girdi.filtreler ?? {};
  const satirlar: string[] = [];
  const bas = f.baslangic, bit = f.bitis;
  if (typeof bas === "string" || typeof bit === "string") {
    satirlar.push(`Dönem: ${bas ? tarihTr(String(bas)) : "…"} – ${bit ? tarihTr(String(bit)) : "…"}`);
  }
  for (const t of tanim.filtreler) {
    if (t.alan === "baslangic" || t.alan === "bitis") continue;
    const v = f[t.alan];
    if (v === undefined || v === "" || v === false) continue;
    let yazi: string;
    if (t.tip === "onay") yazi = "Evet";
    else if (t.tip === "tarih") yazi = tarihTr(String(v));
    else if (t.tip === "secim") yazi = t.secenekler?.find((s) => s.deger === String(v))?.ad ?? String(v);
    else if (["cari", "stok", "depo", "etiket", "hesap"].includes(t.tip)) yazi = (await kayitAdlari(tx, t.tip, [String(v)])).get(String(v)) ?? String(v);
    else yazi = String(v);
    satirlar.push(`${t.ad}: ${yazi}`);
  }
  if (girdi.gruplama) {
    satirlar.push(`Kırılım: ${tanim.gruplamalar?.find((g) => g.deger === girdi.gruplama)?.ad ?? girdi.gruplama}`);
  }
  return satirlar;
}

export type ToplamHucresi = { deger: number; doviz?: string } | "karisik";

/**
 * Ekrandaki toplam satırıyla aynı kural (rapor-paneli.tsx): yalnız `toplam`
 * işaretli sütunlar; dövizli sütun satırların hepsi aynı dövizdeyse toplanır.
 * Tek satırlık sonuçta toplam satırı yoktur.
 */
export function toplamSatiri(kolonlar: RaporKolon[], satirlar: RaporSatiri[]): Map<string, ToplamHucresi> | null {
  if (satirlar.length < 2) return null;
  const sonuc = new Map<string, ToplamHucresi>();
  for (const k of kolonlar.filter((x) => x.toplam)) {
    const dovizler = new Set(k.dovizAlani ? satirlar.map((s) => String(s[k.dovizAlani!] ?? "TRY")) : ["TRY"]);
    if (dovizler.size > 1) { sonuc.set(k.alan, "karisik"); continue; }
    const toplam = satirlar.reduce((t, s) => t + (Number(s[k.alan]) || 0), 0);
    sonuc.set(k.alan, { deger: Math.round(toplam * 100) / 100, ...(k.dovizAlani ? { doviz: [...dovizler][0] } : {}) });
  }
  return sonuc.size ? sonuc : null;
}

/** Dövizli para sütununda hücrenin para birimi; TL sütununda yok. */
export const hucreDovizi = (k: RaporKolon, satir: RaporSatiri): string | undefined =>
  k.tip === "para" && k.dovizAlani ? String(satir[k.dovizAlani] ?? "TRY") : undefined;
