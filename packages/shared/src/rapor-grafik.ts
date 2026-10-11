/**
 * RPR-26: rapor grafikleri. Veri hazırlama ve SVG üretimi tek yerde; ekran
 * (web) ve PDF (api) aynı çizimi kullanır. Kütüphane yok: sütun, çizgi ve
 * yatay çubuk elle çizilir. Kurallar: tek eksen, sıfırdan başlayan taban,
 * ≤24px çubuk, 4px yuvarlak uç, 2px çizgi, saç teli ızgara; ≥2 seride
 * lejant; renkler sabit sırayla (seri 1, 2, 3), metin hiçbir zaman seri
 * renginde değil. Karşılaştırma serisi aynı rengin soluk hâlidir.
 */

export type GrafikTuru = "sutun" | "cizgi" | "yatay";

export interface GrafikTanimi {
  tur: GrafikTuru;
  /** Kategori sütunu (ay, cari…). Boşsa seriler kategoridir (yaşlandırma kovaları gibi). */
  kategori?: string;
  /** Çizilecek sayısal sütunlar; kategorili grafikte en çok 3. */
  seriler: string[];
  /** Yatay çubukta en büyük N kategori, kalanı "Diğer". */
  enCok?: number;
}

interface Kolon { alan: string; baslik: string; tip: string; dovizAlani?: string }
type Satir = Record<string, string | number | boolean | null | undefined>;

export interface GrafikSerisi { ad: string; renk: number; soluk?: boolean; degerler: number[] }
export interface GrafikVerisi {
  tur: GrafikTuru;
  kategoriler: string[];
  seriler: GrafikSerisi[];
  /** Para birimi etiketi (TL, USD…); sayı sütununda boş. */
  birim: string;
}

export const ONCEKI_EKI = "__onceki";

/**
 * Satırlardan grafik verisi. Çizilemiyorsa (veri yok, seri yok, dövizler
 * karışık) gerekçe döner; ekran bunu grafiğin yerine yazar.
 */
export function grafikVerisi(t: GrafikTanimi, kolonlar: Kolon[], satirlar: Satir[]): { veri: GrafikVerisi } | { neden: string } {
  // Kategorili grafikte en çok üç seri; kategorisizde seriler çubuktur (yaşlandırma kovaları), sınır yok.
  const tumSeriler = t.seriler.map((a) => kolonlar.find((k) => k.alan === a)).filter((k): k is Kolon => Boolean(k));
  const seriKolonlari = t.kategori ? tumSeriler.slice(0, 3) : tumSeriler;
  if (!seriKolonlari.length || !satirlar.length) return { neden: "Grafik için veri yok." };
  const dovizler = new Set<string>();
  for (const k of seriKolonlari) if (k.dovizAlani) for (const s of satirlar) dovizler.add(String(s[k.dovizAlani] ?? "TRY"));
  if (dovizler.size > 1) return { neden: "Farklı para birimleri tek grafikte toplanmaz; döviz ya da hesap süzgeci seçin." };
  const doviz = [...dovizler][0] ?? "TRY";
  const birim = seriKolonlari.every((k) => k.tip === "para") ? (doviz === "TRY" ? "TL" : doviz) : "";
  const sayi = (v: unknown) => Number(v ?? 0) || 0;

  // Seriler kategoriyse (yaşlandırma): her sütunun toplamı bir çubuk.
  if (!t.kategori) {
    const deger = (alan: string) => satirlar.reduce((a, s) => a + sayi(s[alan]), 0);
    const seriler: GrafikSerisi[] = [{ ad: "Bu dönem", renk: 1, degerler: seriKolonlari.map((k) => deger(k.alan)) }];
    if (kolonlar.some((k) => k.alan === `${seriKolonlari[0].alan}${ONCEKI_EKI}`)) {
      seriler.push({ ad: "Önceki dönem", renk: 1, soluk: true, degerler: seriKolonlari.map((k) => deger(`${k.alan}${ONCEKI_EKI}`)) });
    }
    return { veri: { tur: t.tur, kategoriler: seriKolonlari.map((k) => k.baslik), seriler, birim } };
  }

  // Kategoriye göre topla (ilk görülme sırası korunur — ay sırası rapordan gelir).
  const sira: string[] = [];
  const toplam = new Map<string, Map<string, number>>();
  const oncekiVar = seriKolonlari.map((k) => kolonlar.some((x) => x.alan === `${k.alan}${ONCEKI_EKI}`));
  const alanlar = seriKolonlari.flatMap((k, i) => (oncekiVar[i] ? [k.alan, `${k.alan}${ONCEKI_EKI}`] : [k.alan]));
  for (const s of satirlar) {
    const kat = String(s[t.kategori] ?? "—") || "—";
    if (!toplam.has(kat)) { toplam.set(kat, new Map()); sira.push(kat); }
    const m = toplam.get(kat)!;
    for (const a of alanlar) m.set(a, (m.get(a) ?? 0) + sayi(s[a]));
  }
  let kategoriler = sira;
  if (t.tur === "yatay") {
    const ana = seriKolonlari[0].alan;
    kategoriler = [...sira].sort((a, b) => (toplam.get(b)!.get(ana) ?? 0) - (toplam.get(a)!.get(ana) ?? 0));
    const n = t.enCok ?? 10;
    if (kategoriler.length > n + 1) {
      const kalan = kategoriler.slice(n);
      const diger = new Map<string, number>();
      for (const k of kalan) for (const [a, v] of toplam.get(k)!) diger.set(a, (diger.get(a) ?? 0) + v);
      const ad = `Diğer (${kalan.length})`;
      toplam.set(ad, diger);
      kategoriler = [...kategoriler.slice(0, n), ad];
    }
  }
  const seriler: GrafikSerisi[] = seriKolonlari.flatMap((k, i) => [
    { ad: k.baslik, renk: i + 1, degerler: kategoriler.map((c) => toplam.get(c)!.get(k.alan) ?? 0) },
    ...(oncekiVar[i] ? [{ ad: `${k.baslik} (önceki)`, renk: i + 1, soluk: true, degerler: kategoriler.map((c) => toplam.get(c)!.get(`${k.alan}${ONCEKI_EKI}`) ?? 0) }] : []),
  ]);
  // Tek noktalı çizgi okunmaz; sütuna düşer.
  return { veri: { tur: t.tur === "cizgi" && kategoriler.length < 2 ? "sutun" : t.tur, kategoriler, seriler, birim } };
}

