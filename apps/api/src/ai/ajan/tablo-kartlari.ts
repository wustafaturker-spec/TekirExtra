/**
 * AI-117: yanıtta tablo ve grafik kartı. Kart verisi doğrudan araç çıktısından
 * çizilir; model tablo ya da rakam yazmaz. Hücre değerleri aracın döndürdüğü
 * değerlerin metin hâlidir (yuvarlama, toplama, türetme yok); biçimlendirme
 * istemcide yapılır. Toplam satır sayısı kaynağın bildirdiği sayıdır.
 */

export type TabloKolonTipi = "metin" | "sayi" | "para" | "yuzde" | "tarih";

export interface TabloKolonu {
  alan: string;
  baslik: string;
  tip: TabloKolonTipi;
  /** Para sütununda sabit para birimi. */
  paraBirimi?: string;
  /** Para sütununda satırdaki para birimi alanı. */
  dovizAlani?: string;
}

export interface TabloGrafigi {
  tur: "cubuk" | "cizgi";
  etiketAlani: string;
  /** Para birimi tek olan para ya da sayı sütunları (en çok 2). */
  seriler: Array<{ alan: string; baslik: string }>;
  paraBirimi?: string;
}

export interface TabloKarti {
  arac: string;
  baslik: string;
  /** Rapor ya da ilgili ekranın panel adresi. */
  adres: string;
  kolonlar: TabloKolonu[];
  satirlar: Array<Record<string, string | null>>;
  /** Kaynağın bildirdiği toplam satır; gösterilenden fazlaysa kart uyarır. */
  satirSayisi: number;
  grafik?: TabloGrafigi;
  uyarilar: string[];
}

export const KART_SATIR_SINIRI = 20;
export const TUR_KART_SINIRI = 4;
const GRAFIK_EN_AZ_SATIR = 2;

/** Kartı olan araçlar. */
export const KARTLI_ARACLAR = new Set(["rapor_calistir", "nakit_pozisyonu", "gelir_gider", "butce_karsilastirma", "tahsilat_oncelikleri", "vadesi_gecen_alacaklar"]);

const nesne = (x: unknown): Record<string, unknown> => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
const dizi = (x: unknown): unknown[] => Array.isArray(x) ? x : [];
const metin = (x: unknown, n = 160) => typeof x === "string" ? x.slice(0, n) : "";
const TIPLER = new Set<TabloKolonTipi>(["metin", "sayi", "para", "yuzde", "tarih"]);
const doviz = (x: unknown) => typeof x === "string" && /^[A-Z]{3}$/.test(x) ? x : null;
/** Yalnız panel içi göreli adres; dış bağlantı ya da protokol göreli adres karta girmez. */
const panelAdresi = (x: unknown, yedek: string) => typeof x === "string" && /^\/panel(?:[/?]|$)/.test(x) && !x.startsWith("//") ? x.slice(0, 500) : yedek;

/** Hücre: sayı ya da metin aynen metne çevrilir; sayısal sütunda sayı biçimi dışı değer boş kalır. */
function hucre(deger: unknown, tip: TabloKolonTipi): string | null {
  if (deger === null || deger === undefined) return null;
  if (tip === "metin" || tip === "tarih") {
    if (typeof deger === "string") return deger.slice(0, 120);
    if (typeof deger === "number" || typeof deger === "boolean") return String(deger);
    return null;
  }
  if (typeof deger === "number") return Number.isFinite(deger) ? String(deger) : null;
  if (typeof deger === "string" && /^-?\d+(?:\.\d+)?$/.test(deger.trim())) return deger.trim();
  return null;
}

/** Satırı yalnız kolon alanlarıyla (ve para birimi alanlarıyla) kurar; alan erişimi `a.b` yolunu izler. */
function satirKur(ham: unknown, kolonlar: TabloKolonu[]): Record<string, string | null> {
  const s = nesne(ham);
  const oku = (yol: string) => yol.split(".").reduce<unknown>((o, p) => nesne(o)[p], s);
  const sonuc: Record<string, string | null> = {};
  for (const k of kolonlar) {
    sonuc[k.alan] = hucre(oku(k.alan), k.tip);
    if (k.dovizAlani) sonuc[k.dovizAlani] = doviz(oku(k.dovizAlani));
  }
  return sonuc;
}

/** Sütunun tek para birimi: sabitse o, satırdan geliyorsa hepsi aynıysa o; değilse null (grafik çizilmez). */
function tekParaBirimi(k: TabloKolonu, satirlar: Array<Record<string, string | null>>): string | null | undefined {
  if (k.tip !== "para") return undefined;
  if (k.paraBirimi) return k.paraBirimi;
  if (!k.dovizAlani) return null;
  const birimler = new Set(satirlar.filter(s => s[k.alan] !== null).map(s => s[k.dovizAlani!]));
  return birimler.size === 1 ? [...birimler][0] ?? null : null;
}

/**
 * Grafik yalnız etiket sütunundaki değerler benzersizse (her satır bir kategori ya da dönem)
 * ve seriler tek para biriminde ise çizilir. Tarih etiketi çizgi, diğerleri çubuk.
 */
