/**
 * FTR-37/38: ticari belgelerin (teklif, sipariş, proforma, irsaliye, makbuz,
 * kâğıt fatura) tek kurumsal düzeni. Cari ekstrenin (CARI-24) tasarım dilini
 * izler: solda logo + firma, sağda başlık ve belge künyesi, vurgu çizgili
 * alıcı bloğu, sabit sütunlu kalem tablosu, toplamlar + yazıyla tutar,
 * koşullar, banka bilgileri ve imza alanları. Dil (FTR-40) ve görünüm
 * ayarları (FTR-42) dışarıdan gelir; belge servisleri yalnız modeli doldurur.
 */
import { type BelgeDili } from "@tekirextra/shared";
import { kacis, firmaIletisimSatirlari, type FirmaIletisimi } from "./pdf-sablon";
import { okunakliMetin, renkTonu } from "./belge-temasi";
import { type BelgeGorunumu, type BelgeMetinleri, type TicariBelgeTuru, VARSAYILAN_GORUNUM, yaziTipiYigini } from "./belge-gorunumu";
import { birimAdi, cevir, etiketVarMi, type EtiketAnahtari } from "./belge-sozlugu";
import { yaziyla } from "./yaziyla";

export interface TicariBelgeFirmasi extends FirmaIletisimi {
  unvan: string;
  vkn: string;
  vergiDairesi?: string | null;
}

export interface TicariBelgeKalemi {
  kod: string;
  /** Türkçe (kart) adı. */
  ad: string;
  /** STK-41: belge dilindeki ad; yoksa Türkçe ad basılır. */
  yabanciAd?: string | null;
  /** Varyant nitelikleri, kart açıklaması gibi küçük satır. */
  aciklama?: string | null;
  /** KDV dışı vergiler gibi ikinci küçük satır (hazır HTML değil, düz metin). */
  ekBilgi?: string | null;
  miktar: string | number;
  birim: string;
  birimFiyat: string | number;
  iskontoOrani: string | number;
  kdvOrani: string | number;
  tutar: string | number;
}

export interface TicariBelgeToplami {
  /** Sözlük anahtarı ya da hazır metin (vergi adları gibi). */
  etiket: EtiketAnahtari | { metin: string };
  /** Etiketin yanına parantez içinde eklenen kısa not (ör. "%20"). */
  ek?: string;
  deger: string | number;
  eksi?: boolean;
}

export interface TicariBelgeModeli {
  tur: TicariBelgeTuru;
  baslik: EtiketAnahtari;
  dil: BelgeDili;
  ciftDil: boolean;
  taslak: boolean;
  kopya?: boolean;
  /** Başlığın altında kırmızı uyarı (ör. revize edilmiş sürüm). */
  uyari?: EtiketAnahtari | null;
  belgeNo: string;
  /** Üst sağdaki künye: Tarih, Geçerlilik, Revizyon… */
  kunye: { etiket: EtiketAnahtari; deger: string; mono?: boolean }[];
  taraf: { etiket: EtiketAnahtari; unvan: string; satirlar: string[] };
  bilgiler: { etiket: EtiketAnahtari; deger: string; mono?: boolean }[];
  doviz: string;
  kalemler: TicariBelgeKalemi[];
  /** Genel toplamdan önceki satırlar (ara toplam, iskonto, KDV…). */
  toplamlar: TicariBelgeToplami[];
  genelToplam: string | number;
  /** Belgenin kendi açıklaması ve kullanıcının koşulları; çevrilmez. */
  notlar: string[];
  bankalar: { bankaAdi: string; sube?: string | null; iban: string; swift?: string | null; doviz: string }[];
  /** İmza alanlarının sözlük anahtarları (ayarda ad yazılmamışsa). */
  imzalar: EtiketAnahtari[];
  /** Belgeye özgü ek blok (taşıma bilgisi gibi), hazır ve kaçışlı HTML. */
  ekBolum?: string;
  /** Kalem tablosunda fiyat ve toplam yok (fiyatsız irsaliye). */
  fiyatsiz?: boolean;
  /** Kalem tablosu yerine özel tablo (makbuz); hücreler düz metindir. */
  ozelTablo?: { sutunlar: { etiket: EtiketAnahtari; say?: boolean; agirlik: number }[]; satirlar: string[][] };
  /** Genel toplam satırının etiketi; yoksa "Genel Toplam". */
  genelEtiket?: EtiketAnahtari;
  /** EBLG-57: dövizli faturada toplamların TL karşılığı; kur 1 döviz = ? TL. */
  dovizKarsiligi?: { kur: string | number; satirlar: TicariBelgeToplami[] };
}