/** Eksen için "temiz" üst sınır ve adım (0, 2,5 Mn, 5 Mn…). */
export function eksenOlcegi(min: number, max: number): { alt: number; ust: number; adim: number } {
  const hi = Math.max(max, 0), lo = Math.min(min, 0);
  const aralik = hi - lo || 1;
  const kaba = aralik / 4;
  const us = 10 ** Math.floor(Math.log10(kaba));
  const adim = [1, 2, 2.5, 5, 10].map((c) => c * us).find((a) => a >= kaba) ?? 10 * us;
  return { alt: Math.floor(lo / adim) * adim, ust: Math.ceil(hi / adim) * adim || adim, adim };
}

const KISA = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const TAM = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const kisaSayi = (n: number) => KISA.format(n);
const kacis = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kisalt = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

export interface SvgSecenekleri {
  /** Seri renkleri (1., 2., 3.); web'de CSS değişkeni, PDF'te hex. */
  renkler: [string, string, string];
  metin: string;
  soluk: string;
  izgara: string;
  zemin: string;
  genislik?: number;
  baslik?: string;
}

/**
 * Grafik SVG'si (lejant dahil). Her işaret `<title>` taşır: ekranda üzerine
 * gelince değer görünür, ekran okuyucu da okur. Genişlik viewBox'la ölçeklenir.
 */
