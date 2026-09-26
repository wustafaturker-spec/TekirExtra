import { FATURA_SABLONU, IRSALIYE_SABLONU } from "./sablonlar";

/**
 * EBLG-101: firmaya özel entegratör tasarımı. Düzen EMSA e-Belge tasarımıdır
 * (G20 onaylı v3); firmaya ait parçalar — logo, marka, rozetler, ek bilgi, alt
 * satır ve banka tablosu — firma kartından doldurulur. Belgenin kendi verisi
 * (taraflar, kalemler, toplamlar, karekod) XSLT'de UBL'den okunur, burada
 * dokunulmaz.
 */

export interface TasarimBankaHesabi {
  bankaAdi: string;
  sube: string | null;
  swift: string | null;
  iban: string;
  hesapNo: string | null;
  dovizCinsi: string;
}

export interface FirmaTasarimVerisi {
  unvan: string;
  markaAdi?: string | null;
  markaAlt?: string | null;
  ekBilgi?: string | null;
  eposta?: string | null;
  telefon?: string | null;
  webSitesi?: string | null;
  logoDataUri?: string | null;
  rozetler?: string[];
  bankaHesaplari?: TasarimBankaHesabi[];
}

/**
 * Logo XSLT'ye iki kez gömülür (ilk sayfa + devam sayfaları). Bu sınırın
 * üstünde logo konmaz, marka yazısı kalır; EMSA logosu ~38 KB idi.
 */
export const AZAMI_LOGO_BOYU = 150_000;
export const AZAMI_ROZET_BOYU = 80_000;
export const AZAMI_ROZET_SAYISI = 3;

/** Üst şeritteki marka, EMSA'nın 4 harfine göre 18,7 pt; uzun adda küçülür. */
const MARKA_PUNTO = 18.7;
const MARKA_SIGAN_HARF = 12;
const EN_KUCUK_PUNTO = 9;

