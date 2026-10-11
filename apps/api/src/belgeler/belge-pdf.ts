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
import { belgeNoMetni, ilgiliKisiMetni, kosulSatirlari } from "@tekirextra/shared";

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
  /** EBLG-83: kâğıt irsaliyenin basımevi numarası. */
  matbuBelgeNo?: string | null;
  no: string | null;
  tarih: string;
  gecerlilikTarihi: string | null;
  /** FTR-31: müşterinin talep ve sipariş referansları. */
  talepNo?: string | null;
  talepTarihi?: string | null;
  siparisNo?: string | null;
  siparisTarihi?: string | null;
  /** FTR-32: müşteri tarafında ilgili kişi. */
  ilgiliKisi?: string | null;
  ilgiliKisiGorevi?: string | null;
  /** FTR-34: teklif sürümü; 0 ilk sürüm. */
  revizyonNo?: number;
  /** FTR-33: teklif koşulları. */
  odemeVadeGun?: number | null;
  teslimSuresi?: string | null;
  teslimSekli?: string | null;
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
    satirKod?: string;
    satirAd?: string;
    satirAciklama?: string;
    miktar: string;
    birim: string;
    birimFiyat: string;
    iskontoOrani: string;
    kdvOrani: string;
    toplamTutar: string;
    /** EBLG-132: satırın KDV dışı vergileri (NULL = özellikten önceki satır). */
    ekVergiler?: { kod?: string; ad: string; tutar: string; stopaj: boolean; kdvMatrahinaDahil?: boolean }[] | null;
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
  <td>${kacis(s.satirKod ?? s.stokKod)}</td>
  <td>${kacis(s.satirAd ?? s.stokAd)}${s.satirAciklama ? `<br><span style="color:#6b7280;font-size:8pt">${kacis(s.satirAciklama)}</span>` : ""}${s.ekVergiler?.length ? `<br><span style="color:#6b7280;font-size:8pt">${s.ekVergiler.map((v) => `${kacis(v.ad)}${v.stopaj ? " (stopaj)" : ""}: ${paraBicim(v.tutar)}`).join(" · ")}</span>` : ""}</td>
  <td class="sag">${sayiBicim(s.miktar)} ${kacis(s.birim)}</td>
  <td class="sag">${paraBicim(s.birimFiyat)}</td>
  <td class="sag">${Number(s.iskontoOrani) > 0 ? `%${sayiBicim(s.iskontoOrani)}` : ""}</td>
  <td class="sag">%${sayiBicim(s.kdvOrani)}</td>
  <td class="sag">${paraBicim(s.toplamTutar)}</td>
</tr>`,
    )
    .join("\n");

  // EBLG-132: fatura çıktısındaki sıra (EBLG-130) — KDV matrahına dahil
  // vergiler (ÖTV…) matrahtan önce, diğerleri ve stopaj KDV'den sonra.
  const vergiler = new Map<string, { ad: string; stopaj: boolean; dahil: boolean; tutar: number }>();
  for (const v of b.satirlar.flatMap((s) => s.ekVergiler ?? [])) {
    const anahtar = v.kod ?? v.ad;
    const m = vergiler.get(anahtar) ?? { ad: v.ad, stopaj: v.stopaj, dahil: v.kdvMatrahinaDahil === true && !v.stopaj, tutar: 0 };
    m.tutar = Math.round((m.tutar + Number(v.tutar)) * 100) / 100;
    vergiler.set(anahtar, m);
  }
  const vergiKalemleri = (dahil: boolean) => [...vergiler.values()].filter((v) => v.dahil === dahil && v.tutar > 0)
    .map((v) => ({ etiket: `${kacis(v.ad)}${v.stopaj ? " (stopaj)" : ""}`, deger: v.stopaj ? `-${v.tutar.toFixed(2)}` : v.tutar.toFixed(2), kalin: false }));
  const dahilToplam = [...vergiler.values()].filter((v) => v.dahil).reduce((t, v) => t + v.tutar, 0);
  const toplamlar = [
    ...(dahilToplam > 0
      ? [{ etiket: "Mal/Hizmet Toplamı", deger: b.toplamMatrah, kalin: false }, ...vergiKalemleri(true), { etiket: "KDV Matrahı", deger: (Number(b.toplamMatrah) + dahilToplam).toFixed(2), kalin: false }]
      : [{ etiket: "KDV Matrahı", deger: b.toplamMatrah, kalin: false }]),
    { etiket: "Hesaplanan KDV", deger: b.toplamKdv, kalin: false },
    ...vergiKalemleri(false),
    { etiket: "Genel Toplam", deger: b.genelToplam, kalin: true },
  ].map((k) => `<tr${k.kalin ? ' style="font-weight:bold"' : ""}><td style="padding:3px 8px">${k.etiket}</td><td class="sag" style="padding:3px 8px">${paraBicim(k.deger)} ${paraBirimi}</td></tr>`).join("\n  ");

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
        ${ilgiliKisiMetni(b) ? `İlgili: ${kacis(ilgiliKisiMetni(b)!)}<br>` : ""}
        ${b.cari.vknTckn ? `VKN/TCKN: ${kacis(b.cari.vknTckn)}<br>` : ""}
        Belge No: <strong>${kacis(b.no ? belgeNoMetni(b.no, b.revizyonNo) : (b.durum === "taslak" ? "— TASLAK —" : "— e-İrsaliye gönderiminde verilir —"))}</strong><br>${
          b.durum === "revize_edildi" ? `<strong>Bu sürüm revize edilmiştir, geçerli değildir.</strong><br>` : ""
        }${
          b.matbuBelgeNo ? `Matbu İrsaliye No: <strong>${kacis(b.matbuBelgeNo)}</strong><br>` : ""
        }
        Tarih: ${tarihBicim(b.tarih)}${
          b.gecerlilikTarihi
            ? ` &nbsp;•&nbsp; Geçerlilik: ${tarihBicim(b.gecerlilikTarihi)}`
            : ""
        }${
          b.talepNo ? `<br>Talep Ref.: ${kacis(b.talepNo)}${b.talepTarihi ? ` (${tarihBicim(b.talepTarihi)})` : ""}` : ""
        }${
          b.siparisNo ? `<br>Sipariş Ref.: ${kacis(b.siparisNo)}${b.siparisTarihi ? ` (${tarihBicim(b.siparisTarihi)})` : ""}` : ""
        }${
          b.dovizCinsi !== "TRY"
            ? `<br>Döviz: ${kacis(b.dovizCinsi)} (kur ${sayiBicim(b.kur)})`
            : ""
        }${kosulSatirlari(b).map((satir) => `<br>${kacis(satir)}`).join("")}
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
  ${toplamlar}
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
