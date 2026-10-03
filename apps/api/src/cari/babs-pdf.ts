/**
 * CARI-37: Form BA/BS mutabakat mektubu (dikey A4). Karşı tarafa, dönemde
 * kendi adına bildirilecek belge sayısı ve KDV hariç tutar ile belge listesi
 * gönderilir; imza alanında mutabık olup olmadığını işaretler.
 */
import { type BelgeTemasi, VARSAYILAN_TEMA, renkNormalize, renkTonu } from "../core/pdf/belge-temasi";
import { type FirmaIletisimi, firmaIletisimSatirlari, kacis, paraBicim, tarihBicim } from "../core/pdf/pdf-sablon";
import { BABS_BELGE_ADLARI, type BabsFormu } from "./babs";
import type { CariService } from "./cari.service";

export type BabsMutabakati = Awaited<ReturnType<CariService["babsMutabakati"]>>;

export interface BabsFirmasi extends FirmaIletisimi {
  unvan: string;
  vkn: string;
  vergiDairesi?: string | null;
}

const FORM_ADI: Record<BabsFormu, string> = { ba: "Form BA", bs: "Form BS" };

function formBolumu(m: BabsMutabakati, form: BabsFormu, firma: BabsFirmasi): string {
  const f = m[form];
  // Bizim BA'mız karşı tarafın BS'sidir; metin karşı tarafın gözünden de okunabilsin.
  const aciklama = form === "ba"
    ? `${kacis(firma.unvan)} tarafından sizden yapılan alımlar (sizin Form BS bildiriminize karşılık gelir)`
    : `${kacis(firma.unvan)} tarafından size yapılan satışlar (sizin Form BA bildiriminize karşılık gelir)`;
  const satirlar = f.kalemler.map((k) => `<tr><td>${tarihBicim(k.tarih)}</td><td>${kacis(k.belgeNo ?? "—")}</td><td>${kacis(BABS_BELGE_ADLARI[k.belge])}</td><td class="sag">${paraBicim(k.tutarTry)}</td></tr>`).join("");
  return `<h2>${FORM_ADI[form]} <small>${aciklama}</small></h2>
<table class="ozet"><tr><td>Belge sayısı</td><td class="sag"><b>${f.belgeSayisi}</b></td><td>KDV hariç toplam</td><td class="sag"><b>${paraBicim(f.tutar)} TL</b></td><td>${f.durum === "bildirilir" ? "Eşik aşıldı — bildirilecek" : "Eşik altı — bildirilmez"}</td></tr></table>
${f.kalemler.length ? `<table class="liste"><thead><tr><th>Tarih</th><th>Belge no</th><th>Belge türü</th><th class="sag">KDV hariç (TL)</th></tr></thead><tbody>${satirlar}</tbody></table>` : `<p class="bos">Bu dönemde belge yok.</p>`}`;
}

export function babsMutabakatHtml(m: BabsMutabakati, firma: BabsFirmasi, tema: BelgeTemasi = VARSAYILAN_TEMA): string {
  const vurgu = renkNormalize(tema.vurguRengi);
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
  .cari { border-left: 3px solid ${vurgu}; background: ${renkTonu(vurgu, 0.95)}; padding: 6px 9px; margin: 8px 0 10px; }
  h2 { font-size: 9.5pt; margin: 12px 0 4px; color: ${vurgu}; }
  h2 small { font-size: 7.6pt; color: #6b7280; font-weight: normal; }
  table.ozet, table.liste { width: 100%; border-collapse: collapse; }
  table.ozet td { border: 1px solid #e5e7eb; padding: 4px 6px; }
  table.liste { margin-top: 4px; }
  table.liste th { background: ${renkTonu(vurgu, 0.9)}; text-align: left; padding: 3px 5px; font-size: 7.6pt; }
  table.liste td { border-bottom: 1px solid #f1f5f9; padding: 3px 5px; }
  .sag { text-align: right; }
  .bos { color: #6b7280; margin-top: 4px; }
  .metin { margin-top: 14px; }
  .imza { width: 100%; margin-top: 18px; border-collapse: collapse; page-break-inside: avoid; }
  .imza td { width: 50%; padding: 0 8px; vertical-align: top; }
  .imza div { border-top: 1px solid #9ca3af; padding-top: 4px; min-height: 60px; font-size: 7.6pt; }
  .not { margin-top: 10px; font-size: 7.2pt; color: #6b7280; }
</style></head><body>
<table class="bas"><tr>
  <td class="firma">${tema.logoDataUri ? `<img class="logo" src="${kacis(tema.logoDataUri)}" alt="">` : ""}<strong>${kacis(firma.unvan)}</strong><br>${firmaIletisimSatirlari(firma)}<br>VKN ${kacis(firma.vkn)}${firma.vergiDairesi ? ` · ${kacis(firma.vergiDairesi)} V.D.` : ""}</td>
  <td><h1>Form BA / BS Mutabakatı</h1><div class="donem">Dönem: <b>${kacis(m.donemAdi)}</b><br>Düzenleme: ${tarihBicim(new Date())}</div></td>
</tr></table>
<div class="cari"><strong>${kacis(m.unvan)}</strong>${m.vknTckn ? ` · VKN/TCKN ${kacis(m.vknTckn)}` : ""}${m.cariKodlari.length ? ` · Cari kodu ${kacis(m.cariKodlari.join(", "))}` : ""}</div>
<p>Sayın Yetkili,<br>${kacis(m.donemAdi)} dönemine ait, aynı kişiyle aylık KDV hariç ${paraBicim(m.esik)} TL ve üzeri tutardaki alış ve satışlar için verilecek Form BA ve Form BS bildirimlerine esas kayıtlarımız aşağıdadır.</p>
${formBolumu(m, "ba", firma)}
${formBolumu(m, "bs", firma)}
<p class="metin">Kayıtlarınızla uyumluysa mektubu imzalayıp tarafımıza iletmenizi; fark varsa belge listesini bildirmenizi rica ederiz.</p>
<table class="imza"><tr>
  <td><div>${kacis(firma.unvan)}<br>Kaşe / İmza</div></td>
  <td><div>${kacis(m.unvan)}<br>Mutabıkız / Mutabık değiliz · Kaşe / İmza · Tarih</div></td>
</tr></table>
<p class="not">Tutarlar KDV hariçtir; dövizli belgeler belge tarihindeki kurla TL'ye çevrilmiştir. Bildirim eşiği belge başına değil, aynı kişiyle bir aydaki toplam içindir.</p>
</body></html>`;
}
