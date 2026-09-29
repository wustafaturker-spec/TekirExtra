/**
 * CARI-24/25/26: cari ekstresinin PDF görünümü. Bütün türler yatay A4
 * basılır. Tablo başlığı ve dönem toplamı her
 * sayfada tekrarlanır (thead/tfoot); sayfa numarasını PDF motoru basar.
 * Yalnız kendi Chromium motorumuzla basıldığı için tema rengi ve logo
 * `BelgeTemasi`'nden alınır, yerleşim bu dosyadadır.
 */
import { bakiyeYonu, EKSTRE_TURU_ADLARI, mutabakatMetni } from "@tekirextra/shared";
import { type BelgeTemasi, VARSAYILAN_TEMA, okunakliMetin, renkNormalize, renkTonu } from "../core/pdf/belge-temasi";
import { type FirmaIletisimi, firmaIletisimSatirlari, kacis, kurBicim, paraBicim, sayiBicim, tarihBicim } from "../core/pdf/pdf-sablon";
import type { CariService } from "./cari.service";

export type EkstreVerisi = Awaited<ReturnType<CariService["ekstre"]>>;
type EkstreSatiri = EkstreVerisi["satirlar"][number];

export interface EkstreFirmasi extends FirmaIletisimi {
  unvan: string;
  vkn: string;
  vergiDairesi?: string | null;
}

const bos = "";
/**
 * Sütun genişlikleri (%). Tablo sabit düzende basılır; otomatik düzende boş
 * sütunlar yer kaplıyor, açıklama ve kalem adları daralıyordu.
 */
const GENISLIKLER = {
  standart: [7, 7, 8, 12, 26, 14, 8.5, 8.5, 9],
  ayrintili: [6.5, 6.5, 6.5, 10.5, 23, 10, 7, 7, 7.5, 7.5, 8],
  doviz: [6, 6, 7, 11, 24, 9, 9, 7, 10, 11],
  cevrilmis: [6, 6, 7, 11, 22, 11, 7, 9, 9, 12],
} as const;
const kolonlar = (tur: keyof typeof GENISLIKLER) => `<colgroup>${GENISLIKLER[tur].map((g) => `<col style="width:${g}%">`).join("")}</colgroup>`;
const FIYAT = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
/** Birim fiyat: kuruşun altına inen fiyatlar (15,125) kırpılmadan yazılır. */
const fiyatBicim = (deger: string | number) => FIYAT.format(Number(deger));
const tutarHucresi = (deger: string | number | null | undefined) =>
  deger === null || deger === undefined || deger === "" || Number(deger) === 0 ? bos : paraBicim(deger);
const bakiyeMetni = (bakiye: string | number, birim = "") => {
  const yon = bakiyeYonu(bakiye);
  return `${paraBicim(Math.abs(Number(bakiye)))}${birim ? ` ${birim}` : ""}${yon ? ` <span class="yon yon-${yon}">${yon}</span>` : ""}`;
};

