import { kacis, kurBicim, paraBicim, sayfaSablonu, sayiBicim, tarihBicim, tlKarsiligi } from "../core/pdf/pdf-sablon";
import type { BelgeTemasi } from "../core/pdf/belge-temasi";
import { karekoduHtmlEkle } from "./karekod";
import type { UblFatura } from "./ubl-oku";

/**
 * EBLG-28 yedek görünümü: belgede gömülü XSLT yoksa ya da uygulanamadıysa
 * belge UBL'den okunan alanlarla basılır. **Gelen** belgede bu, gönderenin
 * tasarladığı resmî görünüm değildir; çıktı bunu açıkça söyler.
 *
 * Kendi kestiğimiz belgede durum başkadır (2026-09-17): giden belgeye görünüm
 * gömülmüyoruz (EBLG-31 iptal), yani bu düzen kendi seçtiğimiz şablondur —
 * "gönderenin şablonu yok" notu orada yanıltıcı olur, `kendiBelgemiz` ile
 * kapatılır.
 */

const YEDEK_NOTU =
  "Bu görünüm, belgede gönderenin görünüm şablonu bulunmadığı için TekirExtra tarafından belgenin verilerinden oluşturulmuştur.";

const PROFIL_ADLARI: Record<string, string> = {
  TEMELFATURA: "Temel Fatura",
  TICARIFATURA: "Ticari Fatura",
  EARSIVFATURA: "e-Arşiv Fatura",
  IHRACAT: "İhracat",
  YOLCUBERABERFATURA: "Yolcu Beraberi Fatura",
};

