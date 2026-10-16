import { belgeDiliNormalize, ciftDilGecerli, type BelgeDili } from "@tekirextra/shared";
import { cevir, type EtiketAnahtari } from "../core/pdf/belge-sozlugu";
import { type TicariBelgeModeli, type TicariBelgeOrtami, bicimleyiciler, ticariBelgeHtml } from "../core/pdf/ticari-belge";

/**
 * KSB-09 tahsilat/tediye makbuzu; FTR-37/39 ile ortak kurumsal düzende
 * basılır. Ödeme şekli hareketin hesabından türer (kasa → nakit, banka →
 * havale/EFT, POS → kredi kartı); dil carinin belge dilidir.
 */
export interface MakbuzVerisi {
  id: string;
  tip: string;
  tarih: Date | string;
  makbuzNo?: string | null;
  aciklama?: string | null;
  tutar: string | number | { toString(): string };
  tutarTry?: string | number | { toString(): string } | null;
  kur?: string | number | { toString(): string } | null;
  dovizCinsi: string;
  kasa?: { ad: string } | null;
  bankaHesap?: { ad: string } | null;
  posHesap?: { ad: string } | null;
  cari?: { kod?: string | null; unvan: string; belgeDili?: string | null; belgeCiftDil?: boolean | null } | null;
  fatura?: { no: string | null } | null;
}

export function makbuzPdfModeli(h: MakbuzVerisi): TicariBelgeModeli {
  const tahsilat = h.tip === "tahsilat";
  const dil: BelgeDili = belgeDiliNormalize(h.cari?.belgeDili);
  const ciftDil = ciftDilGecerli(dil, h.cari?.belgeCiftDil);
  const degerDili: BelgeDili = ciftDil ? "tr" : dil;
  const bic = bicimleyiciler(dil, ciftDil);
  const ikiDilde = (k: EtiketAnahtari) => ciftDil ? `${cevir(k, "tr")} / ${cevir(k, dil)}` : cevir(k, dil);
  const odemeSekli: EtiketAnahtari = h.posHesap ? "odemeSekli.kredi_karti" : h.bankaHesap ? "odemeSekli.havale" : "odemeSekli.nakit";
  const hesap = h.kasa?.ad ?? h.bankaHesap?.ad ?? h.posHesap?.ad ?? "—";
  // KSB-09: seri-sıra numarası; numara almayan eski iç fişlerde kayıt kimliği.
  const no = h.makbuzNo ?? `MKB-${String(h.id).slice(0, 8).toUpperCase()}`;
  const tarih = h.tarih instanceof Date ? h.tarih.toISOString().slice(0, 10) : String(h.tarih).slice(0, 10);
  const tutar = String(h.tutar);
  return {
    tur: "makbuz",
    baslik: tahsilat ? "baslik.tahsilat" : "baslik.tediye",
    dil,
    ciftDil,
    taslak: false,
    belgeNo: no,
    kunye: [{ etiket: "tarih", deger: bic.tarih(tarih) }],
    taraf: { etiket: "sayin", unvan: h.cari?.unvan ?? "—", satirlar: [h.cari?.kod ?? ""] },
    bilgiler: [
      { etiket: "odemeSekli", deger: ikiDilde(odemeSekli) },
      { etiket: "kasa", deger: hesap },
      { etiket: "doviz", deger: h.dovizCinsi === "TRY" ? "TL" : `${h.dovizCinsi}${h.kur ? ` · ${bic.fiyat(String(h.kur))}` : ""}` },
    ],
    doviz: h.dovizCinsi,
    kalemler: [],
    ozelTablo: {
      sutunlar: [
        { etiket: "aciklama", agirlik: 52 },
        { etiket: "belgeNo", agirlik: 26 },
        { etiket: "tutar", say: true, agirlik: 22 },
      ],
      satirlar: [[
        h.aciklama || cevir(tahsilat ? "baslik.tahsilat" : "baslik.tediye", degerDili),
        h.fatura?.no ?? "—",
        `${bic.para(tutar)} ${h.dovizCinsi === "TRY" ? "TL" : h.dovizCinsi}`,
      ]],
    },
    toplamlar: [],
    genelToplam: tutar,
    genelEtiket: tahsilat ? "tahsilEdilen" : "odenen",
    notlar: [],
    bankalar: [],
    imzalar: tahsilat ? ["imza.odeyen", "imza.tahsilEden"] : ["imza.odeyen", "imza.teslimAlan"],
    dovizKarsiligi: h.dovizCinsi !== "TRY" && h.kur && h.tutarTry
      ? { kur: String(h.kur), satirlar: [{ etiket: tahsilat ? "tahsilEdilen" : "odenen", deger: String(h.tutarTry) }] }
      : undefined,
  };
}

export function makbuzPdfHtml(h: MakbuzVerisi, ortam: TicariBelgeOrtami): { html: string; altBilgi: string } {
  return ticariBelgeHtml(makbuzPdfModeli(h), ortam);
}
