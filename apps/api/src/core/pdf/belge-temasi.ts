/**
 * Belge görünüm teması (FTR-22/23): hazır şablon + vurgu rengi + firma logosu.
 *
 * Tek kaynak olmak zorunda: aynı tema hem bizim bastığımız PDF'i hem UBL'e
 * gömülen XSLT görünümünü (EBLG-28/31) çizer, yani alıcının gördüğü belge ile
 * bizim bastığımız belge ayrışmaz.
 *
 * ⚠️ Üretilen CSS yabancı görüntüleyicilerde de çalışır (entegratörün PDF'i
 * wkhtmltopdf'in eski WebKit'idir): **CSS değişkeni, `color-mix`, grid ve
 * flex'e bağlı yerleşim kullanılmaz** — renkler burada hesaplanıp düz hex
 * olarak yazılır, yerleşim `block`/`float`/`table` ile kurulur.
 */

export const BELGE_SABLONLARI = ["standart", "modern", "klasik"] as const;
export type BelgeSablonu = (typeof BELGE_SABLONLARI)[number];

export interface BelgeTemasi {
  sablon: BelgeSablonu;
  /** `#rrggbb`; şablonun vurgu rengi. */
  vurguRengi: string;
  /** KLN-03: firma logosu data URI olarak; yoksa marka yazısı çıkar. */
  logoDataUri?: string;
}

export const VARSAYILAN_VURGU_RENGI = "#6d28d9";
export const VARSAYILAN_TEMA: BelgeTemasi = {
  sablon: "standart",
  vurguRengi: VARSAYILAN_VURGU_RENGI,
};

export const SABLON_ADLARI: Record<BelgeSablonu, string> = {
  standart: "Standart",
  modern: "Modern",
  klasik: "Klasik",
};

const HEX_KALIBI = /^#[0-9a-fA-F]{6}$/;

/** Geçersiz/eksik renk varsayılana düşer: belge hiçbir koşulda renksiz kalmaz. */
export function renkNormalize(deger: unknown): string {
  return typeof deger === "string" && HEX_KALIBI.test(deger.trim())
    ? deger.trim().toLowerCase()
    : VARSAYILAN_VURGU_RENGI;
}

export function sablonNormalize(deger: unknown): BelgeSablonu {
  return BELGE_SABLONLARI.includes(deger as BelgeSablonu) ? (deger as BelgeSablonu) : "standart";
}

const bilesenler = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const hexYaz = (r: number, g: number, b: number): string =>
  "#" + [r, g, b].map((k) => Math.max(0, Math.min(255, Math.round(k))).toString(16).padStart(2, "0")).join("");

/**
 * WCAG bağıl parlaklığı. Vurgu rengi kullanıcıdan geldiği için üzerindeki
 * yazının okunur kalması hesapla güvenceye alınır.
 */
