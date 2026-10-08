import {
  kacis,
  paraBicim,
  sayfaSablonu,
  sayiBicim,
  tarihBicim,
} from "../pdf/pdf-sablon";
import type { BelgeTemasi } from "../pdf/belge-temasi";
import type { RaporSatiri, RaporTanimi } from "./rapor-kayit";

/**
 * Ortak rapor PDF yazıcısı (RPR-04/06): kolon tanımlarından hücre biçimini
 * üretir; tüm raporlar Excel dışa aktarımıyla aynı görsel dille çıkar.
 */
export function raporPdfHtml(
  tanim: RaporTanimi,
  satirlar: RaporSatiri[],
  tema?: BelgeTemasi,
): string {
  return sayfaSablonu({
    baslik: tanim.ad,
    altBaslik: tanim.aciklama,
    icerik: raporTablosuHtml(tanim, satirlar),
    tema,
  });
}

/** Kolon tanımından tek tablo; birden çok tabloyu tek sayfada birleştiren çıktılar için. */
export function raporTablosuHtml(
  tanim: Pick<RaporTanimi, "kolonlar">,
  satirlar: RaporSatiri[],
): string {
  const hucre = (satir: RaporSatiri, kolon: RaporTanimi["kolonlar"][number]) => {
    const deger = satir[kolon.alan];
    if (deger === null || deger === undefined || deger === "") {
      return `<td></td>`;
    }
    switch (kolon.tip) {
      case "para":
        return `<td class="sag">${paraBicim(deger as string | number)}</td>`;
      case "sayi":
        return `<td class="sag">${sayiBicim(deger as string | number)}</td>`;
      case "yuzde":
        return `<td class="sag">%${sayiBicim(deger as string | number)}</td>`;
      case "tarih":
        return `<td class="orta">${tarihBicim(String(deger))}</td>`;
      default:
        return `<td>${kacis(deger)}</td>`;
    }
  };

  const govde =
    satirlar.length === 0
      ? `<tr><td class="orta" colspan="${tanim.kolonlar.length}">Kayıt bulunamadı</td></tr>`
      : satirlar
          .map((s) => `<tr>${tanim.kolonlar.map((k) => hucre(s, k)).join("")}</tr>`)
          .join("\n");

  return `<table class="veri">
  <thead><tr>${tanim.kolonlar
    .map((k) => `<th${["para", "sayi", "yuzde"].includes(k.tip) ? ' class="sag"' : ""}>${kacis(k.baslik)}</th>`)
    .join("")}</tr></thead>
  <tbody>${govde}</tbody>
</table>`;
}

/** 7+ kolonlu raporlar yatay sayfada daha okunur. */
export function raporYatayMi(tanim: RaporTanimi): boolean {
  return tanim.kolonlar.length >= 7;
}
