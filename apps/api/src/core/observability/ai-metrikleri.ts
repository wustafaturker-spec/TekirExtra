/**
 * AI-112: yapay zekâ metrikleri (Prometheus metin biçimi). Süreç başına tek kayıt defteri;
 * api ve worker `/metrics` çıktısına `MetricsService.render()` ile eklenir.
 *
 * Etiketlerde firma, kullanıcı, cari adı, VKN ya da istem YOKTUR: her metriğin etiket adları
 * sabittir ve her etiketin değeri izinli bir kümeyle sınırlanır (bilinmeyen değer `diger`).
 * Böylece hem kişisel veri sızmaz hem de etiket sayısı (kardinalite) sınırlı kalır.
 */

type Etiketler = Record<string, string>;
type Izinli = Record<string, ReadonlySet<string> | null>;

const kume = (...x: string[]) => new Set(x);
const OZELLIK = kume("asistan", "tarama", "ozet", "gorev", "ekstre", "hatirlatma", "teklif", "ondenetim", "gelendenetim", "metin");
const SAGLAYICI = kume("openai", "anthropic", "gemini", "ollama", "mock", "tanimsiz");
const KANAL = kume("WEB", "TELEGRAM", "MCP");

/** Tanımlar: ad → yardım metni, etiket adları ve izinli değerleri. */
const SAYACLAR = {
  tekirextra_ai_cagri_toplam: { yardim: "Model çağrıları (sonuca göre).", etiket: { ozellik: OZELLIK, saglayici: SAGLAYICI, sonuc: kume("basarili", "hata") } },
  tekirextra_ai_token_toplam: { yardim: "Model token sayısı (giriş/çıkış).", etiket: { yon: kume("giris", "cikis") } },
  tekirextra_ai_maliyet_usd_toplam: { yardim: "Model maliyeti (USD).", etiket: { saglayici: SAGLAYICI } },
  tekirextra_ai_onay_karari_toplam: { yardim: "AI onay talebi kararları.", etiket: { karar: kume("onaylandi", "reddedildi"), kanal: KANAL } },
  tekirextra_ai_onay_cakisma_toplam: { yardim: "AI onay kararı çakışmaları (sürüm, sonuçlanmış, süre).", etiket: { kod: kume("ESKI_SURUM", "ZATEN_SONUCLANDI", "SURESI_DOLDU") } },
  tekirextra_ai_arac_ret_toplam: { yardim: "Döngünün çalıştırmadığı araç çağrıları.", etiket: { neden: kume("harici_icerik", "gecersiz_girdi", "yetki", "izinsiz_arac") } },
  tekirextra_ai_kaynaksiz_rakam_toplam: { yardim: "Kaynağı bulunamayan tutar/oran yakalamaları (AI-111).", etiket: {} },
  tekirextra_ai_gorev_toplam: { yardim: "Arka plan analizi durum geçişleri.", etiket: { durum: kume("kuyrukta", "calisiyor", "tamamlandi", "hata", "iptal") } },
  tekirextra_ai_arayuz_eylemi_toplam: { yardim: "Arayüz eylemleri (AI-114).", etiket: { eylem: kume("sayfaya_git", "suzgec_uygula", "sekme_ac", "kayit_vurgula", "formu_doldur"), sonuc: kume("basarili", "reddedildi") } },
} as const satisfies Record<string, { yardim: string; etiket: Izinli }>;

const HISTOGRAMLAR = {
  tekirextra_ai_cagri_suresi_saniye: { yardim: "Model çağrısı süresi.", etiket: { ozellik: OZELLIK }, kovalar: [0.5, 1, 2, 5, 10, 20, 30, 60, 120] },
  tekirextra_ai_ilk_parca_suresi_saniye: { yardim: "Akışlı asistanda istekten ilk olaya kadar geçen süre.", etiket: { kanal: KANAL }, kovalar: [0.25, 0.5, 1, 2, 3, 5, 10, 30] },
  tekirextra_ai_olay_gecikmesi_saniye: { yardim: "AI olayının yazılmasından teslimine kadar geçen süre (AI-106).", etiket: {}, kovalar: [1, 5, 15, 30, 60, 120, 300, 600, 1800] },
} as const satisfies Record<string, { yardim: string; etiket: Izinli; kovalar: readonly number[] }>;