function grafikKur(kolonlar: TabloKolonu[], satirlar: Array<Record<string, string | null>>, tercih?: { etiket: string; seriler: string[] }): TabloGrafigi | undefined {
  if (satirlar.length < GRAFIK_EN_AZ_SATIR) return undefined;
  const etiket = tercih ? kolonlar.find(k => k.alan === tercih.etiket) : kolonlar.find(k => k.tip === "metin" || k.tip === "tarih");
  if (!etiket) return undefined;
  const etiketler = satirlar.map(s => s[etiket.alan]);
  if (etiketler.some(e => !e) || new Set(etiketler).size !== etiketler.length) return undefined;
  const adaylar = tercih ? tercih.seriler.map(a => kolonlar.find(k => k.alan === a)).filter((k): k is TabloKolonu => !!k) : kolonlar.filter(k => k.tip === "para");
  const birimler = adaylar.map(k => tekParaBirimi(k, satirlar));
  if (!adaylar.length || birimler.some(b => b === null) || new Set(birimler).size > 1) return undefined;
  const seriler = adaylar.slice(0, 2).filter(k => satirlar.some(s => s[k.alan] !== null)).map(k => ({ alan: k.alan, baslik: k.baslik }));
  if (!seriler.length) return undefined;
  return { tur: etiket.tip === "tarih" ? "cizgi" : "cubuk", etiketAlani: etiket.alan, seriler, ...(birimler[0] ? { paraBirimi: birimler[0] } : {}) };
}

function kart(g: { arac: string; baslik: string; adres: string; kolonlar: TabloKolonu[]; ham: unknown[]; satirSayisi?: unknown; uyarilar?: string[]; grafik?: { etiket: string; seriler: string[] } | false; satirDuzelt?: (s: Record<string, unknown>) => Record<string, unknown> }): TabloKarti | null {
  const satirlar = g.ham.slice(0, KART_SATIR_SINIRI).map(x => satirKur(g.satirDuzelt ? g.satirDuzelt(nesne(x)) : x, g.kolonlar));
  if (!satirlar.length) return null;
  const satirSayisi = typeof g.satirSayisi === "number" && Number.isInteger(g.satirSayisi) && g.satirSayisi >= g.ham.length ? g.satirSayisi : g.ham.length;
  const grafik = g.grafik === false ? undefined : grafikKur(g.kolonlar, satirlar, g.grafik);
  return { arac: g.arac, baslik: g.baslik.slice(0, 120), adres: g.adres, kolonlar: g.kolonlar, satirlar, satirSayisi, ...(grafik ? { grafik } : {}), uyarilar: (g.uyarilar ?? []).slice(0, 5) };
}

const TRY = (alan: string, baslik: string): TabloKolonu => ({ alan, baslik, tip: "para", paraBirimi: "TRY" });

