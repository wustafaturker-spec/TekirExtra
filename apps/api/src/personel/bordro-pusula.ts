/**
 * PRS-10 (P1-9): ücret hesap pusulası, İş Kanunu m.37. Ücret ödemesinde
 * işçiye verilen, ücretin hesabını gösteren belge: dönem, gün, kazanç ve
 * kesinti kalemleri, net ve ödenecek tutar; mevzuatla hesaplanan bordroda
 * SGK ve vergi matrahları ile asgari ücret istisnaları. İşveren maliyeti yer almaz.
 */
import { type BelgeTemasi, VARSAYILAN_TEMA, renkNormalize, renkTonu } from "../core/pdf/belge-temasi";
import { type FirmaIletisimi, firmaIletisimSatirlari, kacis, paraBicim, tarihBicim } from "../core/pdf/pdf-sablon";

export interface PusulaFirmasi extends FirmaIletisimi { unvan: string; vkn: string; vergiDairesi?: string | null }

export interface PusulaVerisi {
  donemYil: number;
  donemAy: number;
  durum: string;
  primGunu: number;
  eksikGunNedeni: string | null;
  netMaas: string;
  odenecekTutar: string;
  odenenTutar: string;
  hesapOzeti: Record<string, unknown> | null;
  kalemler: { tip: "kazanc" | "kesinti"; aciklama: string; tutar: string }[];
  personel: { personelNo: string; ad: string; soyad: string; tcknMaskeli: string | null; girisTarihi: Date; unvan: string | null; departman: string | null };
}

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const EKSIK_GUN: Record<string, string> = { istirahat: "İstirahat", ucretsiz_izin: "Ücretsiz izin", disiplin: "Disiplin", gozaltina_alinma: "Gözaltı / tutukluluk", kismi_istihdam: "Kısmi istihdam", puantaj: "Puantaj", diger: "Diğer" };
const ONAYLI = new Set(["onaylandi", "kismen_odendi", "odendi"]);

/** "Davutpaşa" → "Davutpaşa V.D.", "Davutpaşa VD" olduğu gibi (çift ek olmasın). */
export const vergiDairesiAdi = (ad: string) => (/\bV\.?\s?D\.?$/i.test(ad.trim()) ? ad.trim() : `${ad.trim()} V.D.`);

export const donemAdi = (yil: number, ay: number) => `${AYLAR[ay - 1]} ${yil}`;

const toplam = (k: PusulaVerisi["kalemler"], tip: "kazanc" | "kesinti") => k.filter((x) => x.tip === tip).reduce((t, x) => t + Number(x.tutar), 0);

