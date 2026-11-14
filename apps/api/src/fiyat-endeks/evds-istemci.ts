/**
 * END-03: TCMB EVDS istemcisi. Adres 2026-11-14'te canlı doğrulandı: eski
 * `evds3.tcmb.gov.tr/service/evds/` yolu artık JSON yerine web arayüzünün
 * HTML'ini döndürüyor; veri servisi `igmevdsms-dis` altındadır. Anahtar
 * yalnız `key` başlığında gider, adreste ve günlükte yer almaz.
 */
export const EVDS_TABAN_ADRESI = "https://evds3.tcmb.gov.tr/igmevdsms-dis";

const ZAMAN_ASIMI_MS = 20_000;

export class EvdsHatasi extends Error {}

export interface EvdsDegeri {
  /** Ayın ilk günü, YYYY-MM-01. */
  donem: string;
  /** Kaynaktaki ondalık metin (ör. "5998.51"). */
  deger: string;
}

export const ddmmyyyy = (tarih: Date) =>
  `${String(tarih.getUTCDate()).padStart(2, "0")}-${String(tarih.getUTCMonth() + 1).padStart(2, "0")}-${tarih.getUTCFullYear()}`;

/** EVDS yanıtındaki alan adı: seri kodundaki noktalar alt çizgi olur. */
export const evdsAlanAdi = (evdsKodu: string) => evdsKodu.replace(/\./g, "_");

/** Aylık serinin tarih metni ("2026-10" ya da "2026-1") → "2026-10-01". */
export function aylikDonem(metin: string): string | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(metin.trim());
  if (!m) return null;
  const ay = Number(m[2]);
  return ay >= 1 && ay <= 12 ? `${m[1]}-${String(ay).padStart(2, "0")}-01` : null;
}

const ONDALIK = /^\d+(?:\.\d+)?$/;

/** Yanıtı seri bazında aylık değerlere çevirir; boş/bozuk değer atlanır, uydurulmaz. */
export function evdsYanitiniAyristir(govde: unknown, evdsKodlari: readonly string[]): Map<string, EvdsDegeri[]> {
  const satirlar = Array.isArray(govde) ? govde : (govde as { items?: unknown })?.items;
  if (!Array.isArray(satirlar)) throw new EvdsHatasi("EVDS yanıtında veri listesi yok.");
  const sonuc = new Map<string, EvdsDegeri[]>(evdsKodlari.map((k) => [k, []]));
  for (const ham of satirlar) {
    if (!ham || typeof ham !== "object") continue;
    const satir = ham as Record<string, unknown>;
    const donem = aylikDonem(String(satir.Tarih ?? satir.TARIH ?? ""));
    if (!donem) continue;
    for (const kod of evdsKodlari) {
      const deger = satir[evdsAlanAdi(kod)];
      if (typeof deger !== "string" || !ONDALIK.test(deger.trim()) || Number(deger) <= 0) continue;
      sonuc.get(kod)!.push({ donem, deger: deger.trim() });
    }
  }
  return sonuc;
}

/** Aylık serilerin aralıktaki değerleri. Ağ, yetki ya da biçim hatasında `EvdsHatasi`. */
export async function evdsAylikDegerler(
  anahtar: string,
  evdsKodlari: readonly string[],
  baslangic: Date,
  bitis: Date,
  istek: typeof fetch = fetch,
): Promise<Map<string, EvdsDegeri[]>> {
  if (!anahtar) throw new EvdsHatasi("EVDS API anahtarı (TCMB_EVDS_API_KEY) tanımlı değil.");
  if (!evdsKodlari.length) return new Map();
  const adres = `${EVDS_TABAN_ADRESI}/series=${evdsKodlari.map(encodeURIComponent).join("-")}&startDate=${ddmmyyyy(baslangic)}&endDate=${ddmmyyyy(bitis)}&type=json`;
  let yanit: Response;
  try {
    yanit = await istek(adres, { headers: { key: anahtar, Accept: "application/json" }, signal: AbortSignal.timeout(ZAMAN_ASIMI_MS), redirect: "manual" });
  } catch (hata) {
    throw new EvdsHatasi(`EVDS'ye ulaşılamadı (${hata instanceof Error ? hata.name : "ağ hatası"}).`);
  }
  if (!yanit.ok) {
    await yanit.body?.cancel().catch(() => undefined);
    throw new EvdsHatasi(yanit.status === 401 || yanit.status === 403 ? "EVDS anahtarı reddedildi." : `EVDS HTTP ${yanit.status} döndürdü.`);
  }
  if (!(yanit.headers.get("content-type") ?? "").includes("json")) {
    await yanit.body?.cancel().catch(() => undefined);
    throw new EvdsHatasi("EVDS JSON yerine başka bir içerik döndürdü; servis adresi değişmiş olabilir.");
  }
  let govde: unknown;
  try { govde = await yanit.json(); } catch { throw new EvdsHatasi("EVDS yanıtı okunamadı."); }
  return evdsYanitiniAyristir(govde, evdsKodlari);
}
