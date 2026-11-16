import { senaryoyuKos, TavanAsildi, type DenemeSonucu, type OlculenSaglayici } from "./kosucu";
import { aracSurumu, gecmeEsigi, istemSurumu, ozetCikar, type KosuRaporu, type SenaryoRaporu } from "./rapor";
import type { DegerlendirmeSenaryosu } from "./senaryo";
import { KRITIK_TEKRAR, SENARYO_SETI_SURUMU } from "./senaryolar";

/** Sağlayıcı hatasında (503, zaman aşımı) aynı deneme en çok bu kadar yeniden koşar; puanlama hatası yeniden koşmaz. */
const SAGLAYICI_DENEMESI = 3;

export interface KosuSecenekleri {
  /** Aynı anda koşan deneme sayısı (sağlayıcı hız sınırı için düşük tutun). */
  paralel?: number;
  kodSurumu?: string | null;
  /** İlerleme satırı (stderr). */
  ilerleme?: (satir: string) => void;
  /** Testlerde bekleme yok. */
  bekle?: (ms: number) => Promise<void>;
}

async function denemeKos(saglayici: OlculenSaglayici, s: DegerlendirmeSenaryosu, bekle: (ms: number) => Promise<void>): Promise<DenemeSonucu> {
  for (let deneme = 0; ; deneme++) {
    const baslangic = Date.now();
    try {
      return await senaryoyuKos(saglayici, s);
    } catch (hata) {
      if (hata instanceof TavanAsildi) throw hata;
      const mesaj = (hata instanceof Error ? hata.message : String(hata)).slice(0, 300);
      // 429 hız sınırında kısa bekleme yetmiyor (ilk koşu 2026-11-16): 5, 20, 45 sn.
      if (deneme < SAGLAYICI_DENEMESI) { await bekle(5_000 * (deneme + 1) ** 2); continue; }
      return { gecti: false, hatalar: [], uyarilar: [], araclar: [], talepler: [], cevap: "", sureMs: Date.now() - baslangic, saglayiciHatasi: mesaj };
    }
  }
}

/**
 * Senaryoları koşar: kritikler KRITIK_TEKRAR kez, diğerleri bir kez. Tavan
 * dolunca kalan denemeler koşmaz ve rapor "tamamlanmadı" olur.
 */
export async function degerlendirmeKos(saglayici: OlculenSaglayici, senaryolar: DegerlendirmeSenaryosu[], fiyat: { giris: number; cikis: number }, secenek: KosuSecenekleri = {}): Promise<KosuRaporu> {
  const baslangic = Date.now();
  const bekle = secenek.bekle ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const isler = senaryolar.flatMap((s) => Array.from({ length: s.kritik ? KRITIK_TEKRAR : 1 }, (_, i) => ({ s, i })));
  const sonuclar = new Map<string, DenemeSonucu[]>();
  const kosmayan = new Set<string>();
  let tavanDoldu = false;
  let sira = 0;
  const isci = async () => {
    while (sira < isler.length) {
      const is = isler[sira++];
      if (tavanDoldu) { kosmayan.add(is.s.id); continue; }
      try {
        const d = await denemeKos(saglayici, is.s, bekle);
        sonuclar.set(is.s.id, [...(sonuclar.get(is.s.id) ?? []), d]);
        secenek.ilerleme?.(`${d.gecti ? "✓" : "✗"} ${is.s.id}${is.s.kritik ? ` #${is.i + 1}` : ""} ${d.saglayiciHatasi ? `(sağlayıcı: ${d.saglayiciHatasi})` : d.hatalar[0] ?? ""} · ${saglayici.harcananUsd.toFixed(4)} USD`);
      } catch (hata) {
        if (!(hata instanceof TavanAsildi)) throw hata;
        tavanDoldu = true;
        kosmayan.add(is.s.id);
        secenek.ilerleme?.(`■ ${hata.message} Kalan denemeler koşmayacak.`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(secenek.paralel ?? 1, 8)) }, isci));

  const raporlar: SenaryoRaporu[] = senaryolar.filter((s) => sonuclar.has(s.id) && !kosmayan.has(s.id)).map((s) => {
    const denemeler = sonuclar.get(s.id)!;
    const gecen = denemeler.filter((d) => d.gecti).length;
    return { id: s.id, kategori: s.kategori, kritik: !!s.kritik, tekrar: denemeler.length, gecen, gecti: gecen >= gecmeEsigi(denemeler.length), denemeler };
  });
  return {
    bicim: 1,
    tarih: new Date().toISOString(),
    saglayici: saglayici.saglayiciAdi,
    model: saglayici.modelAdi ?? null,
    istemSurumu: istemSurumu(),
    aracSurumu: aracSurumu(),
    senaryoSetiSurumu: SENARYO_SETI_SURUMU,
    kodSurumu: secenek.kodSurumu ?? null,
    tavanUsd: saglayici.tavanUsd,
    fiyat,
    harcananUsd: Number(saglayici.harcananUsd.toFixed(6)),
    maliyetTahmini: saglayici.tahmini,
    cagriSayisi: saglayici.cagriSayisi,
    girisToken: saglayici.girisToken,
    cikisToken: saglayici.cikisToken,
    sureMs: Date.now() - baslangic,
    tamamlandi: kosmayan.size === 0,
    kosmayanlar: [...kosmayan],
    ozet: ozetCikar(raporlar),
    senaryolar: raporlar,
  };
}