export function bordroPusulaHtml(b: PusulaVerisi, firma: PusulaFirmasi, tema: BelgeTemasi = VARSAYILAN_TEMA): string {
  const vurgu = renkNormalize(tema.vurguRengi);
  const o = b.hesapOzeti;
  const sayi = (k: string) => (o && o[k] !== undefined ? paraBicim(Number(o[k])) : null);
  const satir = (ad: string, deger: string | null) => (deger === null ? "" : `<tr><td>${kacis(ad)}</td><td class="sag">${deger}</td></tr>`);
  const kalemTablosu = (tip: "kazanc" | "kesinti", baslik: string) => {
    const liste = b.kalemler.filter((k) => k.tip === tip);
    return `<table class="liste"><thead><tr><th>${baslik}</th><th class="sag">Tutar (TL)</th></tr></thead><tbody>${liste.map((k) => `<tr><td>${kacis(k.aciklama)}</td><td class="sag">${paraBicim(Number(k.tutar))}</td></tr>`).join("") || `<tr><td colspan="2" class="bos">—</td></tr>`}<tr class="top"><td>Toplam</td><td class="sag">${paraBicim(toplam(b.kalemler, tip))}</td></tr></tbody></table>`;
  };
  const taslak = !ONAYLI.has(b.durum);
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "DejaVu Sans", Arial, sans-serif; font-size: 8.4pt; color: #111827; line-height: 1.45; }
  .bas { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .bas td { vertical-align: top; }
  .firma { font-size: 7.6pt; color: #374151; }
  .firma strong { font-size: 9.5pt; color: #111827; }
  .logo { max-height: 42px; max-width: 170px; display: block; margin-bottom: 5px; }
  h1 { font-size: 14pt; color: ${vurgu}; text-align: right; }
  .donem { text-align: right; margin-top: 4px; }
  .kisi { border-left: 3px solid ${vurgu}; background: ${renkTonu(vurgu, 0.95)}; padding: 6px 9px; margin: 8px 0 10px; }
  .iki { width: 100%; border-collapse: separate; border-spacing: 8px 0; margin: 0 -8px; }
  .iki > tbody > tr > td { width: 50%; vertical-align: top; }
  table.liste, table.ozet { width: 100%; border-collapse: collapse; }
  table.liste th { background: ${renkTonu(vurgu, 0.9)}; text-align: left; padding: 3px 5px; font-size: 7.6pt; }
  table.liste td, table.ozet td { border-bottom: 1px solid #f1f5f9; padding: 3px 5px; }
  tr.top td { font-weight: bold; border-top: 1px solid #9ca3af; }
  .sag { text-align: right; }
  .bos { color: #6b7280; }
  h2 { font-size: 9.5pt; margin: 12px 0 4px; color: ${vurgu}; }
  .net { margin-top: 10px; border: 1px solid ${vurgu}; padding: 6px 9px; font-size: 10pt; }
  .net td { padding: 2px 0; }
  .taslak { color: #b91c1c; font-weight: bold; text-align: right; margin-top: 4px; }
  .imza { width: 100%; margin-top: 18px; border-collapse: collapse; page-break-inside: avoid; }
  .imza td { width: 50%; padding: 0 8px; vertical-align: top; }
  .imza div { border-top: 1px solid #9ca3af; padding-top: 4px; min-height: 50px; font-size: 7.6pt; }
  .not { margin-top: 10px; font-size: 7.2pt; color: #6b7280; }
</style></head><body>
<table class="bas"><tr>
  <td class="firma">${tema.logoDataUri ? `<img class="logo" src="${kacis(tema.logoDataUri)}" alt="">` : ""}<strong>${kacis(firma.unvan)}</strong><br>${firmaIletisimSatirlari(firma)}<br>VKN ${kacis(firma.vkn)}${firma.vergiDairesi ? ` · ${kacis(vergiDairesiAdi(firma.vergiDairesi))}` : ""}</td>
  <td><h1>Ücret Hesap Pusulası</h1><div class="donem">Dönem: <b>${kacis(donemAdi(b.donemYil, b.donemAy))}</b><br>Düzenleme: ${tarihBicim(new Date())}</div>${taslak ? `<div class="taslak">TASLAK — bordro henüz onaylanmadı</div>` : ""}</td>
</tr></table>
<div class="kisi"><strong>${kacis(`${b.personel.ad} ${b.personel.soyad}`)}</strong> · ${kacis(b.personel.personelNo)}${b.personel.tcknMaskeli ? ` · TCKN ${kacis(b.personel.tcknMaskeli)}` : ""}<br>
${[b.personel.departman, b.personel.unvan].filter(Boolean).map((x) => kacis(x!)).join(" · ") || ""}${b.personel.departman || b.personel.unvan ? " · " : ""}İşe giriş ${tarihBicim(b.personel.girisTarihi)} · Prim günü <b>${b.primGunu}</b>${b.eksikGunNedeni ? ` (eksik gün nedeni: ${kacis(EKSIK_GUN[b.eksikGunNedeni] ?? b.eksikGunNedeni)})` : ""}</div>
<table class="iki"><tbody><tr><td>${kalemTablosu("kazanc", "Kazançlar")}</td><td>${kalemTablosu("kesinti", "Kesintiler")}</td></tr></tbody></table>
${o ? `<h2>Matrahlar</h2><table class="ozet"><tbody>
${satir("SGK prime esas kazanç", sayi("primeEsasKazanc"))}
${satir("Gelir vergisi matrahı", sayi("gelirVergisiMatrahi"))}
${satir("Kümülatif gelir vergisi matrahı", sayi("yeniKumulatifMatrah"))}
${satir("Asgari ücret gelir vergisi istisnası", sayi("asgariUcretGelirVergisiIstisnasi"))}
${satir("Asgari ücret damga vergisi istisnası", sayi("asgariUcretDamgaVergisiIstisnasi"))}
${satir("Nakit yemek yardımı SGK istisnası", Number(o.yemekSgkIstisnasi ?? 0) ? sayi("yemekSgkIstisnasi") : null)}
</tbody></table>` : `<p class="not">Ücret net olarak tahakkuk ettirilmiştir; SGK ve vergi kesintisi bu bordroda hesaplanmamıştır.</p>`}
<table class="net"><tbody>
<tr><td>Net ücret</td><td class="sag"><b>${paraBicim(Number(b.netMaas))} TL</b></td></tr>
<tr><td>Ödenecek tutar (avans mahsubu sonrası)</td><td class="sag"><b>${paraBicim(Number(b.odenecekTutar))} TL</b></td></tr>
${Number(b.odenenTutar) > 0 ? `<tr><td>Ödenen</td><td class="sag">${paraBicim(Number(b.odenenTutar))} TL</td></tr>` : ""}
</tbody></table>
<table class="imza"><tr>
  <td><div>${kacis(firma.unvan)}<br>İşveren / yetkili</div></td>
  <td><div>${kacis(`${b.personel.ad} ${b.personel.soyad}`)}<br>Teslim aldım · İmza · Tarih</div></td>
</tr></table>
<p class="not">Bu pusula 4857 sayılı İş Kanunu'nun 37. maddesi uyarınca düzenlenmiştir.</p>
</body></html>`;
}