function stil(tema: BelgeTemasi, yatay: boolean): string {
  const vurgu = renkNormalize(tema.vurguRengi);
  const vurguYazi = okunakliMetin(vurgu);
  return `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "DejaVu Sans", Arial, sans-serif; font-size: ${yatay ? "7.6pt" : "7.4pt"}; color: #111827; }
  .bas { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .bas td { vertical-align: top; }
  .firma { font-size: 7.4pt; color: #374151; line-height: 1.45; }
  .firma strong { font-size: 9.5pt; color: #111827; }
  .logo { max-height: 42px; max-width: 170px; display: block; margin-bottom: 5px; }
  .baslik { text-align: right; }
  .baslik h1 { font-size: 15pt; color: ${vurgu}; letter-spacing: 0.3px; }
  .baslik .tur { font-size: 8.5pt; color: #6b7280; margin-top: 2px; }
  .baslik .donem { margin-top: 6px; font-size: 8pt; line-height: 1.5; }
  .cari { border-left: 3px solid ${vurgu}; background: ${renkTonu(vurgu, 0.95)}; padding: 6px 9px; margin-bottom: 8px; line-height: 1.5; }
  .cari strong { font-size: 9pt; }
  .ozet { width: 100%; border-collapse: separate; border-spacing: 5px 0; margin: 0 -5px 8px; }
  .ozet td { border: 1px solid #e5e7eb; border-radius: 4px; padding: 5px 8px; width: 25%; }
  .ozet span { display: block; color: #6b7280; font-size: 6.8pt; text-transform: uppercase; letter-spacing: 0.3px; }
  .ozet b { font-size: 10pt; }
  .ozet .son { background: ${vurgu}; color: ${vurguYazi}; border-color: ${vurgu}; }
  .ozet .son span { color: ${vurguYazi}; opacity: 0.85; }
  table.ekstre { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.ekstre td { overflow-wrap: anywhere; }
  table.ekstre thead th { background: ${vurgu}; color: ${vurguYazi}; font-size: 6.9pt; font-weight: 600; text-align: left; padding: 4px 4px; white-space: nowrap; }
  table.ekstre td { padding: 3px 4px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  table.ekstre tfoot td { border-top: 1.5px solid #111827; border-bottom: 0; font-weight: 700; background: #f9fafb; padding: 4px; }
  table.ekstre tr { page-break-inside: avoid; }
  .sag { text-align: right; white-space: nowrap; }

  .nw { white-space: nowrap; }
  .devir td { background: #f3f4f6; font-weight: 700; }
  .ana td { font-weight: 600; }
  .ana.ayrintili td { border-bottom: 0; }
  .kalem td { background: ${renkTonu(vurgu, 0.96)}; color: #374151; font-weight: 400; border-bottom: 0; padding-top: 1px; padding-bottom: 1px; }
  .kalem .ad { padding-left: 12px; }
  .kalem-son td { border-bottom: 1px solid #e5e7eb; font-size: 6.8pt; color: #6b7280; padding-bottom: 3px; }
  .iptal td { color: #9ca3af; text-decoration: line-through; }
  .kucuk { display: block; color: #6b7280; font-size: 6.6pt; font-weight: 400; }
  .yon { display: inline-block; min-width: 9px; font-size: 6.4pt; font-weight: 700; }
  .yon-B { color: #b91c1c; } .yon-A { color: #047857; }
  h2 { font-size: 10pt; margin: 12px 0 5px; color: ${vurgu}; }
  .bolum { page-break-inside: auto; }
  /* Bölüm başlığı ve özet kutuları sayfa sonunda tablosuz kalmasın. */
  .bolum-bas { page-break-inside: avoid; page-break-after: avoid; break-after: avoid; }
  .bolum + .bolum { margin-top: 10px; }
  .dvz-ozet { width: 55%; border-collapse: collapse; margin-top: 10px; }
  .dvz-ozet th { text-align: left; font-size: 7pt; color: #6b7280; border-bottom: 1px solid #111827; padding: 3px 5px; }
  .dvz-ozet td { padding: 3px 5px; border-bottom: 1px solid #e5e7eb; }
  .mutabakat { margin-top: 14px; page-break-inside: avoid; border: 1px solid #d1d5db; border-radius: 4px; padding: 8px 10px; line-height: 1.5; }
  .mutabakat h3 { font-size: 8.5pt; margin-bottom: 4px; }
  .imza { width: 100%; border-collapse: collapse; margin-top: 10px; }
  .imza td { width: 50%; padding: 0 6px; vertical-align: top; }
  .imza div { border-top: 1px solid #111827; padding-top: 3px; margin-top: 34px; font-size: 7pt; color: #374151; }
  .not { color: #6b7280; font-size: 6.8pt; margin-top: 6px; }
`;
}