export function ebelgeYedekPdfHtml(
  f: UblFatura,
  secenekler: {
    tema?: BelgeTemasi;
    /** EBLG-32: yalnız kestiğimiz belgede verilir. */
    karekodDataUri?: string;
    /** Kestiğimiz belge: düzen yedek değil, seçtiğimiz şablondur. */
    kendiBelgemiz?: boolean;
  } = {},
): string {
  const paraBirimi = f.dovizCinsi === "TRY" ? "TL" : f.dovizCinsi;
  const profil = PROFIL_ADLARI[f.profilId] ?? f.profilId;

  /*
   * EBLG-76: irsaliye yerine geçen faturada ibare ve fiili sevk anı belgenin
   * kendisinden okunur (`cbc:Note` + `Delivery/Despatch`), çünkü sevkin kanıtı
   * faturadır. İbare belgede yoksa uydurulmaz; yalnız belgede yazan basılır.
   */
  // Okuyucu notları hep doldurur; yine de eksik alanı hataya çevirmiyoruz
  // (ubl-oku'nun tolere edici çizgisi).
  const sevkIbaresi = (f.notlar ?? []).find((not) => not.includes("irsaliye yerine geçer"));
  const sevkNotu = f.sevk || sevkIbaresi
    ? `<div class="kutu" style="margin-top:12px;font-size:9pt">
        ${sevkIbaresi ? `<strong>${kacis(sevkIbaresi)}</strong>` : ""}${f.sevk ? `${sevkIbaresi ? "<br>" : ""}Fiili sevk: ${tarihBicim(f.sevk.tarih)}${f.sevk.saat ? ` ${kacis(f.sevk.saat.slice(0, 5))}` : ""}` : ""}
      </div>`
    : "";

  const satirlar = f.satirlar
    .map(
      (s) => `<tr>
  <td class="orta">${s.siraNo}</td>
  <td>${kacis(s.saticiUrunKodu ?? "")}</td>
  <td>${kacis(s.ad)}</td>
  <td class="sag">${sayiBicim(s.miktar)} ${kacis(s.birim)}</td>
  <td class="sag">${paraBicim(s.birimFiyat)}</td>
  <td class="sag">${s.iskontoTutari > 0 ? paraBicim(s.iskontoTutari) : ""}</td>
  <td class="sag">${paraBicim(s.matrah)}</td>
  <td class="sag">%${sayiBicim(s.kdvOrani)}</td>
  <td class="sag">${paraBicim(s.kdvTutari)}</td>
</tr>`,
    )
    .join("\n");

  const toplamSatiri = (etiket: string, deger: number, kalin = false, birim = paraBirimi) =>
    `<tr${kalin ? ' style="font-weight:bold"' : ""}>
      <td style="padding:3px 8px">${etiket}</td>
      <td class="sag" style="padding:3px 8px">${paraBicim(deger)} ${birim}</td>
    </tr>`;

  const kalemler: { etiket: string; deger: number; kalin?: boolean }[] = [
    { etiket: "Mal/Hizmet Toplamı", deger: f.toplamlar.satirToplami },
    ...(f.toplamlar.iskontoToplami > 0 ? [{ etiket: "İskonto", deger: -f.toplamlar.iskontoToplami }] : []),
    // EBLG-111: özel matrahta KDV satış bedelinden değil özel matrahtan hesaplanır.
    f.toplamlar.ozelMatrah !== undefined
      ? { etiket: "Özel Matrah (KDV Matrahı)", deger: f.toplamlar.ozelMatrah }
      : { etiket: "KDV Matrahı", deger: f.toplamlar.matrah },
    { etiket: "Hesaplanan KDV", deger: f.toplamlar.kdv },
    { etiket: "Ödenecek Tutar", deger: f.toplamlar.genelToplam, kalin: true },
  ];
  // EBLG-57: dövizli belgede kur ve toplamların TL karşılığı da basılır.
  // Kur belgede yoksa TL karşılığı uydurulmaz, blok hiç çıkmaz.
  const kur = f.dovizCinsi !== "TRY" ? f.kur : undefined;
  const toplamlar = [
    ...kalemler.map((k) => toplamSatiri(k.etiket, k.deger, k.kalin)),
    ...(kur
      ? [
          `<tr><td style="padding:3px 8px;border-top:1px solid #e5e7eb">Döviz Kuru (1 ${kacis(f.dovizCinsi)})</td><td class="sag" style="padding:3px 8px;border-top:1px solid #e5e7eb">${kurBicim(kur)} TL</td></tr>`,
          ...kalemler.map((k) => toplamSatiri(`${k.etiket} (TL)`, tlKarsiligi(k.deger, kur), k.kalin, "TL")),
        ]
      : []),
  ].join("");

  const icerik = `
<table style="width:100%;margin-bottom:12px;font-size:9pt">
  <tr>
    <td style="vertical-align:top;width:50%">
      <div class="kutu">
        <strong>${kacis(f.gonderen.unvan)}</strong><br>
        VKN/TCKN: ${kacis(f.gonderen.vknTckn)}${f.gonderen.vergiDairesi ? ` — ${kacis(f.gonderen.vergiDairesi)}` : ""}
      </div>
    </td>
    <td style="width:4%"></td>
    <td style="vertical-align:top;width:46%">
      <div class="kutu">
        <strong>Sayın ${kacis(f.alici.unvan)}</strong><br>
        ${f.alici.vknTckn ? `VKN/TCKN: ${kacis(f.alici.vknTckn)}<br>` : ""}
        Fatura No: <strong>${kacis(f.belgeNo)}</strong><br>
        Tarih: ${tarihBicim(f.tarih)}${f.vadeTarihi ? ` &nbsp;•&nbsp; Vade: ${tarihBicim(f.vadeTarihi)}` : ""}<br>
        ETTN: ${kacis(f.uuid)}<br>
        Senaryo: ${kacis(f.faturaTipKodu)} &nbsp;•&nbsp; Profil: ${kacis(profil)}
      </div>
    </td>
  </tr>
</table>
<table class="veri">
  <thead><tr>
    <th>#</th><th>Kod</th><th>Ürün / Hizmet</th>
    <th class="sag">Miktar</th><th class="sag">Birim Fiyat</th>
    <th class="sag">İskonto</th><th class="sag">Matrah</th>
    <th class="sag">KDV %</th><th class="sag">KDV</th>
  </tr></thead>
  <tbody>${satirlar}</tbody>
</table>
<table style="margin-top:12px;margin-left:auto;border:1px solid #e5e7eb;border-radius:4px;font-size:9pt">
  ${toplamlar}
</table>
${sevkNotu}${secenekler.kendiBelgemiz ? "" : `<p style="margin-top:14px;color:#6b7280;font-size:8pt">${YEDEK_NOTU}</p>`}`;

  const sayfa = sayfaSablonu({
    baslik: profil.toLocaleUpperCase("tr-TR"),
    altBaslik: `${f.gonderen.unvan} — ${f.belgeNo}`,
    icerik,
    tema: secenekler.tema,
  });
  // EBLG-32: gömülü görünümdeki gibi sayfanın sağ üstünde.
  return secenekler.karekodDataUri ? karekoduHtmlEkle(sayfa, secenekler.karekodDataUri) : sayfa;
}

export { YEDEK_NOTU as EBELGE_YEDEK_GORUNUM_NOTU };
