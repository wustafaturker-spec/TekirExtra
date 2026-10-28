/**
 * KSB-25: alış–satış mahsup bildirimi (dikey A4). Karşı tarafa, karşılıklı
 * faturaların hangi tutarlarla birbirine karşı kapatıldığı bildirilir.
 * Onay zorunlu değildir; imza alanı isteğe bağlı teyit içindir.
 */
import type { Prisma } from "@prisma/client";
import { type BelgeTemasi, VARSAYILAN_TEMA, renkNormalize, renkTonu } from "../core/pdf/belge-temasi";
import { type FirmaIletisimi, firmaIletisimSatirlari, kacis, paraBicim, tarihBicim } from "../core/pdf/pdf-sablon";
import { mahsupTarafi } from "../fatura/mahsup";

export interface MahsupBildirimi {
  tarih: Date;
  dovizCinsi: string;
  tutar: Prisma.Decimal;
  aciklama: string | null;
  otomatik: boolean;
  geriAlindiAt: Date | null;
  cari: { kod: string; unvan: string; vknTckn: string | null };
  kapamalar: {
    tutar: Prisma.Decimal;
    kaynakTutari: Prisma.Decimal | null;
    fatura: { no: string | null; tip: string; tarih: Date; vadeTarihi: Date | null; dovizCinsi: string; genelToplam: Prisma.Decimal };
  }[];
}

export interface MahsupFirmasi extends FirmaIletisimi {
  unvan: string;
  vkn: string;
  vergiDairesi?: string | null;
}

const TIP_ADI: Record<string, string> = { satis: "Satış faturası", alis: "Alış faturası", satis_iade: "Satış iadesi", alis_iade: "Alış iadesi" };

function tablo(m: MahsupBildirimi, taraf: "satis" | "alis"): string {
  const satirlar = m.kapamalar.filter((k) => mahsupTarafi(k.fatura.tip) === taraf).map((k) => {
    const capraz = k.fatura.dovizCinsi !== m.dovizCinsi;
    return `<tr><td>${kacis(k.fatura.no ?? "—")}</td><td>${kacis(TIP_ADI[k.fatura.tip] ?? k.fatura.tip)}</td><td>${tarihBicim(k.fatura.tarih)}</td><td>${k.fatura.vadeTarihi ? tarihBicim(k.fatura.vadeTarihi) : "—"}</td><td class="sag">${paraBicim(k.fatura.genelToplam.toFixed(2))} ${kacis(k.fatura.dovizCinsi)}</td><td class="sag"><b>${paraBicim(k.tutar.toFixed(2))} ${kacis(k.fatura.dovizCinsi)}</b>${capraz && k.kaynakTutari ? `<br><small>= ${paraBicim(k.kaynakTutari.toFixed(2))} ${kacis(m.dovizCinsi)}</small>` : ""}</td></tr>`;
  }).join("");
  return `<table class="liste"><thead><tr><th>Belge no</th><th>Tür</th><th>Tarih</th><th>Vade</th><th class="sag">Belge tutarı</th><th class="sag">Mahsup edilen</th></tr></thead><tbody>${satirlar}</tbody></table>`;
}

export function mahsupBildirimiHtml(m: MahsupBildirimi, firma: MahsupFirmasi, tema: BelgeTemasi = VARSAYILAN_TEMA): string {
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
  table.liste { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.liste th { background: ${renkTonu(vurgu, 0.9)}; text-align: left; padding: 3px 5px; font-size: 7.6pt; }
  table.liste td { border-bottom: 1px solid #f1f5f9; padding: 3px 5px; vertical-align: top; }
  .sag { text-align: right; }
  .toplam { margin-top: 10px; padding: 6px 9px; border: 1px solid #e5e7eb; }
  .iptal { margin: 8px 0; padding: 6px 9px; border: 1px solid #b91c1c; color: #b91c1c; }
  .metin { margin-top: 14px; }
  .imza { width: 100%; margin-top: 18px; border-collapse: collapse; page-break-inside: avoid; }
  .imza td { width: 50%; padding: 0 8px; vertical-align: top; }
  .imza div { border-top: 1px solid #9ca3af; padding-top: 4px; min-height: 60px; font-size: 7.6pt; }
  .not { margin-top: 10px; font-size: 7.2pt; color: #6b7280; }
</style></head><body>
<table class="bas"><tr>
  <td class="firma">${tema.logoDataUri ? `<img class="logo" src="${kacis(tema.logoDataUri)}" alt="">` : ""}<strong>${kacis(firma.unvan)}</strong><br>${firmaIletisimSatirlari(firma)}<br>VKN ${kacis(firma.vkn)}${firma.vergiDairesi ? ` · ${kacis(firma.vergiDairesi)} V.D.` : ""}</td>
  <td><h1>Alış–Satış Mahsup Bildirimi</h1><div class="donem">Mahsup tarihi: <b>${tarihBicim(m.tarih)}</b><br>Düzenleme: ${tarihBicim(new Date())}</div></td>
</tr></table>
<div class="cari"><strong>${kacis(m.cari.unvan)}</strong>${m.cari.vknTckn ? ` · VKN/TCKN ${kacis(m.cari.vknTckn)}` : ""} · Cari kodu ${kacis(m.cari.kod)}</div>
${m.geriAlindiAt ? `<div class="iptal">Bu mahsup ${tarihBicim(m.geriAlindiAt)} tarihinde geri alınmıştır; faturalar yeniden açık durumdadır.</div>` : ""}
<p>Sayın Yetkili,<br>Firmanızla aramızdaki karşılıklı alacak ve borçlar, aşağıdaki faturalar üzerinden <b>${paraBicim(m.tutar.toFixed(2))} ${kacis(m.dovizCinsi)}</b> tutarında birbirine karşı mahsup edilmiştir.${m.aciklama ? ` Açıklama: ${kacis(m.aciklama)}.` : ""}</p>
<h2>Kapatılan alacaklarımız <small>bizim satış faturalarımız ve size düzenlediğimiz alış iadeleri</small></h2>
${tablo(m, "satis")}
<h2>Kapatılan borçlarımız <small>sizin bize düzenlediğiniz faturalar ve satış iadelerimiz</small></h2>
${tablo(m, "alis")}
<div class="toplam">Mahsup tutarı: <b>${paraBicim(m.tutar.toFixed(2))} ${kacis(m.dovizCinsi)}</b> — mahsup cari hesap bakiyesini değiştirmez; ilgili faturalar bu tutar kadar kapanmış sayılır.</div>
<p class="metin">Kayıtlarınızda da aynı mahsubun yapılmasını; farklılık varsa bildirmenizi rica ederiz.</p>
<table class="imza"><tr>
  <td><div>${kacis(firma.unvan)}<br>Kaşe / İmza</div></td>
  <td><div>${kacis(m.cari.unvan)}<br>Teyit (isteğe bağlı) · Kaşe / İmza · Tarih</div></td>
</tr></table>
<p class="not">${m.otomatik ? "Bu mahsup, cari hesap ayarı gereği vade sırasıyla otomatik yapılmıştır. " : ""}Farklı dövizli faturalarda mahsup edilen tutarın mahsup dövizindeki karşılığı ayrıca gösterilmiştir.</p>
</body></html>`;
}