function ustBilgi(v: EkstreVerisi, firma: EkstreFirmasi, tema: BelgeTemasi, altBaslik: string): string {
  const donem = v.baslangic || v.bitis
    ? `${v.baslangic ? tarihBicim(v.baslangic) : "Başlangıç"} – ${v.bitis ? tarihBicim(v.bitis) : tarihBicim(new Date())}`
    : "Tüm hareketler";
  return `<table class="bas"><tr>
  <td class="firma" style="width:58%">
    ${tema.logoDataUri ? `<img class="logo" src="${kacis(tema.logoDataUri)}" alt="">` : ""}
    <strong>${kacis(firma.unvan)}</strong>
    <br>VKN: ${kacis(firma.vkn)}${firma.vergiDairesi ? ` · ${kacis(firma.vergiDairesi)} V.D.` : ""}${firmaIletisimSatirlari(firma)}
  </td>
  <td class="baslik">
    <h1>CARİ HESAP EKSTRESİ</h1>
    <div class="tur">${kacis(altBaslik)}</div>
    <div class="donem">Dönem: <b>${kacis(donem)}</b><br>Düzenlenme: ${tarihBicim(new Date())}</div>
  </td>
</tr></table>
<div class="cari">
  Sayın <strong>${kacis(v.cari.unvan)}</strong> <span style="color:#6b7280">(${kacis(v.cari.kod)})</span>
  ${v.cari.vknTckn ? `<br>VKN/TCKN: ${kacis(v.cari.vknTckn)}${v.cari.vergiDairesi ? ` · ${kacis(v.cari.vergiDairesi)} V.D.` : ""}` : ""}
  ${v.cari.adres ? `<br>${kacis(v.cari.adres)}` : ""}
</div>`;
}

function ozetKutulari(devir: string, borc: string, alacak: string, son: string, birim: string): string {
  return `<table class="ozet"><tr>
  <td><span>Devir bakiyesi</span><b>${bakiyeMetni(devir, birim)}</b></td>
  <td><span>Dönem borç</span><b>${paraBicim(borc)} ${birim}</b></td>
  <td><span>Dönem alacak</span><b>${paraBicim(alacak)} ${birim}</b></td>
  <td class="son"><span>Son bakiye</span><b>${bakiyeMetni(son, birim)}</b></td>
</tr></table>`;
}

/** Hareket satırının açıklama hücresi: açıklama + döviz tutarı/kuru küçük satırda. */
function aciklamaHucresi(s: EkstreSatiri, kurGoster: boolean): string {
  const doviz = s.dovizCinsi !== "TRY" && kurGoster
    ? `<span class="kucuk">${paraBicim(s.tutar)} ${kacis(s.dovizCinsi)} × ${kurBicim(s.kur)}</span>`
    : "";
  const faturaKuru = s.fatura && s.fatura.dovizCinsi !== "TRY"
    ? `<span class="kucuk">1 ${kacis(s.fatura.dovizCinsi)} = ${kurBicim(s.fatura.kur)} TL</span>`
    : "";
  const makbuz = s.odemeYontemi?.fatura?.no ? `<span class="kucuk">Fatura ${kacis(s.odemeYontemi.fatura.no)}</span>` : "";
  return `${kacis(s.aciklama ?? "")}${s.iptal ? " (iptal)" : ""}${faturaKuru || doviz}${makbuz}`;
}