function parlaklik(hex: string): number {
  const kanal = (deger: number) => {
    const oran = deger / 255;
    return oran <= 0.03928 ? oran / 12.92 : ((oran + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = bilesenler(hex);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
}

/** Vurgu renginin üstüne yazılacak metin rengi: açık zeminde koyu, koyuda beyaz. */
export function okunakliMetin(hex: string): string {
  return parlaklik(renkNormalize(hex)) > 0.45 ? "#111827" : "#ffffff";
}

/** Rengi beyaza doğru seyreltir (0 = renk, 1 = beyaz). */
export function renkTonu(hex: string, beyazOrani: number): string {
  const [r, g, b] = bilesenler(renkNormalize(hex));
  const oran = Math.max(0, Math.min(1, beyazOrani));
  return hexYaz(r + (255 - r) * oran, g + (255 - g) * oran, b + (255 - b) * oran);
}

/** Rengi siyaha doğru koyultur (0 = renk, 1 = siyah). */
export function renkKoyult(hex: string, oran: number): string {
  const [r, g, b] = bilesenler(renkNormalize(hex));
  const kalan = 1 - Math.max(0, Math.min(1, oran));
  return hexYaz(r * kalan, g * kalan, b * kalan);
}

/** Şablonların ortak iskeleti; şablona özel blok bunun üstüne biner. */
const ORTAK_STIL = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "DejaVu Sans", Arial, sans-serif;
    font-size: 9.5pt; color: #111827;
  }
  .ust-serit h1 { font-size: 13pt; letter-spacing: 0.5px; }
  .ust-serit .marka { font-size: 9pt; opacity: 0.85; }
  .ust-serit .logo { max-height: 28px; max-width: 120px; }
  .alt-baslik { color: #6b7280; font-size: 8.5pt; margin: 2px 2px 12px; }
  table.veri { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.veri th { text-align: left; padding: 5px 7px; font-size: 8.5pt; }
  table.veri td { padding: 4px 7px; border-bottom: 1px solid #e5e7eb; }
  .sag { text-align: right; }
  .orta { text-align: center; }
  .kutu { border: 1px solid #e5e7eb; border-radius: 4px; padding: 8px 10px; }
  .alt-bilgi {
    position: fixed; bottom: 0; left: 0; right: 0;
    color: #9ca3af; font-size: 7.5pt; display: flex;
    justify-content: space-between;
  }
`;

/**
 * Şablona özel stil. Standart şablonda vurgu rengi **yalnız üst şeritte**
 * kullanılır; böylece varsayılan renkle çıktı, şablon ayarı gelmeden önceki
 * belgelerle birebir aynı kalır.
 */
function sablonStili(sablon: BelgeSablonu, vurgu: string): string {
  const vurguYazi = okunakliMetin(vurgu);
  if (sablon === "modern") {
    return `
  .ust-serit { display: block; padding: 0 0 8px; margin-bottom: 10px; border-bottom: 3px solid ${vurgu}; }
  .ust-serit .logo { display: block; max-height: 40px; max-width: 180px; margin-bottom: 8px; }
  .ust-serit h1 { color: ${vurgu}; font-size: 17pt; letter-spacing: -0.2px; }
  .ust-serit .marka { display: block; color: ${vurgu}; font-size: 10pt; margin-bottom: 4px; }
  table.veri th { background: ${vurgu}; color: ${vurguYazi}; padding: 7px 9px; white-space: nowrap; }
  table.veri td { padding: 7px 9px; border-bottom: 1px solid ${renkTonu(vurgu, 0.82)}; }
  .kutu { border: 0; border-left: 3px solid ${vurgu}; border-radius: 0; background: ${renkTonu(vurgu, 0.94)}; }
`;
  }
  if (sablon === "klasik") {
    return `
  body { font-family: "DejaVu Serif", "Times New Roman", serif; font-size: 9pt; }
  .ust-serit { display: block; padding: 4px 0 5px; margin-bottom: 8px; border-top: 2px solid #111827; border-bottom: 1px solid ${vurgu}; }
  .ust-serit .logo { float: right; max-height: 30px; }
  .ust-serit h1 { font-size: 12pt; letter-spacing: 1.2px; text-transform: uppercase; }
  .ust-serit .marka { font-size: 8pt; color: #6b7280; }
  table.veri th { background: #f3f4f6; color: #111827; border: 1px solid #111827; padding: 3px 6px; }
  table.veri td { border: 1px solid #9ca3af; padding: 2px 6px; }
  .kutu { border: 1px solid #111827; border-radius: 0; padding: 6px 8px; }
`;
  }
  return `
  .ust-serit {
    background: ${vurgu}; color: ${vurguYazi}; padding: 10px 14px;
    border-radius: 4px; margin-bottom: 4px;
    display: flex; justify-content: space-between; align-items: baseline;
  }
  .ust-serit .logo { align-self: center; }
  table.veri th { background: #1e1b4b; color: #fff; }
  table.veri tr:nth-child(even) td { background: #f9fafb; }
`;
}

/** Temanın CSS'i; PDF şablonu da gömülü XSLT görünümü de bunu kullanır. */
export function sayfaStili(tema: BelgeTemasi = VARSAYILAN_TEMA): string {
  const vurgu = renkNormalize(tema.vurguRengi);
  return ORTAK_STIL + sablonStili(sablonNormalize(tema.sablon), vurgu);
}
