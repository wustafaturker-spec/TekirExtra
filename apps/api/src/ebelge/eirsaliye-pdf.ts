import { kacis, sayfaSablonu, sayiBicim, tarihBicim } from "../core/pdf/pdf-sablon";
import type { UblIrsaliye } from "./eirsaliye-ubl-oku";

/**
 * EBLG-33 yedek görünümü: gelen e-İrsaliyede gömülü XSLT yoksa ya da
 * uygulanamadıysa belge UBL'den okunan alanlarla basılır. Bu, gönderenin
 * tasarladığı resmî görünüm değildir; çıktı bunu açıkça söyler.
 */

const YEDEK_NOTU =
  "Bu görünüm, belgede gönderenin görünüm şablonu bulunmadığı için TekirExtra tarafından belgenin verilerinden oluşturulmuştur.";

const satirIfSatir = (etiket: string, deger: string) => (deger ? `${etiket}: ${kacis(deger)}<br>` : "");

export function eirsaliyeYedekPdfHtml(r: UblIrsaliye, secenekler: { logoDataUri?: string } = {}): string {
  const satirlar = r.satirlar
    .map(
      (s) => `<tr>
  <td class="orta">${kacis(s.sira)}</td>
  <td>${kacis(s.stokKodu)}</td>
  <td>${kacis(s.ad)}${s.aciklama ? `<br><small>${kacis(s.aciklama)}</small>` : ""}</td>
  <td class="sag">${s.miktar && Number.isFinite(Number(s.miktar)) ? sayiBicim(Number(s.miktar)) : kacis(s.miktar)}</td>
  <td>${kacis(s.birimAdi || s.birim)}</td>
</tr>`,
    )
    .join("\n");

  const tasima = [
    r.tasiyici ? satirIfSatir("Taşıyıcı", [r.tasiyici.unvan, r.tasiyici.vknTckn].filter(Boolean).join(" — ")) : "",
    satirIfSatir("Plaka", [r.plaka, r.dorsePlaka].filter(Boolean).join(" / ")),
    satirIfSatir("Şoför", r.sofor),
  ].join("");

  const icerik = `
<table style="width:100%;margin-bottom:12px;font-size:9pt">
  <tr>
    <td style="vertical-align:top;width:50%">
      <div class="kutu">
        <strong>${kacis(r.gonderen.unvan)}</strong><br>
        ${satirIfSatir("VKN/TCKN", r.gonderen.vknTckn)}${kacis(r.gonderen.adres)}
      </div>
    </td>
    <td style="width:4%"></td>
    <td style="vertical-align:top;width:46%">
      <div class="kutu">
        <strong>Sayın ${kacis(r.alici.unvan)}</strong><br>
        ${satirIfSatir("VKN/TCKN", r.alici.vknTckn)}
        İrsaliye No: <strong>${kacis(r.belgeNo)}</strong><br>
        Tarih: ${r.tarih ? tarihBicim(r.tarih) : ""}${r.saat ? ` ${kacis(r.saat)}` : ""}<br>
        ETTN: ${kacis(r.uuid)}<br>
        Senaryo: ${kacis(r.profilId)} &nbsp;•&nbsp; Tip: ${kacis(r.tipKodu)}
      </div>
    </td>
  </tr>
</table>
<table style="width:100%;margin-bottom:12px;font-size:9pt">
  <tr>
    <td style="vertical-align:top;width:50%">
      <div class="kutu">
        Fiili sevk: ${r.sevkTarihi ? tarihBicim(r.sevkTarihi) : ""}${r.sevkSaati ? ` ${kacis(r.sevkSaati)}` : ""}<br>
        ${satirIfSatir("Teslimat adresi", r.teslimatAdresi)}
      </div>
    </td>
    <td style="width:4%"></td>
    <td style="vertical-align:top;width:46%">${tasima ? `<div class="kutu">${tasima}</div>` : ""}</td>
  </tr>
</table>
<table class="veri">
  <thead><tr>
    <th>#</th><th>Kod</th><th>Mal / Hizmet</th><th class="sag">Miktar</th><th>Birim</th>
  </tr></thead>
  <tbody>${satirlar}</tbody>
</table>
${r.notlar.length ? `<p style="margin-top:12px;font-size:9pt">${r.notlar.map(kacis).join("<br>")}</p>` : ""}
<p style="margin-top:14px;color:#6b7280;font-size:8pt">${YEDEK_NOTU}</p>`;

  return sayfaSablonu({
    baslik: "e-İRSALİYE",
    altBaslik: `${r.gonderen.unvan} — ${r.belgeNo}`,
    icerik,
    logoDataUri: secenekler.logoDataUri,
  });
}

export { YEDEK_NOTU as EIRSALIYE_YEDEK_GORUNUM_NOTU };