const kacis = (metin: string) =>
  metin.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const GORSEL = /^data:image\/(png|jpe?g|gif|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/;

function gorselMi(uri: string | null | undefined, sinir: number): uri is string {
  return Boolean(uri && uri.length <= sinir && GORSEL.test(uri));
}

function markaStili(ad: string, punto: number): string {
  const harf = [...ad].length;
  if (harf <= MARKA_SIGAN_HARF) return "";
  const yeni = Math.max(EN_KUCUK_PUNTO, Math.round(((punto * MARKA_SIGAN_HARF) / harf) * 10) / 10);
  return ` style="font-size:${yeni}pt;letter-spacing:.08em"`;
}

const PARA_ADI: Record<string, string> = { TRY: "TL" };
/** EMSA düzeninde TL satırı önce, sonra USD, EUR; diğerleri sonda. */
const PARA_SIRASI = ["TRY", "USD", "EUR"];

function ibanBicimle(iban: string): string {
  return iban.replace(/\s+/g, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Banka tablosu: banka + şube başına bir kutu, içinde para birimi başına bir
 * satır; kutular ikişer yan yana. İngilizce belgede TL satırı gizlenir ve
 * belgenin para birimindeki satır vurgulanır — EMSA düzenindeki kural.
 */
function bankaTablosu(hesaplar: TasarimBankaHesabi[]): string {
  if (!hesaplar.length) return "";
  const gruplar = new Map<string, TasarimBankaHesabi[]>();
  for (const h of hesaplar) {
    const anahtar = `${h.bankaAdi}\u0000${h.sube ?? ""}`;
    gruplar.set(anahtar, [...(gruplar.get(anahtar) ?? []), h]);
  }
  const sira = (d: string) => (PARA_SIRASI.includes(d) ? PARA_SIRASI.indexOf(d) : PARA_SIRASI.length);
  const kutular = [...gruplar.values()].map((grup) => {
    const ilk = grup[0];
    const alt = [ilk.sube ? `${ilk.sube} Şubesi` : "", ...new Set(grup.map((h) => h.swift).filter(Boolean).map((s) => `SWIFT ${s}`))].filter(Boolean).join(" · ");
    const satirlar = [...grup].sort((a, b) => sira(a.dovizCinsi) - sira(b.dovizCinsi)).map((h) => {
      const satir = `<tr><xsl:if test="$dv='${h.dovizCinsi}'"><xsl:attribute name="class">sec</xsl:attribute></xsl:if><td class="pb">${kacis(PARA_ADI[h.dovizCinsi] ?? h.dovizCinsi)}</td><td class="iban">${kacis(ibanBicimle(h.iban))}</td><td class="hn">${kacis(h.hesapNo ?? "")}</td></tr>`;
      return h.dovizCinsi === "TRY" ? `<xsl:if test="not($en)">${satir}</xsl:if>` : satir;
    });
    return `<table class="bnk"><tr class="bb"><td colspan="3"><b>${kacis(ilk.bankaAdi)}</b>${alt ? `<xsl:text>  </xsl:text><span>${kacis(alt)}</span>` : ""}</td></tr>${satirlar.join("")}</table>`;
  });
  const satirlar: string[] = [];
  for (let i = 0; i < kutular.length; i += 2) {
    const sol = `<td style="width:50%;padding-right:1.1mm">${kutular[i]}</td>`;
    const sag = `<td style="width:50%;padding-left:1.1mm">${kutular[i + 1] ?? ""}</td>`;
    satirlar.push(`<table${i ? ' style="margin-top:1.1mm"' : ""}><tr>${sol}${sag}</tr></table>`);
  }
  const baslik = `<table class="bolum"><tr><td><xsl:choose><xsl:when test="$en"><span class="l">BANK ACCOUNTS<i>BANKA HESAPLARI</i></span></xsl:when><xsl:otherwise><span class="l">BANKA HESAPLARI<i>BANK ACCOUNTS</i></span></xsl:otherwise></xsl:choose></td><td class="say"><xsl:choose><xsl:when test="$en">BENEFICIARY · ALICI: </xsl:when><xsl:otherwise>ALICI · BENEFICIARY: </xsl:otherwise></xsl:choose><xsl:call-template name="unvan"><xsl:with-param name="p" select="cac:AccountingSupplierParty/cac:Party"/></xsl:call-template></td></tr></table>`;
  return baslik + satirlar.join("");
}

function rozetler(liste: string[] | undefined): string {
  const gecerli = (liste ?? []).filter((r) => gorselMi(r, AZAMI_ROZET_BOYU)).slice(0, AZAMI_ROZET_SAYISI);
  if (!gecerli.length) return "";
  // EMSA'da tek rozet görseli 15 mm yüksekliğinde sağa yaslıydı; birden çok
  // rozet aynı yükseklikte yan yana dizilir.
  return `<div style="text-align:right">${gecerli.map((r) => `<img alt="" src="${r}" style="height:15mm;max-width:21mm;display:inline-block;margin-left:1.5mm"/>`).join("")}</div>`;
}

export function firmaTasarimiUret(tur: "fatura" | "irsaliye", veri: FirmaTasarimVerisi): string {
  const unvan = veri.unvan.trim();
  const marka = (veri.markaAdi?.trim() || unvan);
  const markaAlt = veri.markaAlt?.trim() ?? "";
  const ekBilgi = veri.ekBilgi?.trim() ?? "";
  const logo = gorselMi(veri.logoDataUri, AZAMI_LOGO_BOYU) ? veri.logoDataUri : null;
  const iletisim = [veri.eposta, veri.telefon, veri.webSitesi].map((d) => d?.trim()).filter(Boolean).join(" · ");
  const degerler: Record<string, string> = {
    YORUM: `TekirExtra firma tasarımı · ${kacis(unvan).replace(/--/g, "–")} · EBLG-101 (G20 onaylı kurumsal düzen v3)`,
    LOGO: logo ? `<img class="logo" alt="${kacis(marka)}" src="${logo}" style="object-fit:contain"/>` : "",
    LOGO_KUCUK: logo ? `<img class="lg" alt="${kacis(marka)}" src="${logo}" style="object-fit:contain"/>` : "",
    MARKA: kacis(marka),
    MARKA_STIL: markaStili(marka, MARKA_PUNTO),
    MARKA2_STIL: markaStili(marka, 11.3),
    MARKA_ALT: kacis(markaAlt),
    ROZETLER: rozetler(veri.rozetler),
    EK_BILGI: kacis(ekBilgi),
    UNVAN: kacis(unvan),
    DIP_EK: ekBilgi ? ` · ${kacis(ekBilgi)}` : "",
    ILETISIM: kacis(iletisim),
    BANKALAR: bankaTablosu((veri.bankaHesaplari ?? []).filter((h) => h.iban?.trim())),
  };
  const sablon = tur === "fatura" ? FATURA_SABLONU : IRSALIYE_SABLONU;
  return sablon.replace(/@@([A-Z0-9_]+)@@/g, (_, ad: string) => {
    if (!(ad in degerler)) throw new Error(`Tasarım şablonunda bilinmeyen yer tutucu: ${ad}`);
    return degerler[ad];
  });
}