const GOSTERGELER = {
  tekirextra_ai_butce_esigi_asan_firma: { yardim: "Bu ay maliyeti aylık bütçesinin %80'ine ulaşan firma sayısı (veritabanından).", etiket: {} },
} as const satisfies Record<string, { yardim: string; etiket: Izinli }>;

export type AiSayac = keyof typeof SAYACLAR;
export type AiHistogram = keyof typeof HISTOGRAMLAR;
export type AiGosterge = keyof typeof GOSTERGELER;

function temizle(izinli: Izinli, etiketler: Etiketler): Etiketler {
  return Object.fromEntries(Object.keys(izinli).map((ad) => {
    const deger = etiketler[ad] ?? "";
    const k = izinli[ad];
    return [ad, k && !k.has(deger) ? "diger" : deger];
  }));
}
const anahtar = (e: Etiketler) => JSON.stringify(Object.entries(e).sort(([a], [b]) => a.localeCompare(b)));
const etiketMetni = (e: Etiketler) => {
  const s = Object.entries(e).map(([k, v]) => `${k}="${v.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",");
  return s ? `{${s}}` : "";
};

class AiMetrikleri {
  private readonly sayaclar = new Map<string, Map<string, { etiket: Etiketler; deger: number }>>();
  private readonly histogramlar = new Map<string, Map<string, { etiket: Etiketler; kovalar: number[]; toplam: number; adet: number }>>();
  private readonly gostergeler = new Map<string, number>();

  artir(ad: AiSayac, etiketler: Etiketler = {}, deger = 1): void {
    if (!(deger > 0) || !Number.isFinite(deger)) return;
    const e = temizle(SAYACLAR[ad].etiket, etiketler);
    const seri = this.sayaclar.get(ad) ?? new Map();
    const k = anahtar(e);
    seri.set(k, { etiket: e, deger: (seri.get(k)?.deger ?? 0) + deger });
    this.sayaclar.set(ad, seri);
  }

  gozlemle(ad: AiHistogram, saniye: number, etiketler: Etiketler = {}): void {
    if (!Number.isFinite(saniye) || saniye < 0) return;
    const t = HISTOGRAMLAR[ad];
    const e = temizle(t.etiket, etiketler);
    const seri = this.histogramlar.get(ad) ?? new Map();
    const k = anahtar(e);
    const h = seri.get(k) ?? { etiket: e, kovalar: t.kovalar.map(() => 0), toplam: 0, adet: 0 };
    t.kovalar.forEach((sinir, i) => { if (saniye <= sinir) h.kovalar[i]++; });
    h.toplam += saniye; h.adet++;
    seri.set(k, h);
    this.histogramlar.set(ad, seri);
  }

  ayarla(ad: AiGosterge, deger: number): void {
    if (Number.isFinite(deger)) this.gostergeler.set(ad, deger);
  }

  render(): string {
    const satirlar: string[] = [];
    for (const [ad, t] of Object.entries(SAYACLAR)) {
      satirlar.push(`# HELP ${ad} ${t.yardim}`, `# TYPE ${ad} counter`);
      for (const s of this.sayaclar.get(ad)?.values() ?? []) satirlar.push(`${ad}${etiketMetni(s.etiket)} ${s.deger}`);
    }
    for (const [ad, t] of Object.entries(HISTOGRAMLAR)) {
      satirlar.push(`# HELP ${ad} ${t.yardim}`, `# TYPE ${ad} histogram`);
      for (const h of this.histogramlar.get(ad)?.values() ?? []) {
        t.kovalar.forEach((sinir, i) => satirlar.push(`${ad}_bucket${etiketMetni({ ...h.etiket, le: String(sinir) })} ${h.kovalar[i]}`));
        satirlar.push(`${ad}_bucket${etiketMetni({ ...h.etiket, le: "+Inf" })} ${h.adet}`, `${ad}_sum${etiketMetni(h.etiket)} ${h.toplam}`, `${ad}_count${etiketMetni(h.etiket)} ${h.adet}`);
      }
    }
    for (const [ad, t] of Object.entries(GOSTERGELER)) {
      satirlar.push(`# HELP ${ad} ${t.yardim}`, `# TYPE ${ad} gauge`);
      const d = this.gostergeler.get(ad);
      if (d !== undefined) satirlar.push(`${ad} ${d}`);
    }
    return `${satirlar.join("\n")}\n`;
  }

  /** Yalnız testler için. */
  sifirla(): void {
    this.sayaclar.clear(); this.histogramlar.clear(); this.gostergeler.clear();
  }
}

export const aiMetrik = new AiMetrikleri();