export function grafikSvg(v: GrafikVerisi, o: SvgSecenekleri): string {
  const G = o.genislik ?? 760;
  const renk = (s: GrafikSerisi) => o.renkler[(s.renk - 1) % 3];
  const deger = (n: number) => `${TAM.format(n)}${v.birim ? ` ${v.birim}` : ""}`;
  const lejant = v.seriler.length > 1
    ? `<g class="grafik-lejant" font-size="12" fill="${o.metin}">${v.seriler.map((s, i) => `<g transform="translate(${i * 180},0)"><rect width="12" height="12" rx="3" fill="${renk(s)}"${s.soluk ? ' fill-opacity="0.4"' : ""}/><text x="18" y="10">${kacis(kisalt(s.ad, 24))}</text></g>`).join("")}</g>`
    : "";
  const lejantH = lejant ? 28 : 0;

  if (v.tur === "yatay") {
    const satirH = v.seriler.length > 1 ? 34 : 26;
    // ~6,5 px/karakter: 24 karakterlik etiket 200 px içine sığar.
    const etiketG = 200, sagBosluk = 90;
    const H = lejantH + v.kategoriler.length * satirH + 8;
    const tumu = v.seriler.flatMap((s) => s.degerler);
    const { alt, ust } = eksenOlcegi(Math.min(...tumu), Math.max(...tumu));
    const x = (n: number) => etiketG + ((n - alt) / (ust - alt)) * (G - etiketG - sagBosluk);
    const kalinlik = Math.min(24, (satirH - 8) / v.seriler.length);
    const govde = v.kategoriler.map((k, ci) => {
      const y0 = lejantH + ci * satirH + 4;
      const cubuklar = v.seriler.map((s, si) => {
        const d = s.degerler[ci], x0 = x(0), x1 = x(d), y = y0 + si * (kalinlik + 2);
        const w = Math.abs(x1 - x0), sol = Math.min(x0, x1), r = Math.min(4, w / 2);
        const yol = d >= 0
          ? `M${sol},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${kalinlik - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`
          : `M${sol + w},${y}h-${w - r}a${r},${r} 0 0 0 -${r},${r}v${kalinlik - 2 * r}a${r},${r} 0 0 0 ${r},${r}h${w - r}z`;
        return `<path d="${yol}" fill="${renk(s)}"${s.soluk ? ' fill-opacity="0.4"' : ""}><title>${kacis(`${k} · ${s.ad}: ${deger(d)}`)}</title></path>`;
      }).join("");
      const ana = v.seriler[0].degerler[ci];
      return `<text x="${etiketG - 8}" y="${y0 + kalinlik - 4}" text-anchor="end" font-size="12" fill="${o.metin}">${kacis(kisalt(k, 24))}<title>${kacis(k)}</title></text>${cubuklar}<text x="${Math.max(x(ana), x(0)) + 6}" y="${y0 + kalinlik - 4}" font-size="11" fill="${o.soluk}">${kacis(kisaSayi(ana))}</text>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G} ${H}" width="100%" role="img" aria-label="${kacis(o.baslik ?? "Grafik")}" font-family="inherit">${lejant}<line x1="${x(0)}" x2="${x(0)}" y1="${lejantH}" y2="${H - 4}" stroke="${o.izgara}"/>${govde}</svg>`;
  }

  // Sütun ve çizgi: tek y ekseni, sıfır tabanlı.
  const H = 260 + lejantH, sol = 64, alt = 34, ust = lejantH + 10, sag = 12;
  const tumu = v.seriler.flatMap((s) => s.degerler);
  const o2 = eksenOlcegi(Math.min(...tumu), Math.max(...tumu));
  const y = (n: number) => ust + ((o2.ust - n) / (o2.ust - o2.alt)) * (H - ust - alt);
  const bant = (G - sol - sag) / v.kategoriler.length;
  const xMerkez = (i: number) => sol + bant * i + bant / 2;
  const izgara: string[] = [];
  for (let d = o2.alt; d <= o2.ust + o2.adim / 2; d += o2.adim) {
    izgara.push(`<line x1="${sol}" x2="${G - sag}" y1="${y(d)}" y2="${y(d)}" stroke="${o.izgara}"/><text x="${sol - 8}" y="${y(d) + 4}" text-anchor="end" font-size="11" fill="${o.soluk}">${kacis(kisaSayi(d))}</text>`);
  }
  const etiketAdimi = Math.ceil(v.kategoriler.length / 12);
  const xEtiket = v.kategoriler.map((k, i) => (i % etiketAdimi ? "" : `<text x="${xMerkez(i)}" y="${H - alt + 18}" text-anchor="middle" font-size="11" fill="${o.soluk}">${kacis(kisalt(k, 12))}</text>`)).join("");

  let isaretler = "";
  if (v.tur === "sutun") {
    const n = v.seriler.length, kalinlik = Math.min(24, (bant * 0.7 - (n - 1) * 2) / n);
    isaretler = v.kategoriler.map((k, ci) => v.seriler.map((s, si) => {
      const d = s.degerler[ci], x0 = xMerkez(ci) - (n * kalinlik + (n - 1) * 2) / 2 + si * (kalinlik + 2);
      const y0 = y(0), y1 = y(d), h = Math.abs(y1 - y0), r = Math.min(4, h / 2, kalinlik / 2);
      const yol = d >= 0
        ? `M${x0},${y0}v-${h - r}a${r},${r} 0 0 1 ${r},-${r}h${kalinlik - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`
        : `M${x0},${y0}v${h - r}a${r},${r} 0 0 0 ${r},${r}h${kalinlik - 2 * r}a${r},${r} 0 0 0 ${r},-${r}v-${h - r}z`;
      return `<path d="${yol}" fill="${renk(s)}"${s.soluk ? ' fill-opacity="0.4"' : ""}><title>${kacis(`${k} · ${s.ad}: ${deger(d)}`)}</title></path>`;
    }).join("")).join("");
  } else {
    isaretler = v.seriler.map((s) => {
      const noktalar = s.degerler.map((d, i) => `${xMerkez(i)},${y(d)}`).join(" ");
      const op = s.soluk ? ' stroke-opacity="0.45"' : "";
      const daireler = s.degerler.map((d, i) => `<circle cx="${xMerkez(i)}" cy="${y(d)}" r="4" fill="${renk(s)}" stroke="${o.zemin}" stroke-width="2"${s.soluk ? ' fill-opacity="0.45"' : ""}><title>${kacis(`${v.kategoriler[i]} · ${s.ad}: ${deger(d)}`)}</title></circle>`).join("");
      return `<polyline points="${noktalar}" fill="none" stroke="${renk(s)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${op}/>${daireler}`;
    }).join("");
  }
  const sifir = o2.alt < 0 ? `<line x1="${sol}" x2="${G - sag}" y1="${y(0)}" y2="${y(0)}" stroke="${o.soluk}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G} ${H}" width="100%" role="img" aria-label="${kacis(o.baslik ?? "Grafik")}" font-family="inherit">${lejant}${izgara.join("")}${sifir}${isaretler}${xEtiket}</svg>`;
}
