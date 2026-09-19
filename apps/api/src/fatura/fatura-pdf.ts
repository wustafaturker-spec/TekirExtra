import {
  kacis,
  kurBicim,
  paraBicim,
  sayfaSablonu,
  sayiBicim,
  tarihBicim,
  tlKarsiligi,
  firmaIletisimSatirlari,
  type FirmaIletisimi,
} from "../core/pdf/pdf-sablon";
import type { BelgeTemasi } from "../core/pdf/belge-temasi";

/** Fatura PDF şablonu (FTR-07, T-02 altyapısı). */

const TIP_BASLIKLARI: Record<string, string> = {
  satis: "SATIŞ FATURASI",
  alis: "ALIŞ FATURASI",
  satis_iade: "SATIŞ İADE FATURASI",
  alis_iade: "ALIŞ İADE FATURASI",
  proforma: "PROFORMA FATURA",
};

export interface FaturaPdfSatiri {
  stokKod: string;
  stokAd: string;
  miktar: string;
  birim: string;
  birimFiyat: string;
  iskontoOrani: string;
  matrah: string;
  kdvOrani: string;
  kdvTutari: string;
  toplamTutar: string;
  /** FTR-11: satır bazlı GİB istisna kodu (ör. 301). */
  gibIstisnaKodu?: string | null;
}

export interface FaturaPdfVerisi {
  tip: string;
  durum: string;
  no: string | null;
  tarih: string | Date;
  vadeTarihi: string | Date | null;
  dovizCinsi: string;
  kur: string;
  toplamBrut: string;
  toplamSatirIskontosu: string;
  genelIskontoToplam: string;
  toplamMatrah: string;
  toplamKdv: string;
  toplamTevkifat: string;
  genelToplam: string;
  aciklama: string | null;
  cari: { kod: string; unvan: string; vknTckn: string | null };
  satirlar: FaturaPdfSatiri[];
  /** Faturanın e-belge kanalı; gönderilmemişse yok (EBLG-26). */
  ebelge?: { tur: string } | null;
  earsivGonderimSekli?: string;
  /** EBLG-30: belgenin ETTN'i — UBL'de UUID olarak giden değerin aynısı. */
  id?: string;
  /** EBLG-30: satırlardan türetilen GİB senaryosu (FTR-16). */
  senaryo?: string;
  /** EBLG-30: e-Fatura profili; e-Arşiv'de kanal profili yazar. */
  efaturaProfili?: string;
}

/** EBLG-30: PDF'te gösterilen profil adı; UBL'deki ProfileID ile aynı ayrımdır. */
export function profilAdi(f: Pick<FaturaPdfVerisi, "ebelge" | "efaturaProfili">): string | null {
  if (!f.ebelge) return null;
  if (f.ebelge.tur === "earsiv") return "EARSIVFATURA";
  return f.efaturaProfili === "ticari" ? "TICARIFATURA" : "TEMELFATURA";
}

/**
 * Elektronik ortamda iletilen e-Arşiv faturada bulunması gereken ibare
 * (EBLG-26). Kâğıt olarak teslim edilen e-Arşivde yer almaz.
 */
export const EARSIV_ELEKTRONIK_IBARESI = "e-Arşiv izni kapsamında elektronik ortamda iletilmiştir.";

export interface FirmaBilgisi extends FirmaIletisimi {
  unvan: string;
  vkn: string;
  vergiDairesi: string | null;
  /** KLN-03: firma logosu, data URI olarak gömülür. */
  tema?: BelgeTemasi;
}