export interface TicariBelgeOrtami {
  firma: TicariBelgeFirmasi;
  gorunum?: BelgeGorunumu;
  logoDataUri?: string;
  kaseDataUri?: string;
}

const YEREL: Record<BelgeDili, string> = { tr: "tr-TR", en: "en-US", de: "de-DE", ar: "en-US", ru: "ru-RU" };
const TARIH_YEREL: Record<BelgeDili, string> = { tr: "tr-TR", en: "en-GB", de: "de-DE", ar: "en-GB", ru: "ru-RU" };

/** Sayı/tarih biçimi: tek dilde o dilin, çift dilde Türkçenin (FTR-40). */
export function bicimleyiciler(dil: BelgeDili, ciftDil: boolean) {
  const yerel = ciftDil ? "tr-TR" : YEREL[dil];
  const PARA = new Intl.NumberFormat(yerel, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const FIYAT = new Intl.NumberFormat(yerel, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const SAYI = new Intl.NumberFormat(yerel, { maximumFractionDigits: 3 });
  const tarihYerel = ciftDil ? "tr-TR" : TARIH_YEREL[dil];
  return {
    para: (v: string | number) => PARA.format(Number(v)),
    fiyat: (v: string | number) => FIYAT.format(Number(v)),
    sayi: (v: string | number) => SAYI.format(Number(v)),
    // Belge tarihleri gün olarak saklanır; saat dilimi kaymasın diye UTC okunur.
    tarih: (v: string | Date) => new Date(typeof v === "string" && v.length === 10 ? `${v}T00:00:00Z` : v)
      .toLocaleDateString(tarihYerel, { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }),
  };
}

/** "Kozyatağı" → "Kozyatağı V.D."; ad zaten "VD"/"V.D." ile bitiyorsa ek yinelenmez. */
export function vergiDairesiMetni(ad: string, ek: string): string {
  return /\bV\.?\s?D\.?$/i.test(ad.trim()) ? ad.trim() : `${ad.trim()} ${ek}`;
}

/** Logo yoksa ünvanın baş harflerinden monogram. */
function monogram(unvan: string): string {
  return unvan.split(/\s+/).filter((k) => /^[\p{L}]/u.test(k)).slice(0, 2).map((k) => k[0]).join("").toLocaleUpperCase("tr-TR");
}

function stil(g: BelgeGorunumu, dil: BelgeDili, ciftDil: boolean): string {
  const ana = g.anaRenk;
  const anaYazi = okunakliMetin(ana);
  const rtl = dil === "ar" && !ciftDil;
  const bas = rtl ? "right" : "left";
  const son = rtl ? "left" : "right";
  const r = g.kose === "yuvarlak" ? 4 : 0;
  const boyut = { kucuk: 7.4, normal: 8, buyuk: 8.8 }[g.yaziBoyutu];
  const logo = { kucuk: 34, orta: 46, buyuk: 62 }[g.logoBoyutu];
  const tabloBaslik = {
    dolu: `background: ${ana}; color: ${anaYazi};`,
    cizgi: `color: ${ana}; border-bottom: 2px solid ${ana};`,
    sade: `color: #6b7280; border-bottom: 1px solid ${g.ikincilRenk}; text-transform: ${rtl ? "none" : "uppercase"}; letter-spacing: ${rtl ? 0 : 0.4}px;`,
  }[g.tabloBaslik];
  const baslikEk = g.tabloBaslik === "dolu" ? renkTonu(ana, 0.65) : "#9ca3af";
  return `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ${yaziTipiYigini(g.yaziTipi, rtl ? "ar" : dil)}; font-size: ${boyut}pt; color: ${g.ikincilRenk}; line-height: 1.4; }
  bdi { unicode-bidi: isolate; }
  .ek { color: #6b7280; font-weight: 400; font-size: 0.86em; }
  .blok { display: block; }
  .kucuk { color: #6b7280; font-size: 0.88em; font-weight: 400; display: block; }
  .mono { font-family: "DejaVu Sans Mono", monospace; letter-spacing: 0.2px; direction: ltr; unicode-bidi: isolate; }
  table { border-collapse: collapse; }
  .bas { width: 100%; }
  .bas td { vertical-align: top; }
  .logo-orta { text-align: center; margin-bottom: 8px; }
  .logo { max-height: ${logo}px; max-width: ${logo * 3.6}px; display: inline-block; margin-bottom: 6px; }
  .monogram { display: inline-block; width: ${logo}px; height: ${logo}px; border-radius: ${r ? 9 : 0}px; background: ${ana}; color: ${anaYazi}; font-weight: 700; font-size: ${Math.round(logo / 3)}pt; text-align: center; line-height: ${logo}px; margin-bottom: 6px; font-family: "DejaVu Sans", sans-serif; }
  .firma { font-size: 0.92em; color: #4b5563; line-height: 1.5; width: 55%; }
  .firma strong { display: block; font-size: 1.2em; color: #111827; margin-bottom: 1px; }
  .baslik { text-align: ${son}; }
  .baslik h1 { font-size: ${ciftDil ? 2.3 : 2.6}em; }
  .baslik h1.uzun { font-size: ${ciftDil ? 1.7 : 1.9}em; }
  .baslik h1 { color: ${ana}; letter-spacing: ${rtl ? 0 : 1.2}px; font-weight: 700; line-height: 1.1; }
  .baslik h1 .ek { display: block; font-size: 0.42em; letter-spacing: ${rtl ? 0 : 2}px; color: #6b7280; margin-top: 2px; }
  .uyari { color: #b91c1c; font-weight: 700; font-size: 0.9em; margin-top: 4px; }
  .kunye { margin-${bas}: auto; margin-top: 8px; font-size: 0.95em; }
  .kunye td { padding: 1.5px 0; }
  .kunye td:first-child { color: #6b7280; padding-${son}: 12px; text-align: ${bas}; }
  .kunye td:last-child { text-align: ${son}; font-weight: 600; white-space: nowrap; }
  .cizgi { height: 3px; background: ${ana}; margin: 10px 0; border-radius: ${r ? 2 : 0}px; }
  .taraf { width: 100%; margin-bottom: 12px; }
  .taraf > tbody > tr > td { vertical-align: top; width: 50%; }
  .kart { padding: 8px 11px; border-radius: ${r}px; }
  .alici { background: ${renkTonu(ana, 0.93)}; border-${bas}: 3px solid ${ana}; }
  .bilgi { border: 1px solid #e5e7eb; margin-${bas}: 10px; }
  .etiket { font-size: 0.82em; text-transform: ${rtl ? "none" : "uppercase"}; letter-spacing: ${rtl ? 0 : 0.6}px; color: ${ana}; font-weight: 700; margin-bottom: 4px; }
  .etiket .ek { color: #9ca3af; text-transform: none; letter-spacing: 0; }
  .alici strong { font-size: 1.18em; color: #111827; display: block; margin-bottom: 2px; }
  .alici div { font-size: 0.95em; color: #374151; }
  .bilgi table { width: 100%; font-size: 0.95em; }
  .bilgi td { padding: 1.5px 0; vertical-align: top; }
  .bilgi td:first-child { color: #6b7280; width: 38%; padding-${son}: 8px; }
  .bilgi td:first-child .ek { display: block; font-size: 0.82em; }
  table.kalem { width: 100%; table-layout: fixed; }
  table.kalem thead { display: table-header-group; }
  table.kalem thead th { ${tabloBaslik} font-size: 0.88em; font-weight: 600; padding: 5px; text-align: ${bas}; vertical-align: bottom; line-height: 1.25; }
  table.kalem thead th .ek { color: ${baslikEk}; font-size: 0.88em; }
  ${g.tabloBaslik === "dolu" ? `table.kalem thead th:first-child { border-radius: ${rtl ? `0 ${r}px 0 0` : `${r}px 0 0 0`}; } table.kalem thead th:last-child { border-radius: ${rtl ? `${r}px 0 0 0` : `0 ${r}px 0 0`}; }` : ""}
  table.kalem td { padding: 5px; border-bottom: 1px solid #e5e7eb; vertical-align: top; overflow-wrap: anywhere; }
  ${g.zebra ? "table.kalem tbody tr:nth-child(even) td { background: #fafafa; }" : ""}
  table.kalem tr { page-break-inside: avoid; }
  .say { text-align: ${son} !important; white-space: nowrap; }
  .say bdi, .say { direction: ltr; }
  .orta { text-align: center !important; color: #9ca3af; }
  .kodh { color: #6b7280; font-size: 0.88em; }
  .alt { width: 100%; margin-top: 10px; page-break-inside: avoid; }
  .alt > tbody > tr > td { vertical-align: top; }
  .yazi { font-size: 0.92em; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: ${r}px; padding: 6px 9px; margin-bottom: 8px; }
  .yazi b { color: #111827; }
  .toplam { width: 100%; }
  .toplam td { padding: 3.5px 9px; }
  .toplam td:last-child { text-align: ${son}; white-space: nowrap; direction: ltr; }
  .toplam tr.ince td { border-bottom: 1px solid #f3f4f6; }
  .toplam tr.genel td { background: ${ana}; color: ${anaYazi}; font-weight: 700; font-size: 1.25em; padding: 7px 9px; }
  .toplam tr.genel td:first-child { border-radius: ${rtl ? `0 ${r}px ${r}px 0` : `${r}px 0 0 ${r}px`}; }
  .toplam tr.genel td:last-child { border-radius: ${rtl ? `${r}px 0 0 ${r}px` : `0 ${r}px ${r}px 0`}; }
  .toplam tr.genel .ek { color: ${anaYazi}; opacity: 0.75; font-size: 0.7em; display: block; }
  .toplam.tl { margin-top: 8px; font-size: 0.9em; color: #4b5563; }
  .yasal { margin-top: 10px; font-size: 0.92em; color: #374151; page-break-inside: avoid; }
  .yasal p { margin-top: 6px; }
  .bolum { margin-top: 12px; page-break-inside: avoid; }
  .bolum h3 { font-size: 0.92em; color: ${ana}; text-transform: ${rtl ? "none" : "uppercase"}; letter-spacing: ${rtl ? 0 : 0.6}px; border-bottom: 1px solid #e5e7eb; padding-bottom: 3px; margin-bottom: 5px; }
  .bolum h3 .ek { color: #9ca3af; text-transform: none; letter-spacing: 0; }
  .bolum ul { padding-${bas}: 13px; font-size: 0.95em; color: #374151; }
  .bolum li { margin-bottom: 1.5px; white-space: pre-line; }
  .bankat { width: 100%; font-size: 0.92em; }
  .bankat th { text-align: ${bas}; color: #6b7280; font-weight: 400; font-size: 0.92em; padding: 2px 6px 2px 0; }
  .bankat td { padding: 2px 6px 2px 0; }
  .kapanis { margin-top: 12px; font-size: 0.98em; color: #374151; white-space: pre-line; page-break-inside: avoid; }
  .imza { width: 100%; margin-top: 8px; page-break-inside: avoid; table-layout: fixed; }
  .imza td { vertical-align: bottom; padding: 0 ${rtl ? "0 0 14px" : "14px 0 0"}; }
  .imza .kase { max-height: 60px; max-width: 150px; display: block; margin-bottom: -6px; }
  .imza .cizgi-alt { border-top: 1px solid #9ca3af; padding-top: 3px; margin-top: 38px; font-size: 0.88em; color: #374151; }
  .imza .kase + .cizgi-alt { margin-top: 0; }
  .imza .cizgi-alt span { display: block; color: #9ca3af; font-size: 0.9em; }
  .filigran { position: fixed; top: 42%; left: 0; right: 0; text-align: center; transform: rotate(-30deg); font-size: 90pt; font-weight: 700; color: rgba(185, 28, 28, 0.08); letter-spacing: 8px; z-index: -1; }
  .kopya { position: fixed; top: 0; left: 50%; margin-left: -45px; width: 90px; text-align: center; border: 2px solid #b91c1c; color: #b91c1c; font-weight: 700; padding: 2px 10px; border-radius: ${r}px; transform: rotate(${rtl ? 6 : -6}deg); letter-spacing: 2px; opacity: 0.8; }
`;
}

/** Ticari belgenin HTML'i ve sayfa altı (PDF motorunun footerTemplate'i). */
export function ticariBelgeHtml(m: TicariBelgeModeli, o: TicariBelgeOrtami): { html: string; altBilgi: string } {
  const g = o.gorunum ?? VARSAYILAN_GORUNUM;
  const cift = m.ciftDil && m.dil !== "tr";
  // Çift dilde ana dil Türkçe, ikincisi seçilen dil; tek dilde yalnız seçilen dil.
  const ana: BelgeDili = cift ? "tr" : m.dil;
  const ikinci: BelgeDili | null = cift ? m.dil : null;
  const rtl = ana === "ar";
  const b = bicimleyiciler(m.dil, cift);
  const L = (t: string) => rtl ? `<bdi dir="ltr">${kacis(t)}</bdi>` : kacis(t);
  const ekMetin = (t: string) => `<span class="ek">${kacis(t)}</span>`;
  /** Etiket: tek dilde düz; çift dilde ikinci dil alt satırda. */
  const E = (k: EtiketAnahtari) => ikinci ? `${kacis(cevir(k, ana))}<br>${ekMetin(cevir(k, ikinci))}` : kacis(cevir(k, ana));
  /** Etiket: çift dilde ikinci dil " / " ile yanda. */
  const Y = (k: EtiketAnahtari) => ikinci ? `${kacis(cevir(k, ana))} ${ekMetin(`/ ${cevir(k, ikinci)}`)}` : kacis(cevir(k, ana));
  const bolumler = g.bolumler[m.tur];
  const metinler: BelgeMetinleri = { ...(g.metinler[m.tur]?.[ana] ?? {}) };
  const ikinciMetinler: BelgeMetinleri = ikinci ? (g.metinler[m.tur]?.[ikinci] ?? {}) : {};
  const sembol = m.doviz === "TRY" ? "TL" : m.doviz;

  // ── Üst kısım
  const logo = o.logoDataUri
    ? `<img class="logo" src="${kacis(o.logoDataUri)}" alt="">`
    : `<span class="monogram">${kacis(monogram(o.firma.unvan))}</span>`;
  const f = o.firma;
  const firmaSatirlari = firmaIletisimSatirlari(f).split("<br>").filter(Boolean);
  const vknSatiri = `${kacis(cevir("vkn", ana))}: ${L(f.vkn)}${f.vergiDairesi ? ` · ${L(vergiDairesiMetni(f.vergiDairesi, cevir("vergiDairesi", ana)))}` : ""}`;
  const firmaBlok = `${g.logoYeri === "sol" ? `${logo}<br>` : ""}<strong>${L(f.unvan)}</strong>${firmaSatirlari.map((s) => (rtl ? `<bdi dir="ltr">${s}</bdi>` : s)).join("<br>")}<br>${vknSatiri}`;
  const baslikHtml = `${kacis(cevir(m.baslik, ana))}${ikinci ? ekMetin(cevir(m.baslik, ikinci)) : ""}`;
  const kunye = [{ etiket: "belgeNo" as EtiketAnahtari, deger: m.belgeNo, mono: true }, ...m.kunye]
    .map((k) => `<tr><td>${Y(k.etiket)}</td><td>${k.mono ? `<span class="mono">${kacis(k.deger)}</span>` : L(k.deger)}</td></tr>`).join("");

  // ── Taraflar
  const taraf = `<div class="kart alici"><div class="etiket">${Y(m.taraf.etiket)}</div><strong>${L(m.taraf.unvan)}</strong>${m.taraf.satirlar.filter(Boolean).map((s) => `<div>${L(s)}</div>`).join("")}</div>`;
  const bilgiler = m.bilgiler.filter((x) => x.deger);
  const bilgi = bilgiler.length
    ? `<div class="kart bilgi"><div class="etiket">${Y("bilgiler")}</div><table>${bilgiler.map((x) => `<tr><td>${E(x.etiket)}</td><td>${x.mono ? `<span class="mono">${kacis(x.deger)}</span>` : L(x.deger)}</td></tr>`).join("")}</table></div>`
    : "";

  // ── Kalemler
  const iskontoVar = m.kalemler.some((k) => Number(k.iskontoOrani) > 0);
  type Sutun = { agirlik: number; baslik: string; sinif?: string; hucre: (k: TicariBelgeKalemi, i: number) => string };
  const birim = (k: TicariBelgeKalemi) => ikinci ? `${kacis(birimAdi(k.birim, ana))} ${ekMetin(`/ ${birimAdi(k.birim, ikinci)}`)}` : kacis(birimAdi(k.birim, ana));
  const urunHucre = (k: TicariBelgeKalemi) => {
    const yabanci = k.yabanciAd?.trim();
    const anaAd = !ikinci && ana !== "tr" && yabanci ? yabanci : k.ad;
    const ikinciAd = ikinci ? (yabanci || null) : null;
    return `<b>${L(anaAd)}</b>${ikinciAd ? `<span class="ek blok">${L(ikinciAd)}</span>` : ""}${k.aciklama ? `<span class="kucuk">${L(k.aciklama)}</span>` : ""}${k.ekBilgi ? `<span class="kucuk">${L(k.ekBilgi)}</span>` : ""}`;
  };
  const sutunlar: Sutun[] = [
    { agirlik: 4, baslik: kacis(cevir("sira", ana)), sinif: "orta", hucre: (_k, i) => String(i + 1) },
    ...(bolumler.kodSutunu ? [{ agirlik: 11, baslik: E("kod"), sinif: "kodh", hucre: (k: TicariBelgeKalemi) => L(k.kod) }] : []),
    { agirlik: 0, baslik: E("urun"), hucre: urunHucre },
    { agirlik: ikinci ? 13 : 11, baslik: E("miktar"), sinif: "say", hucre: (k) => `${b.sayi(k.miktar)} ${birim(k)}` },
    ...(m.fiyatsiz ? [] : [
      { agirlik: 12, baslik: E("birimFiyat"), sinif: "say", hucre: (k: TicariBelgeKalemi) => b.fiyat(k.birimFiyat) },
      ...(iskontoVar ? [{ agirlik: 7, baslik: E("isk"), sinif: "say", hucre: (k: TicariBelgeKalemi) => Number(k.iskontoOrani) > 0 ? `%${b.sayi(k.iskontoOrani)}` : "—" }] : []),
      { agirlik: 7, baslik: E("kdv"), sinif: "say", hucre: (k: TicariBelgeKalemi) => `%${b.sayi(k.kdvOrani)}` },
      { agirlik: 14, baslik: E("tutar"), sinif: "say", hucre: (k: TicariBelgeKalemi) => `<b>${b.para(k.tutar)}</b>` },
    ]),
  ];
  const urunPayi = 100 - sutunlar.reduce((t, s) => t + s.agirlik, 0);
  const ot = m.ozelTablo;
  const colgroup = ot
    ? ot.sutunlar.map((s) => `<col style="width:${s.agirlik}%">`).join("")
    : sutunlar.map((s) => `<col style="width:${s.agirlik || urunPayi}%">`).join("");
  const thead = ot
    ? ot.sutunlar.map((s) => `<th${s.say ? ' class="say"' : ""}>${E(s.etiket)}</th>`).join("")
    : sutunlar.map((s) => `<th${s.sinif === "say" ? ' class="say"' : s.sinif === "orta" ? ' class="orta"' : ""}>${s.baslik}</th>`).join("");
  const tbody = ot
    ? ot.satirlar.map((satir) => `<tr>${satir.map((h, i) => `<td${ot.sutunlar[i]?.say ? ' class="say"' : ""}>${L(h)}</td>`).join("")}</tr>`).join("")
    : m.kalemler.map((k, i) => `<tr>${sutunlar.map((s) => `<td${s.sinif ? ` class="${s.sinif}"` : ""}>${s.hucre(k, i)}</td>`).join("")}</tr>`).join("");

  // ── Toplamlar, yazıyla, koşullar
  const toplamEtiketi = (t: TicariBelgeToplami) => {
    const metin = typeof t.etiket === "string" ? Y(t.etiket) : kacis(t.etiket.metin);
    return t.ek ? `${metin} <span class="ek">(${kacis(t.ek)})</span>` : metin;
  };
  const toplamlar = m.fiyatsiz ? "" : `<table class="toplam">
    ${m.toplamlar.map((t) => `<tr class="ince"><td>${toplamEtiketi(t)}</td><td>${t.eksi ? "-" : ""}${b.para(t.deger)} ${kacis(sembol)}</td></tr>`).join("")}
    <tr><td colspan="2" style="padding:3px 0"></td></tr>
    <tr class="genel"><td>${E(m.genelEtiket ?? "genelToplam")}</td><td>${b.para(m.genelToplam)} ${kacis(sembol)}</td></tr>
  </table>${m.dovizKarsiligi ? `<table class="toplam tl">
    <tr class="ince"><td>${Y("dovizKuru")} <span class="ek">(1 ${kacis(m.doviz)})</span></td><td>${b.fiyat(m.dovizKarsiligi.kur)} TL</td></tr>
    ${m.dovizKarsiligi.satirlar.map((t) => `<tr class="ince"><td>${toplamEtiketi(t)} <span class="ek">(${kacis(cevir("tlKarsiligi", ana))})</span></td><td>${t.eksi ? "-" : ""}${b.para(t.deger)} TL</td></tr>`).join("")}
  </table>` : ""}`;
  const yaziMetni = !m.fiyatsiz && bolumler.yaziyla
    ? `<div class="yazi"><b>${kacis(cevir("yalniz", ana))}:</b> ${kacis(yaziyla(m.genelToplam, ana, m.doviz))}${ikinci ? `<br><span class="ek"><b>${kacis(cevir("yalniz", ikinci))}:</b> ${kacis(yaziyla(m.genelToplam, ikinci, m.doviz))}</span>` : ""}</div>`
    : "";
  const ayarKosullari = [metinler.kosullar, ikinciMetinler.kosullar]
    .flatMap((k) => (k ?? "").split("\n")).map((s) => s.trim()).filter(Boolean);
  const notlar = [...m.notlar.map((n) => n.trim()).filter(Boolean), ...ayarKosullari];
  const kosulBolumu = notlar.length
    ? `<div class="bolum" style="margin-top:0"><h3>${Y("kosullar")}</h3><ul>${notlar.map((n) => `<li>${L(n)}</li>`).join("")}</ul></div>`
    : "";
  const solAlt = `${yaziMetni}${kosulBolumu}`;
  const altBlok = solAlt || toplamlar
    ? `<table class="alt"><tr><td style="width:56%;padding-${rtl ? "left" : "right"}:16px">${solAlt}</td><td>${toplamlar}</td></tr></table>`
    : "";

  // ── Banka
  const bankaBolumu = bolumler.banka && m.bankalar.length
    ? `<div class="bolum"><h3>${Y("banka")}</h3><table class="bankat">
        <tr><th style="width:34%">${Y("bankaAd")}</th><th style="width:40%">IBAN</th><th style="width:14%">SWIFT</th><th>${Y("doviz")}</th></tr>
        ${m.bankalar.map((x) => `<tr><td>${L([x.bankaAdi, x.sube].filter(Boolean).join(" · "))}</td><td><span class="mono">${kacis(x.iban)}</span></td><td><span class="mono">${kacis(x.swift || "—")}</span></td><td>${kacis(x.doviz === "TRY" ? "TL" : x.doviz)}</td></tr>`).join("")}
      </table><span class="kucuk" style="margin-top:3px">${Y("hesapSahibi")}: ${L(f.unvan)}</span></div>`
    : "";

  // ── Kapanış ve imzalar
  const kapanisAnahtari = `kapanis.${m.tur}`;
  const kapanisMetni = (dil: BelgeDili, ayar?: string) =>
    ayar !== undefined ? ayar.trim() : (etiketVarMi(kapanisAnahtari) ? cevir(kapanisAnahtari, dil) : "");
  const kapanisAna = kapanisMetni(ana, metinler.kapanis);
  const kapanisIkinci = ikinci ? kapanisMetni(ikinci, ikinciMetinler.kapanis) : "";
  const kapanis = kapanisAna || kapanisIkinci
    ? `<div class="kapanis">${L(kapanisAna)}${kapanisIkinci ? `<br>${ekMetin(kapanisIkinci)}` : ""}${bolumler.imza ? `<br><br>${kacis(cevir("saygi", ana))}${ikinci ? ` ${ekMetin(cevir("saygi", ikinci))}` : ""}` : ""}</div>`
    : "";
  const ozelImzalar = (metinler.imzalar ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const imzaBasliklari = ozelImzalar.length ? ozelImzalar.map((s) => L(s)) : m.imzalar.map((k) => Y(k));
  const imzalar = bolumler.imza && imzaBasliklari.length
    ? `<table class="imza"><tr>${imzaBasliklari.map((baslik, i) => {
        const kaseBurada = bolumler.kase && o.kaseDataUri && (ozelImzalar.length ? i === 0 : m.imzalar[i] === "imza.kase" || (i === 0 && !m.imzalar.includes("imza.kase")));
        return `<td>${kaseBurada ? `<img class="kase" src="${kacis(o.kaseDataUri!)}" alt="">` : ""}<div class="cizgi-alt">${baslik}<span>${kacis(cevir("adImzaTarih", ana))}${ikinci ? ` / ${kacis(cevir("adImzaTarih", ikinci))}` : ""}</span></div></td>`;
      }).join("")}</tr></table>`
    : "";

  const filigran = m.taslak && g.taslakFiligrani ? `<div class="filigran">${kacis(cevir("taslak", ana))}</div>` : "";
  const kopya = m.kopya ? `<div class="kopya">${kacis(cevir("kopya", ana))}</div>` : "";
  const uyari = m.uyari ? `<div class="uyari">${kacis(cevir(m.uyari, ana))}</div>` : "";

  const html = `<!doctype html>
<html lang="${ana}" dir="${rtl ? "rtl" : "ltr"}">
<head><meta charset="utf-8"><style>${stil(g, ana, cift)}</style></head>
<body>
${filigran}${kopya}
${g.logoYeri === "orta" ? `<div class="logo-orta">${logo}</div>` : ""}
<table class="bas"><tr>
  <td class="firma">${firmaBlok}</td>
  <td class="baslik"><h1${cevir(m.baslik, ana).length > 16 ? ' class="uzun"' : ""}>${baslikHtml}</h1>${uyari}<table class="kunye">${kunye}</table></td>
</tr></table>
<div class="cizgi"></div>
<table class="taraf"><tr><td>${taraf}</td><td>${bilgi}</td></tr></table>
<table class="kalem"><colgroup>${colgroup}</colgroup><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
${altBlok}
${m.ekBolum ?? ""}
${bankaBolumu}
${kapanis}
${imzalar}
</body></html>`;

  const altNot = [metinler.altNot, ikinciMetinler.altNot].map((s) => s?.trim()).filter(Boolean).join(" · ");
  const sayfa = ikinci ? `${cevir("sayfa", ana)} / ${cevir("sayfa", ikinci)}` : cevir("sayfa", ana);
  const altBilgi = `<div style="width:100%;font-size:6.5pt;color:#9ca3af;padding:0 12mm;font-family:${yaziTipiYigini(g.yaziTipi, ana).replace(/"/g, "'")};${rtl ? "direction:rtl;" : ""}">
  ${altNot ? `<div style="text-align:center;margin-bottom:2px">${kacis(altNot)}</div>` : ""}
  <div style="display:flex;justify-content:space-between"><span><bdi>${kacis(f.unvan)}${f.webSitesi ? ` · ${kacis(f.webSitesi)}` : ""}</bdi></span><span><bdi>${kacis(m.belgeNo)}</bdi> · ${kacis(sayfa)} <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>
</div>`;
  return { html, altBilgi };
}