/** Standart ve ayrıntılı ekstrenin TL tablosu. */
function tlTablosu(v: EkstreVerisi): string {
  const ayrintili = v.tur === "ayrintili";
  const kolon = ayrintili ? 11 : 9;
  const devir = v.baslangic
    ? `<tr class="devir"><td class="nw">${tarihBicim(v.baslangic)}</td><td></td><td>Devir</td><td></td><td>Devir bakiyesi</td><td></td>${ayrintili ? "<td></td><td></td>" : ""}<td class="sag">${Number(v.devirBakiyesi) > 0 ? paraBicim(v.devirBakiyesi) : bos}</td><td class="sag">${Number(v.devirBakiyesi) < 0 ? paraBicim(-Number(v.devirBakiyesi)) : bos}</td><td class="sag">${bakiyeMetni(v.devirBakiyesi)}</td></tr>`
    : "";
  const satirlar = v.satirlar.map((s) => {
    const kalemler = ayrintili && s.fatura && s.fatura.kalemler.length > 0;
    const ana = `<tr class="${kalemler ? "ana ayrintili" : ""}${s.iptal ? " iptal" : ""}">
  <td class="nw">${tarihBicim(s.tarih)}</td>
  <td class="nw">${s.vadeTarihi ? tarihBicim(s.vadeTarihi) : bos}</td>
  <td>${kacis(s.hareketTuru)}</td>
  <td class="nw">${kacis(s.belgeNo ?? "")}</td>
  <td>${aciklamaHucresi(s, true)}</td>
  <td>${kacis(s.odemeSekli ?? "")}</td>
  ${ayrintili ? "<td></td><td></td>" : ""}
  <td class="sag">${s.tip === "borc" ? paraBicim(s.tutarTry) : bos}</td>
  <td class="sag">${s.tip === "alacak" ? paraBicim(s.tutarTry) : bos}</td>
  <td class="sag">${bakiyeMetni(s.yuruyenBakiye)}</td>
</tr>`;
    if (!kalemler) return ana;
    const f = s.fatura!;
    const birim = f.dovizCinsi === "TRY" ? "" : ` ${kacis(f.dovizCinsi)}`;
    const kalemSatirlari = f.kalemler.map((k) => `<tr class="kalem">
  <td></td><td></td><td></td><td></td>
  <td class="ad">${kacis(k.stokKod)} · ${kacis(k.stokAd)}${Number(k.iskontoOrani) > 0 ? `<span class="kucuk">İskonto %${sayiBicim(k.iskontoOrani)}</span>` : ""}</td>
  <td></td>
  <td class="sag">${sayiBicim(k.miktar)} ${kacis(k.birim)}</td>
  <td class="sag">${fiyatBicim(k.birimFiyat)}${birim}</td>
  <td class="sag">${paraBicim(k.tutar)}${birim}</td>
  <td></td><td></td>
</tr>`).join("");
    const toplam = `<tr class="kalem kalem-son"><td></td><td></td><td></td><td></td>
  <td class="ad" colspan="${kolon - 4}">Matrah ${paraBicim(f.toplamMatrah)}${birim} · KDV ${paraBicim(f.toplamKdv)}${birim} · Fatura toplamı ${paraBicim(f.genelToplam)}${birim}</td>
</tr>`;
    return ana + kalemSatirlari + toplam;
  }).join("");
  return `<table class="ekstre">${kolonlar(ayrintili ? "ayrintili" : "standart")}
  <thead><tr>
    <th>Tarih</th><th>Vade</th><th>Hareket</th><th>Belge No</th><th>Açıklama</th><th>Ödeme</th>
    ${ayrintili ? `<th class="sag">Miktar</th><th class="sag">Fiyat</th>` : ""}
    <th class="sag">Borç (TL)</th><th class="sag">Alacak (TL)</th><th class="sag">Bakiye (TL)</th>
  </tr></thead>
  <tbody>${devir}${satirlar || `<tr><td colspan="${kolon}" style="text-align:center;color:#6b7280;padding:10px">Dönemde hareket bulunmuyor</td></tr>`}</tbody>
  <tfoot><tr>
    <td colspan="${kolon - 3}">Dönem toplamı</td>
    <td class="sag">${paraBicim(v.donemBorc)}</td><td class="sag">${paraBicim(v.donemAlacak)}</td><td class="sag">${bakiyeMetni(v.donemSonuBakiyesi)}</td>
  </tr></tfoot>
</table>`;
}