/** Başarılı, doğrulanmış (harici olmayan) araç çıktısından kartları çıkarır. */
export function tabloKartlariCikar(arac: string, icerik: string): TabloKarti[] {
  if (!KARTLI_ARACLAR.has(arac)) return [];
  let r: Record<string, unknown>;
  try { r = nesne(JSON.parse(icerik)); } catch { return []; }
  const sonuc: Array<TabloKarti | null> = [];

  if (arac === "rapor_calistir") {
    const kolonlar: TabloKolonu[] = dizi(r.kolonlar).map(nesne).flatMap((c) => {
      const alan = metin(c.alan, 80), tip = c.tip as TabloKolonTipi;
      if (!alan || !TIPLER.has(tip)) return [];
      const dovizAlani = tip === "para" ? metin(c.dovizAlani, 80) : "";
      return [{ alan, baslik: metin(c.baslik, 80) || alan, tip, ...(tip === "para" ? dovizAlani ? { dovizAlani } : { paraBirimi: "TRY" } : {}) }];
    }).slice(0, 12);
    if (!kolonlar.length) return [];
    sonuc.push(kart({ arac, baslik: metin(r.ad) || "Rapor", adres: panelAdresi(r.adres, "/panel/raporlar"), kolonlar, ham: dizi(r.satirlar), satirSayisi: r.satirSayisi }));
  }

  if (arac === "vadesi_gecen_alacaklar") {
    const kolonlar: TabloKolonu[] = [
      { alan: "cariUnvan", baslik: "Cari", tip: "metin" }, { alan: "no", baslik: "Fatura", tip: "metin" },
      { alan: "vadeTarihi", baslik: "Vade", tip: "tarih" }, { alan: "gecikmeGun", baslik: "Gecikme (gün)", tip: "sayi" }, TRY("kalanTry", "Kalan"),
    ];
    const adres = "/panel/cari/vade-hatirlatma";
    sonuc.push(kart({ arac, baslik: "Vadesi geçen alacaklar (en eski)", adres, kolonlar, ham: dizi(r.enEskiAlacaklar), satirSayisi: r.alacakSayisi, grafik: false }));
    sonuc.push(kart({ arac, baslik: "Vadesi geçen borçlar (en eski)", adres, kolonlar, ham: dizi(r.enEskiBorclar), satirSayisi: r.borcSayisi, grafik: false }));
  }

  if (arac === "tahsilat_oncelikleri") {
    sonuc.push(kart({
      arac, baslik: "Tahsilat öncelikleri", adres: panelAdresi(r.ekran, "/panel/cari/vade-hatirlatma"), ham: dizi(r.oncelikler),
      kolonlar: [
        { alan: "cariUnvan", baslik: "Cari", tip: "metin" }, TRY("kalanTry", "Kalan"), { alan: "enEskiGecikmeGun", baslik: "En eski gecikme (gün)", tip: "sayi" },
        { alan: "faturaSayisi", baslik: "Fatura", tip: "sayi" }, { alan: "risk", baslik: "Risk", tip: "metin" }, { alan: "puan", baslik: "Öncelik puanı", tip: "sayi" },
      ],
      grafik: { etiket: "cariUnvan", seriler: ["kalanTry"] },
    }));
  }

  if (arac === "gelir_gider") {
    sonuc.push(kart({
      arac, baslik: "Gider kırılımı", adres: panelAdresi(r.adres, "/panel/raporlar/gelir-gider"), ham: dizi(r.giderKategorileri),
      satirDuzelt: (s) => ({ ...s, kategori: [metin(s.anaKategori, 60), metin(s.altKategori, 60)].filter(Boolean).join(" / ") }),
      kolonlar: [{ alan: "kategori", baslik: "Kategori", tip: "metin" }, TRY("tutar", "Tutar")],
      grafik: { etiket: "kategori", seriler: ["tutar"] },
    }));
  }

  if (arac === "nakit_pozisyonu") {
    const v = nesne(r.veri), adres = panelAdresi(r.adres, "/panel/nakit-akisi");
    const uyarilar = [...(typeof r.not === "string" ? [r.not.slice(0, 200)] : []), ...(dizi(v.kurEksik).length ? ["Kuru olmayan dövizler TL karşılığına girmedi."] : [])];
    const yonlu = (x: unknown[], yon: string) => x.map(k => ({ ...nesne(k), yon }));
    sonuc.push(kart({
      arac, baslik: "Nakit pozisyonu", adres, uyarilar, grafik: false,
      ham: [...yonlu(dizi(v.varliklar), "Varlık"), ...yonlu(dizi(v.borclar), "Borç")],
      kolonlar: [{ alan: "yon", baslik: "Tür", tip: "metin" }, { alan: "ad", baslik: "Hesap", tip: "metin" }, { alan: "tutar", baslik: "Tutar", tip: "para", dovizAlani: "dovizCinsi" }, TRY("tl", "TL karşılığı")],
    }));
    const ufuk = nesne(nesne(v.vadeler)["30"]);
    sonuc.push(kart({
      arac, baslik: "Beklenen giriş ve çıkış (30 gün)", adres, ham: dizi(ufuk.kaynaklar),
      kolonlar: [{ alan: "ad", baslik: "Kaynak", tip: "metin" }, TRY("giris", "Giriş"), TRY("cikis", "Çıkış")],
      grafik: { etiket: "ad", seriler: ["giris", "cikis"] },
    }));
  }

  if (arac === "butce_karsilastirma") {
    const v = nesne(r.veri);
    const yil = typeof v.yil === "number" ? ` ${v.yil}` : "";
    sonuc.push(kart({
      arac, baslik: `Bütçe karşılaştırması${yil}`, adres: panelAdresi(r.adres, "/panel/butce"), ham: dizi(v.satirlar),
      uyarilar: typeof r.not === "string" ? [r.not.slice(0, 200)] : [],
      satirDuzelt: (s) => ({ ...s, kalem: [metin(s.anaKategori, 60), metin(s.altKategori, 60)].filter(Boolean).join(" / "), tur: s.tur === "gelir" ? "Gelir" : s.tur === "gider" ? "Gider" : s.tur }),
      kolonlar: [
        { alan: "tur", baslik: "Tür", tip: "metin" }, { alan: "kalem", baslik: "Kalem", tip: "metin" },
        TRY("toplam.planBugune", "Plan (bugüne)"), TRY("toplam.gerceklesen", "Gerçekleşen"), TRY("toplam.fark", "Fark"),
        { alan: "toplam.oran", baslik: "Gerçekleşme", tip: "yuzde" }, { alan: "toplam.durum", baslik: "Durum", tip: "metin" },
      ],
      grafik: { etiket: "kalem", seriler: ["toplam.planBugune", "toplam.gerceklesen"] },
    }));
  }

  return sonuc.filter((k): k is TabloKarti => !!k);
}

/** Model kart gösterilecek sonuçta tabloyu yeniden yazmasın. */
export const KART_NOTU = "\n\n[Not: Bu sonuç kullanıcıya tablo kartı olarak gösterilir. Tabloyu, satırları ya da satır rakamlarını yanıtta yeniden yazma; kısa bir çerçeve ya da yorumla karta işaret et.]";
