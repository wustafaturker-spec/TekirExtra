import {
  kacis,
  paraBicim,
  sayfaSablonu,
  sayiBicim,
  tarihBicim,
} from "../pdf/pdf-sablon";
import type { BelgeTemasi } from "../pdf/belge-temasi";
import { type DisaAktarimBilgisi, hucreDovizi, toplamSatiri } from "./rapor-disa-aktarim";
import type { RaporKolon, RaporSatiri, RaporTanimi } from "./rapor-kayit";

/** Dövizli para hücresi birimiyle (RPR-16); TL sütunu eskisi gibi birimsiz. */
const para = (deger: string | number, doviz?: string) =>
  doviz ? `${paraBicim(deger)} ${kacis(doviz === "TRY" ? "TL" : doviz)}` : paraBicim(deger);

/**
 * Ortak rapor PDF yazıcısı (RPR-04/06): kolon tanımlarından hücre biçimini
 * üretir; tüm raporlar Excel dışa aktarımıyla aynı görsel dille çıkar.
 */
export function raporPdfHtml(
  tanim: RaporTanimi,
  satirlar: RaporSatiri[],
  tema?: BelgeTemasi,
  bilgi?: DisaAktarimBilgisi,
): string {
  // RPR-16: firma, dönem ve süzgeçler tablonun üstünde; toplam satırı altta.
  const ozet = bilgi?.bilgiler.length
    ? `<div class="alt-baslik">${bilgi.bilgiler.map(kacis).join(" · ")}</div>`
    : "";
  return sayfaSablonu({
    baslik: tanim.ad,
    altBaslik: [bilgi?.firma, tanim.aciklama].filter(Boolean).join(" — ") || undefined,
    icerik: ozet + raporTablosuHtml(tanim, satirlar, { toplam: true }),
    tema,
  });
}

/** Kolon tanımından tek tablo; birden çok tabloyu tek sayfada birleştiren çıktılar için. */
export function raporTablosuHtml(
  tanim: Pick<RaporTanimi, "kolonlar">,
  satirlar: RaporSatiri[],
  secenek: { toplam?: boolean } = {},
): string {
  const hucre = (satir: RaporSatiri, kolon: RaporKolon) => {
    const deger = satir[kolon.alan];
    if (deger === null || deger === undefined || deger === "") {
      return `<td></td>`;
    }
    switch (kolon.tip) {
      case "para":
        return `<td class="sag">${para(deger as string | number, hucreDovizi(kolon, satir))}</td>`;
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

  const toplamlar = secenek.toplam ? toplamSatiri(tanim.kolonlar, satirlar) : null;
  const ayak = toplamlar
    ? `<tfoot><tr>${tanim.kolonlar
        .map((k, i) => {
          const t = toplamlar.get(k.alan);
          if (t === "karisik") return `<td class="sag"><strong>—</strong></td>`;
          if (t) return `<td class="sag"><strong>${k.tip === "para" ? para(t.deger, t.doviz) : sayiBicim(t.deger)}</strong></td>`;
          return i === 0 ? `<td><strong>Toplam</strong></td>` : `<td></td>`;
        })
        .join("")}</tr></tfoot>`
    : "";

  return `<table class="veri">
  <thead><tr>${tanim.kolonlar
    .map((k) => `<th${["para", "sayi", "yuzde"].includes(k.tip) ? ' class="sag"' : ""}>${kacis(k.baslik)}</th>`)
    .join("")}</tr></thead>
  <tbody>${govde}</tbody>${ayak}
</table>`;
}

/** 7+ kolonlu raporlar yatay sayfada daha okunur. */
export function raporYatayMi(tanim: RaporTanimi): boolean {
  return tanim.kolonlar.length >= 7;
}