/** Döviz ekstresi, ayrı bölümler: her döviz kendi tablosunda, bakiye o dövizde. */
function dovizBolumleri(v: EkstreVerisi): string {
  return (v.dovizBolumleri ?? []).map((b) => {
    const birim = b.dovizCinsi === "TRY" ? "TL" : b.dovizCinsi;
    const devir = v.baslangic
      ? `<tr class="devir"><td class="nw">${tarihBicim(v.baslangic)}</td><td></td><td>Devir</td><td></td><td>Devir bakiyesi</td><td></td><td></td><td></td><td></td><td class="sag">${bakiyeMetni(b.devir, birim)}</td></tr>`
      : "";
    const satirlar = b.satirlar.map((s) => `<tr${s.iptal ? ` class="iptal"` : ""}>
  <td class="nw">${tarihBicim(s.tarih)}</td><td class="nw">${s.vadeTarihi ? tarihBicim(s.vadeTarihi) : bos}</td>
  <td>${kacis(s.hareketTuru)}</td><td class="nw">${kacis(s.belgeNo ?? "")}</td>
  <td>${kacis(s.aciklama ?? "")}${s.odemeSekli ? `<span class="kucuk">${kacis(s.odemeSekli)}</span>` : ""}</td>
  <td class="sag">${s.tip === "borc" ? paraBicim(s.tutar) : bos}</td><td class="sag">${s.tip === "alacak" ? paraBicim(s.tutar) : bos}</td>
  <td class="sag">${b.dovizCinsi === "TRY" ? bos : kurBicim(s.kur)}</td><td class="sag">${paraBicim(s.tutarTry)}</td>
  <td class="sag">${bakiyeMetni(s.yuruyenDovizBakiye, birim)}</td>
</tr>`).join("");
    return `<div class="bolum"><div class="bolum-bas"><h2>${kacis(birim)} hesabı</h2>
${ozetKutulari(b.devir, b.borc, b.alacak, b.bakiye, birim)}</div>
<table class="ekstre">${kolonlar("doviz")}
  <thead><tr><th>Tarih</th><th>Vade</th><th>Hareket</th><th>Belge No</th><th>Açıklama</th>
    <th class="sag">Borç (${kacis(birim)})</th><th class="sag">Alacak (${kacis(birim)})</th><th class="sag">Kur</th><th class="sag">TL karşılığı</th><th class="sag">Bakiye (${kacis(birim)})</th></tr></thead>
  <tbody>${devir}${satirlar || `<tr><td colspan="10" style="text-align:center;color:#6b7280;padding:8px">Dönemde ${kacis(birim)} hareketi yok</td></tr>`}</tbody>
  <tfoot><tr><td colspan="5">${kacis(birim)} dönem toplamı</td><td class="sag">${paraBicim(b.borc)}</td><td class="sag">${paraBicim(b.alacak)}</td><td></td><td></td><td class="sag">${bakiyeMetni(b.bakiye, birim)}</td></tr></tfoot>
</table></div>`;
  }).join("");
}

/** Döviz ekstresi, çevirme modu: tüm hareketler seçilen dövizde tek listede. */
function cevrilmisTablo(v: EkstreVerisi): string {
  const c = v.cevrilmis!;
  const birim = c.dovizCinsi;
  const devir = v.baslangic
    ? `<tr class="devir"><td class="nw">${tarihBicim(v.baslangic)}</td><td></td><td>Devir</td><td></td><td>Devir bakiyesi</td><td></td><td></td><td></td><td></td><td class="sag">${bakiyeMetni(c.devir, birim)}</td></tr>`
    : "";
  const satirlar = c.satirlar.map((s) => `<tr${s.iptal ? ` class="iptal"` : ""}>
  <td class="nw">${tarihBicim(s.tarih)}</td><td class="nw">${s.vadeTarihi ? tarihBicim(s.vadeTarihi) : bos}</td>
  <td>${kacis(s.hareketTuru)}</td><td class="nw">${kacis(s.belgeNo ?? "")}</td>
  <td>${kacis(s.aciklama ?? "")}${s.odemeSekli ? `<span class="kucuk">${kacis(s.odemeSekli)}</span>` : ""}</td>
  <td class="sag">${paraBicim(s.tutar)} ${kacis(s.dovizCinsi === "TRY" ? "TL" : s.dovizCinsi)}</td>
  <td class="sag">${s.cevrimKuru ? kurBicim(s.cevrimKuru) : "—"}</td>
  <td class="sag">${s.tip === "borc" ? paraBicim(s.hedefTutar) : bos}</td><td class="sag">${s.tip === "alacak" ? paraBicim(s.hedefTutar) : bos}</td>
  <td class="sag">${bakiyeMetni(s.yuruyenDovizBakiye, birim)}</td>
</tr>`).join("");
  return `${ozetKutulari(c.devir, c.borc, c.alacak, c.bakiye, birim)}
<table class="ekstre">${kolonlar("cevrilmis")}
  <thead><tr><th>Tarih</th><th>Vade</th><th>Hareket</th><th>Belge No</th><th>Açıklama</th><th class="sag">Hareket tutarı</th><th class="sag">Çevrim kuru</th>
    <th class="sag">Borç (${kacis(birim)})</th><th class="sag">Alacak (${kacis(birim)})</th><th class="sag">Bakiye (${kacis(birim)})</th></tr></thead>
  <tbody>${devir}${satirlar || `<tr><td colspan="10" style="text-align:center;color:#6b7280;padding:8px">Dönemde hareket bulunmuyor</td></tr>`}</tbody>
  <tfoot><tr><td colspan="7">Dönem toplamı</td><td class="sag">${paraBicim(c.borc)}</td><td class="sag">${paraBicim(c.alacak)}</td><td class="sag">${bakiyeMetni(c.bakiye, birim)}</td></tr></tfoot>
</table>
<p class="not">${kacis(birim)} dışındaki hareketler, TL karşılıkları hareket gününün ${kacis(birim)} döviz satış kuruna bölünerek çevrilmiştir (kiracının elle kuru varsa o). ${kacis(birim)} hareketleri kendi tutarıyla yer alır.</p>`;
}

