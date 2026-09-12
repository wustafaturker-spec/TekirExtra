import { kacis, paraBicim, sayfaSablonu, sayiBicim, tarihBicim } from "../core/pdf/pdf-sablon";
import type { UblFatura } from "./ubl-oku";

/**
 * EBLG-28 yedek görünümü: belgede gömülü XSLT yoksa ya da uygulanamadıysa
 * belge UBL'den okunan alanlarla basılır. Bu, gönderenin tasarladığı resmî
 * görünüm değildir; çıktı bunu açıkça söyler.
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

export function ebelgeYedekPdfHtml(f: UblFatura, secenekler: { logoDataUri?: string } = {}): string {
  const paraBirimi = f.dovizCinsi === "TRY" ? "TL" : f.dovizCinsi;
  const profil = PROFIL_ADLARI[f.profilId] ?? f.profilId;

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

  const toplamSatiri = (etiket: string, deger: number, kalin = false) =>
    `<tr${kalin ? ' style="font-weight:bold"' : ""}>
      <td style="padding:3px 8px">${etiket}</td>
      <td class="sag" style="padding:3px 8px">${paraBicim(deger)} ${paraBirimi}</td>
    </tr>`;

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
  ${toplamSatiri("Mal/Hizmet Toplamı", f.toplamlar.satirToplami)}
  ${f.toplamlar.iskontoToplami > 0 ? toplamSatiri("İskonto", -f.toplamlar.iskontoToplami) : ""}
  ${toplamSatiri("KDV Matrahı", f.toplamlar.matrah)}
  ${toplamSatiri("Hesaplanan KDV", f.toplamlar.kdv)}
  ${toplamSatiri("Ödenecek Tutar", f.toplamlar.genelToplam, true)}
</table>
<p style="margin-top:14px;color:#6b7280;font-size:8pt">${YEDEK_NOTU}</p>`;

  return sayfaSablonu({
    baslik: profil.toLocaleUpperCase("tr-TR"),
    altBaslik: `${f.gonderen.unvan} — ${f.belgeNo}`,
    icerik,
    logoDataUri: secenekler.logoDataUri,
  });
}

export { YEDEK_NOTU as EBELGE_YEDEK_GORUNUM_NOTU };
