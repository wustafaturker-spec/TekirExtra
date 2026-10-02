/**
 * P1-9: kasa/banka hesap ekstresinin PDF görünümü. Cari ekstresiyle aynı
 * düzende yatay A4 basılır; tablo başlığı ve dönem toplamı her sayfada
 * tekrarlanır (thead/tfoot), sayfa numarasını PDF motoru basar. Dövizli
 * hesapta tutarlar hesap dövizindedir, TL karşılığı ayrı sütundadır.
 */
import { type BelgeTemasi, VARSAYILAN_TEMA, okunakliMetin, renkNormalize, renkTonu } from "../core/pdf/belge-temasi";
import { type FirmaIletisimi, firmaIletisimSatirlari, kacis, kurBicim, paraBicim, tarihBicim } from "../core/pdf/pdf-sablon";
import type { KasaBankaService } from "./kasa-banka.service";

export type HesapEkstresiVerisi = Awaited<ReturnType<KasaBankaService["hesapEkstresi"]>>;

export interface HesapEkstresiFirmasi extends FirmaIletisimi {
  unvan: string;
  vkn: string;
  vergiDairesi?: string | null;
}

const birimAdi = (doviz: string) => (doviz === "TRY" ? "TL" : doviz);
const tutar = (deger: string | null) => (deger === null ? "" : paraBicim(deger));
const isaretli = (deger: string, birim: string) => `${Number(deger) < 0 ? "−" : ""}${paraBicim(Math.abs(Number(deger)))} ${birim}`;

function stil(tema: BelgeTemasi): string {
  const vurgu = renkNormalize(tema.vurguRengi);
  const vurguYazi = okunakliMetin(vurgu);
  return `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "DejaVu Sans", Arial, sans-serif; font-size: 7.6pt; color: #111827; }
  .bas { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .bas td { vertical-align: top; }
  .firma { font-size: 7.4pt; color: #374151; line-height: 1.45; }
  .firma strong { font-size: 9.5pt; color: #111827; }
  .logo { max-height: 42px; max-width: 170px; display: block; margin-bottom: 5px; }
  .baslik { text-align: right; }
  .baslik h1 { font-size: 15pt; color: ${vurgu}; letter-spacing: 0.3px; }
  .baslik .donem { margin-top: 6px; font-size: 8pt; line-height: 1.5; }
  .hesap { border-left: 3px solid ${vurgu}; background: ${renkTonu(vurgu, 0.95)}; padding: 6px 9px; margin-bottom: 8px; line-height: 1.5; }
  .hesap strong { font-size: 9pt; }
  .ozet { width: 100%; border-collapse: separate; border-spacing: 5px 0; margin: 0 -5px 8px; }
  .ozet td { border: 1px solid #e5e7eb; border-radius: 4px; padding: 5px 8px; width: 25%; }
  .ozet span { display: block; color: #6b7280; font-size: 6.8pt; text-transform: uppercase; letter-spacing: 0.3px; }
  .ozet b { font-size: 10pt; }
  .ozet small { display: block; color: #6b7280; font-size: 6.6pt; }
  .ozet .son { background: ${vurgu}; color: ${vurguYazi}; border-color: ${vurgu}; }
  .ozet .son span, .ozet .son small { color: ${vurguYazi}; opacity: 0.85; }
  table.ekstre { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.ekstre td { overflow-wrap: anywhere; padding: 3px 4px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  table.ekstre thead th { background: ${vurgu}; color: ${vurguYazi}; font-size: 6.9pt; font-weight: 600; text-align: left; padding: 4px; white-space: nowrap; }
  table.ekstre tfoot td { border-top: 1.5px solid #111827; border-bottom: 0; font-weight: 700; background: #f9fafb; padding: 4px; }
  table.ekstre tr { page-break-inside: avoid; }
  .sag { text-align: right; white-space: nowrap; }
  .nw { white-space: nowrap; }
  .devir td { background: #f3f4f6; font-weight: 700; }
  .acilis td { background: ${renkTonu(vurgu, 0.93)}; font-weight: 600; }
  .ters td { color: #6b7280; }
  .eksi { color: #b91c1c; }
  .kucuk { display: block; color: #6b7280; font-size: 6.6pt; font-weight: 400; }
  .not { color: #6b7280; font-size: 6.8pt; margin-top: 6px; }
`;
}