export function faturaPdfHtml(f: FaturaPdfVerisi, firma: FirmaBilgisi): string {
  const baslik = TIP_BASLIKLARI[f.tip] ?? "FATURA";
  const paraBirimi = f.dovizCinsi === "TRY" ? "TL" : f.dovizCinsi;

  const satirlar = f.satirlar
    .map(
      (s, i) => `<tr>
  <td class="orta">${i + 1}</td>
  <td>${kacis(s.stokKod)}</td>
  <td>${kacis(s.stokAd)}${
    s.gibIstisnaKodu
      ? `<br><span style="color:#6b7280;font-size:8pt">KDV istisna kodu: ${kacis(s.gibIstisnaKodu)}</span>`
      : ""
  }</td>
  <td class="sag">${sayiBicim(s.miktar)} ${kacis(s.birim)}</td>
  <td class="sag">${paraBicim(s.birimFiyat)}</td>
  <td class="sag">${Number(s.iskontoOrani) > 0 ? `%${sayiBicim(s.iskontoOrani)}` : ""}</td>
  <td class="sag">${paraBicim(s.matrah)}</td>
  <td class="sag">%${sayiBicim(s.kdvOrani)}</td>
  <td class="sag">${paraBicim(s.kdvTutari)}</td>
  <td class="sag">${paraBicim(s.toplamTutar)}</td>
</tr>`,
    )
    .join("\n");

  const toplamSatiri = (etiket: string, deger: string | number, kalin = false, birim = paraBirimi) =>
    `<tr${kalin ? ' style="font-weight:bold"' : ""}>
      <td style="padding:3px 8px">${etiket}</td>
      <td class="sag" style="padding:3px 8px">${paraBicim(deger)} ${birim}</td>
    </tr>`;

  const kalemler: { etiket: string; deger: string; kalin?: boolean }[] = [
    { etiket: "Brüt Toplam", deger: f.toplamBrut },
    ...(Number(f.toplamSatirIskontosu) > 0 ? [{ etiket: "Satır İskontoları", deger: `-${f.toplamSatirIskontosu}` }] : []),
    ...(Number(f.genelIskontoToplam) > 0 ? [{ etiket: "Genel İskonto", deger: `-${f.genelIskontoToplam}` }] : []),
    { etiket: "KDV Matrahı", deger: f.toplamMatrah },
    { etiket: "Hesaplanan KDV", deger: f.toplamKdv },
    ...(Number(f.toplamTevkifat) > 0 ? [{ etiket: "KDV Tevkifatı", deger: `-${f.toplamTevkifat}` }] : []),
    { etiket: "Genel Toplam", deger: f.genelToplam, kalin: true },
  ];
  // EBLG-57: dövizli faturada toplamların TL karşılığı da gösterilir; ihracat
  // faturasının resmî görünümü de kur satırının altında aynı toplamları TL verir.
  const dovizli = f.dovizCinsi !== "TRY";
  const toplamlar = [
    ...kalemler.map((k) => toplamSatiri(k.etiket, k.deger, k.kalin)),
    ...(dovizli
      ? [
          `<tr><td style="padding:3px 8px;border-top:1px solid #e5e7eb">Döviz Kuru (1 ${kacis(f.dovizCinsi)})</td><td class="sag" style="padding:3px 8px;border-top:1px solid #e5e7eb">${kurBicim(f.kur)} TL</td></tr>`,
          ...kalemler.map((k) => toplamSatiri(`${k.etiket} (TL)`, tlKarsiligi(k.deger, f.kur), k.kalin, "TL")),
        ]
      : []),
  ].join("");

  // EBLG-30: belge gönderildiyse kimliği çıktıda yer alır; taslakta ETTN'in
  // bir anlamı yoktur, gösterilmez.
  const profil = profilAdi(f);
  const ebelgeKimligi = profil
    ? `<br>ETTN: ${kacis(f.id ?? "")}<br>Senaryo: ${kacis(f.senaryo ?? "")} &nbsp;•&nbsp; Profil: ${kacis(profil)}`
    : "";

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
        <strong>Sayın ${kacis(f.cari.unvan)}</strong> (${kacis(f.cari.kod)})<br>
        ${f.cari.vknTckn ? `VKN/TCKN: ${kacis(f.cari.vknTckn)}<br>` : ""}
        Fatura No: <strong>${kacis(f.no ?? "— TASLAK —")}</strong><br>
        Tarih: ${tarihBicim(f.tarih)}${
          f.vadeTarihi ? ` &nbsp;•&nbsp; Vade: ${tarihBicim(f.vadeTarihi)}` : ""
        }${
          f.dovizCinsi !== "TRY"
            ? `<br>Döviz: ${kacis(f.dovizCinsi)} (kur ${kurBicim(f.kur)})`
            : ""
        }${ebelgeKimligi}
      </div>
    </td>
  </tr>
</table>
<table class="veri">
  <thead><tr>
    <th>#</th><th>Kod</th><th>Ürün / Hizmet</th>
    <th class="sag">Miktar</th><th class="sag">Birim Fiyat</th>
    <th class="sag">İsk.</th><th class="sag">Matrah</th>
    <th class="sag">KDV %</th><th class="sag">KDV</th><th class="sag">Tutar</th>
  </tr></thead>
  <tbody>${satirlar}</tbody>
</table>
<table style="margin-top:12px;margin-left:auto;border:1px solid #e5e7eb;border-radius:4px;font-size:9pt">
  ${toplamlar}
</table>
${f.aciklama ? `<p style="margin-top:10px;color:#6b7280">${kacis(f.aciklama)}</p>` : ""}
${f.ebelge?.tur === "earsiv" && f.earsivGonderimSekli !== "kagit" ? `<p style="margin-top:10px;font-size:9pt">${EARSIV_ELEKTRONIK_IBARESI}</p>` : ""}`;

  return sayfaSablonu({
    baslik: f.durum === "taslak" ? `${baslik} (TASLAK)` : baslik,
    icerik,
    tema: firma.tema,
  });
}
