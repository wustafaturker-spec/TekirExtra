import {
  kacis,
  paraBicim,
  sayfaSablonu,
  sayiBicim,
  tarihBicim,
  firmaIletisimSatirlari,
  type FirmaIletisimi,
} from "../core/pdf/pdf-sablon";
import type { BelgeTemasi } from "../core/pdf/belge-temasi";

/** Zincir belgeleri PDF şablonu (FTR-12, T-02; kağıt/PDF irsaliye). */

const BASLIKLAR: Record<string, Record<string, string>> = {
  teklif: { satis: "SATIŞ TEKLİFİ", alis: "ALIŞ TEKLİFİ" },
  siparis: { satis: "SATIŞ SİPARİŞİ", alis: "SATINALMA SİPARİŞİ" },
  irsaliye: { satis: "SEVK İRSALİYESİ", alis: "MAL KABUL İRSALİYESİ" },
};

export interface BelgePdfVerisi {
  tur: string;
  yon: string;
  durum: string;
  no: string | null;
  tarih: string;
  gecerlilikTarihi: string | null;
  dovizCinsi: string;
  kur: string;
  toplamBrut: string;
  toplamSatirIskontosu: string;
  genelIskontoToplam: string;
  toplamMatrah: string;
  toplamKdv: string;
  genelToplam: string;
  aciklama: string | null;
  cari: { kod: string; unvan: string; vknTckn: string | null };
  satirlar: {
    stokKod: string;
    stokAd: string;
    miktar: string;
    birim: string;
    birimFiyat: string;
    iskontoOrani: string;
    kdvOrani: string;
    toplamTutar: string;
  }[];
}

export function belgePdfHtml(
  b: BelgePdfVerisi,
  firma: {
    unvan: string;
    vkn: string;
    vergiDairesi: string | null;
  } & FirmaIletisimi & {
    /** KLN-03: firma logosu, data URI olarak gömülür. */
    tema?: BelgeTemasi;
  },
): string {
  const baslik = BASLIKLAR[b.tur]?.[b.yon] ?? "BELGE";
  const paraBirimi = b.dovizCinsi === "TRY" ? "TL" : b.dovizCinsi;

  const satirlar = b.satirlar
    .map(
      (s, i) => `<tr>
  <td class="orta">${i + 1}</td>
  <td>${kacis(s.stokKod)}</td>
  <td>${kacis(s.stokAd)}</td>
  <td class="sag">${sayiBicim(s.miktar)} ${kacis(s.birim)}</td>
  <td class="sag">${paraBicim(s.birimFiyat)}</td>
  <td class="sag">${Number(s.iskontoOrani) > 0 ? `%${sayiBicim(s.iskontoOrani)}` : ""}</td>
  <td class="sag">%${sayiBicim(s.kdvOrani)}</td>
  <td class="sag">${paraBicim(s.toplamTutar)}</td>
</tr>`,
    )
    .join("\n");

  const icerik = `
<table style="width:100%;margin-bottom:12px;font-size:9pt">
  <tr>
    <td style="vertical-align:top;width:50%">
      <div class="kutu">
        <strong>${kacis(firma.unvan)}</strong><br>
        VKN: ${kacis(firma.vkn)}${firma.vergiDairesi ? ` — ${kacis(firma.vergiDairesi)}` : ""}${firmaIletisimSatirlari(firma)}
      </div>
    </td>
    <td style="width:4%"></td>
    <td style="vertical-align:top;width:46%">
      <div class="kutu">
        <strong>Sayın ${kacis(b.cari.unvan)}</strong> (${kacis(b.cari.kod)})<br>
        ${b.cari.vknTckn ? `VKN/TCKN: ${kacis(b.cari.vknTckn)}<br>` : ""}
        Belge No: <strong>${kacis(b.no ?? "— TASLAK —")}</strong><br>
        Tarih: ${tarihBicim(b.tarih)}${
          b.gecerlilikTarihi
            ? ` &nbsp;•&nbsp; Geçerlilik: ${tarihBicim(b.gecerlilikTarihi)}`
            : ""
        }${
          b.dovizCinsi !== "TRY"
            ? `<br>Döviz: ${kacis(b.dovizCinsi)} (kur ${sayiBicim(b.kur)})`
            : ""
        }
      </div>
    </td>
  </tr>
</table>
<table class="veri">
  <thead><tr>
    <th>#</th><th>Kod</th><th>Ürün / Hizmet</th>
    <th class="sag">Miktar</th><th class="sag">Birim Fiyat</th>
    <th class="sag">İsk.</th><th class="sag">KDV %</th><th class="sag">Tutar</th>
  </tr></thead>
  <tbody>${satirlar}</tbody>
</table>
<table style="margin-top:12px;margin-left:auto;border:1px solid #e5e7eb;border-radius:4px;font-size:9pt">
  <tr><td style="padding:3px 8px">KDV Matrahı</td><td class="sag" style="padding:3px 8px">${paraBicim(b.toplamMatrah)} ${paraBirimi}</td></tr>
  <tr><td style="padding:3px 8px">Hesaplanan KDV</td><td class="sag" style="padding:3px 8px">${paraBicim(b.toplamKdv)} ${paraBirimi}</td></tr>
  <tr style="font-weight:bold"><td style="padding:3px 8px">Genel Toplam</td><td class="sag" style="padding:3px 8px">${paraBicim(b.genelToplam)} ${paraBirimi}</td></tr>
</table>
${
  b.tur === "irsaliye"
    ? `<table style="width:100%;margin-top:26px;font-size:9pt"><tr>
        <td style="width:45%"><div class="kutu" style="height:60px">Teslim Eden<br><br>Ad Soyad / İmza</div></td>
        <td style="width:10%"></td>
        <td style="width:45%"><div class="kutu" style="height:60px">Teslim Alan<br><br>Ad Soyad / İmza</div></td>
      </tr></table>`
    : ""
}
${b.aciklama ? `<p style="margin-top:10px;color:#6b7280">${kacis(b.aciklama)}</p>` : ""}`;

  return sayfaSablonu({
    baslik: b.durum === "taslak" ? `${baslik} (TASLAK)` : baslik,
    icerik,
    tema: firma.tema,
  });
}