export function hesapEkstresiPdfHtml(v: HesapEkstresiVerisi, firma: HesapEkstresiFirmasi, tema: BelgeTemasi = VARSAYILAN_TEMA): string {
  const birim = birimAdi(v.hesap.dovizCinsi);
  const dovizli = v.hesap.dovizCinsi !== "TRY";
  const banka = v.hesap.banka;
  const donem = v.baslangic || v.bitis
    ? `${v.baslangic ? tarihBicim(v.baslangic) : "Başlangıç"} – ${v.bitis ? tarihBicim(v.bitis) : tarihBicim(new Date())}`
    : "Tüm hareketler";
  // Sütunlar: Tarih, Makbuz, İşlem, Açıklama, Cari/Belge, Giriş, Çıkış, [Kur, TL karşılığı], Bakiye
  const genislikler = dovizli ? [7, 9, 7, 22, 15, 9, 9, 6, 8, 8] : [7, 9, 8, 28, 17, 10, 10, 11];
  const kolon = genislikler.length;
  const bakiyeHucresi = (b: string) => `<td class="sag${Number(b) < 0 ? " eksi" : ""}">${isaretli(b, birim)}</td>`;

  const devir = v.baslangic
    ? `<tr class="devir"><td class="nw">${tarihBicim(v.baslangic)}</td><td></td><td>Devir</td><td>Dönem başı bakiyesi</td><td></td><td></td><td></td>${dovizli ? `<td></td><td class="sag">${paraBicim(v.devirTry)}</td>` : ""}${bakiyeHucresi(v.devir)}</tr>`
    : "";
  const satirlar = v.satirlar.map((s) => {
    const sinif = s.kaynakTur === "acilis" ? "acilis" : s.kaynakTur === "ters_kayit" ? "ters" : "";
    const ek = [s.kaynak, s.karsiHesap ? `${s.tip === "virman_gelis" ? "Kaynak" : "Hedef"}: ${s.karsiHesap}` : null].filter(Boolean).join(" · ");
    return `<tr${sinif ? ` class="${sinif}"` : ""}>
  <td class="nw">${tarihBicim(s.tarih)}</td>
  <td class="nw">${kacis(s.makbuzNo ?? "")}</td>
  <td>${kacis(s.islem)}</td>
  <td>${kacis(s.aciklama ?? "")}${ek ? `<span class="kucuk">${kacis(ek)}</span>` : ""}</td>
  <td>${kacis(s.cari ?? "")}${s.belge ? `<span class="kucuk">Fatura ${kacis(s.belge)}</span>` : ""}</td>
  <td class="sag">${tutar(s.giris)}</td>
  <td class="sag">${tutar(s.cikis)}</td>
  ${dovizli ? `<td class="sag">${kurBicim(s.kur)}</td><td class="sag">${paraBicim(s.tutarTry)}</td>` : ""}
  ${bakiyeHucresi(s.bakiye)}
</tr>`;
  }).join("");

  const ozet = `<table class="ozet"><tr>
  <td><span>Devir bakiyesi</span><b>${isaretli(v.devir, birim)}</b>${dovizli ? `<small>${paraBicim(v.devirTry)} TL</small>` : ""}</td>
  <td><span>Dönem girişleri</span><b>${paraBicim(v.giris)} ${birim}</b>${dovizli ? `<small>${paraBicim(v.girisTry)} TL</small>` : ""}</td>
  <td><span>Dönem çıkışları</span><b>${paraBicim(v.cikis)} ${birim}</b>${dovizli ? `<small>${paraBicim(v.cikisTry)} TL</small>` : ""}</td>
  <td class="son"><span>Dönem sonu bakiyesi</span><b>${isaretli(v.donemSonu, birim)}</b>${dovizli ? `<small>${paraBicim(v.donemSonuTry)} TL (işlem kurlarıyla)</small>` : ""}</td>
</tr></table>`;

  const hesapBilgisi = banka
    ? `<strong>${kacis(v.hesap.ad)}</strong> · ${kacis(banka.bankaAdi)}${banka.sube ? ` / ${kacis(banka.sube)}` : ""}
      ${banka.iban ? `<br>IBAN: ${kacis(banka.iban)}` : ""}${banka.hesapNo ? ` · Hesap no: ${kacis(banka.hesapNo)}` : ""} · Para birimi: ${birim}`
    : `<strong>${kacis(v.hesap.ad)}</strong> · Nakit kasa · Para birimi: ${birim}`;

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${stil(tema)}</style></head><body>
<table class="bas"><tr>
  <td class="firma" style="width:58%">
    ${tema.logoDataUri ? `<img class="logo" src="${kacis(tema.logoDataUri)}" alt="">` : ""}
    <strong>${kacis(firma.unvan)}</strong>
    <br>VKN: ${kacis(firma.vkn)}${firma.vergiDairesi ? ` · ${kacis(firma.vergiDairesi)} V.D.` : ""}${firmaIletisimSatirlari(firma)}
  </td>
  <td class="baslik">
    <h1>${v.hesap.tur === "kasa" ? "KASA" : "BANKA"} HESAP EKSTRESİ</h1>
    <div class="donem">Dönem: <b>${kacis(donem)}</b><br>Düzenlenme: ${tarihBicim(new Date())}</div>
  </td>
</tr></table>
<div class="hesap">${hesapBilgisi}</div>
${ozet}
<table class="ekstre"><colgroup>${genislikler.map((g) => `<col style="width:${g}%">`).join("")}</colgroup>
  <thead><tr>
    <th>Tarih</th><th>Makbuz no</th><th>İşlem</th><th>Açıklama</th><th>Cari / Belge</th>
    <th class="sag">Giriş (${birim})</th><th class="sag">Çıkış (${birim})</th>
    ${dovizli ? `<th class="sag">Kur</th><th class="sag">TL karşılığı</th>` : ""}
    <th class="sag">Bakiye (${birim})</th>
  </tr></thead>
  <tbody>${devir}${satirlar || `<tr><td colspan="${kolon}" style="text-align:center;color:#6b7280;padding:10px">Dönemde hareket bulunmuyor</td></tr>`}</tbody>
  <tfoot><tr>
    <td colspan="5">Dönem toplamı</td>
    <td class="sag">${paraBicim(v.giris)}</td><td class="sag">${paraBicim(v.cikis)}</td>
    ${dovizli ? `<td></td><td class="sag">${paraBicim(Number(v.girisTry) - Number(v.cikisTry))}</td>` : ""}
    ${bakiyeHucresi(v.donemSonu)}
  </tr></tfoot>
</table>
${dovizli ? `<p class="not">TL karşılıkları her hareketin kayıt kuruyla hesaplanmıştır; dönem sonu değerlemesi içermez (değerleme için Finans › Kur Farkı › Değerleme raporuna bakın).</p>` : ""}
${v.acilis ? "" : `<p class="not">Bu hesabın açılış bakiyesi girilmemiştir; bakiye yalnız sistemdeki hareketlerden hesaplanmıştır.</p>`}
</body></html>`;
}