function dovizOzetTablosu(v: EkstreVerisi): string {
  if (v.dovizOzet.length < 2 && !(v.dovizOzet.length === 1 && v.dovizOzet[0].dovizCinsi !== "TRY")) return "";
  return `<table class="dvz-ozet"><thead><tr><th>Döviz</th><th class="sag">Devir</th><th class="sag">Dönem borç</th><th class="sag">Dönem alacak</th><th class="sag">Bakiye</th></tr></thead><tbody>${
    v.dovizOzet.map((o) => { const b = o.dovizCinsi === "TRY" ? "TL" : o.dovizCinsi; return `<tr><td><b>${kacis(b)}</b></td><td class="sag">${bakiyeMetni(o.devir)}</td><td class="sag">${paraBicim(o.borc)}</td><td class="sag">${paraBicim(o.alacak)}</td><td class="sag">${bakiyeMetni(o.bakiye, b)}</td></tr>`; }).join("")
  }</tbody></table>`;
}

function mutabakatBolumu(v: EkstreVerisi, firma: EkstreFirmasi): string {
  const bitis = v.bitis ?? new Date().toISOString().slice(0, 10);
  const bakiyeler = v.tur === "doviz" && v.cevrilmis
    ? [{ dovizCinsi: v.cevrilmis.dovizCinsi, bakiye: v.cevrilmis.bakiye }]
    : v.tur === "doviz"
      ? v.dovizOzet.map((o) => ({ dovizCinsi: o.dovizCinsi === "TRY" ? "TL" : o.dovizCinsi, bakiye: o.bakiye }))
      : [{ dovizCinsi: "TL", bakiye: v.donemSonuBakiyesi }];
  return `<div class="mutabakat">
  <h3>Mutabakat</h3>
  <p>Sayın ${kacis(v.cari.unvan)}, ${kacis(mutabakatMetni(bitis, bakiyeler))}</p>
  <table class="imza"><tr>
    <td><div>${kacis(firma.unvan)}<br>Kaşe / İmza</div></td>
    <td><div>${kacis(v.cari.unvan)}<br>Mutabıkız / Mutabık değiliz · Kaşe / İmza · Tarih</div></td>
  </tr></table>
</div>`;
}

export function ekstrePdfHtml(v: EkstreVerisi, firma: EkstreFirmasi, secenekler: { tema?: BelgeTemasi; mutabakat?: boolean } = {}): { html: string; yatay: boolean } {
  const tema = secenekler.tema ?? VARSAYILAN_TEMA;
  // Bütün ekstre türleri yatay basılır: sütunlar dar kalmasın (kullanıcı kararı, 2026-09-29).
  const yatay = true;
  const altBaslik = v.tur === "doviz" && v.cevrilmis
    ? `${EKSTRE_TURU_ADLARI.doviz} · ${v.cevrilmis.dovizCinsi} cinsinden`
    : EKSTRE_TURU_ADLARI[v.tur];
  const govde = v.tur === "doviz"
    ? (v.cevrilmis ? cevrilmisTablo(v) : dovizBolumleri(v))
    : `${ozetKutulari(v.devirBakiyesi, v.donemBorc, v.donemAlacak, v.donemSonuBakiyesi, "TL")}${tlTablosu(v)}${dovizOzetTablosu(v)}`;
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${stil(tema, yatay)}</style></head><body>
${ustBilgi(v, firma, tema, altBaslik)}
${govde}
${secenekler.mutabakat ? mutabakatBolumu(v, firma) : ""}
</body></html>`;
  return { html, yatay };
}
