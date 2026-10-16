import { belgeNoMetni, ciftDilGecerli, ilgiliKisiMetni, TESLIM_SARTLARI, type BelgeDili } from "@tekirextra/shared";
import { type TicariBelgeModeli, type TicariBelgeOrtami, type TicariBelgeToplami, bicimleyiciler, ticariBelgeHtml, vergiDairesiMetni } from "../core/pdf/ticari-belge";
import { cevir, type EtiketAnahtari, odemeMetni, teslimSekliMetni } from "../core/pdf/belge-sozlugu";
import type { TicariBelgeTuru } from "../core/pdf/belge-gorunumu";

/**
 * Zincir belgeleri PDF'i (FTR-12, T-02; kağıt/PDF irsaliye). Yerleşim
 * FTR-37/38'in ortak kurumsal düzenidir (`core/pdf/ticari-belge.ts`); bu
 * dosya yalnız teklif/sipariş/irsaliye verisini o düzenin modeline çevirir.
 */

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
  /** FTR-39: irsaliyenin taşıma bilgileri (EBLG-23/84). */
  fiiliSevkZamani?: string | null;
  plaka?: string | null;
  dorsePlaka?: string | null;
  soforAdi?: string | null;
  soforSoyadi?: string | null;
  tasiyiciUnvan?: string | null;
  teslimatAdres?: string | null;
  teslimatIl?: string | null;
  teslimatIlce?: string | null;
  teslimatPostaKodu?: string | null;
  /** FTR-40: basım dili; çift dilde Türkçe + bu dil. */
  belgeDili?: BelgeDili;
  ciftDil?: boolean;
  dovizCinsi: string;
  kur: string;
  toplamBrut: string;
  toplamSatirIskontosu: string;
  genelIskontoToplam: string;
  toplamMatrah: string;
  toplamKdv: string;
  genelToplam: string;
  aciklama: string | null;
  cari: {
    kod: string;
    unvan: string;
    vknTckn: string | null;
    vergiDairesi?: string | null;
    adres?: { adres: string; il?: string | null; ilce?: string | null; postaKodu?: string | null; ulke?: string | null } | null;
  };
  satirlar: {
    stokKod: string;
    stokAd: string;
    satirKod?: string;
    satirAd?: string;
    satirAciklama?: string;
    /** STK-41: kartın belge dilindeki adı ve açıklaması. */
    yabanciAd?: string | null;
    yabanciAciklama?: string | null;
    miktar: string;
    birim: string;
    birimFiyat: string;
    iskontoOrani: string;
    kdvOrani: string;
    toplamTutar: string;
    /** EBLG-132: satırın KDV dışı vergileri (NULL = özellikten önceki satır). */
    ekVergiler?: { kod?: string; ad: string; tutar: string; stopaj: boolean; kdvMatrahinaDahil?: boolean }[] | null;
  }[];
  /** FTR-39: "belgelerde göster" işaretli banka hesapları; belge dövizindekiler önce. */
  bankalar?: { bankaAdi: string; sube?: string | null; iban: string; swift?: string | null; doviz: string }[];
}

const IMZALAR: Record<string, EtiketAnahtari[]> = {
  teklif: ["imza.hazirlayan", "imza.kase", "imza.musteriOnayi"],
  siparis: ["imza.hazirlayan", "imza.kase", "imza.musteriOnayi"],
  irsaliye: ["imza.teslimEden", "imza.teslimAlan"],
};

/** Ülke kodunun belge dilindeki adı (TR yazılmaz). */
function ulkeAdi(kod: string | null | undefined, dil: BelgeDili): string | null {
  if (!kod || kod === "TR") return null;
  try {
    return new Intl.DisplayNames([dil === "ar" ? "ar" : dil], { type: "region" }).of(kod) ?? kod;
  } catch {
    return kod;
  }
}

/** Toplam satırları: iskonto, KDV matrahına dahil vergiler (EBLG-130 sırası), KDV, diğer vergiler ve stopaj. */
function toplamSatirlari(b: BelgePdfVerisi, dil: BelgeDili): TicariBelgeToplami[] {
  const vergiler = new Map<string, { ad: string; stopaj: boolean; dahil: boolean; tutar: number }>();
  for (const v of b.satirlar.flatMap((s) => s.ekVergiler ?? [])) {
    const anahtar = v.kod ?? v.ad;
    const m = vergiler.get(anahtar) ?? { ad: v.ad, stopaj: v.stopaj, dahil: v.kdvMatrahinaDahil === true && !v.stopaj, tutar: 0 };
    m.tutar = Math.round((m.tutar + Number(v.tutar)) * 100) / 100;
    vergiler.set(anahtar, m);
  }
  const vergiSatirlari = (dahil: boolean): TicariBelgeToplami[] => [...vergiler.values()]
    .filter((v) => v.dahil === dahil && v.tutar > 0)
    .map((v) => ({ etiket: { metin: v.ad }, ek: v.stopaj ? cevir("stopaj", dil) : undefined, deger: v.tutar, eksi: v.stopaj }));
  const dahilToplam = [...vergiler.values()].filter((v) => v.dahil).reduce((t, v) => t + v.tutar, 0);
  const iskonto = Number(b.toplamSatirIskontosu) + Number(b.genelIskontoToplam);
  const oranlar = [...new Set(b.satirlar.map((s) => Number(s.kdvOrani)))];
  const satirlar: TicariBelgeToplami[] = [];
  if (iskonto > 0) {
    satirlar.push({ etiket: "araToplam", deger: b.toplamBrut }, { etiket: "iskonto", deger: iskonto, eksi: true });
  }
  if (dahilToplam > 0) {
    satirlar.push({ etiket: "malHizmetToplami", deger: b.toplamMatrah }, ...vergiSatirlari(true),
      { etiket: "kdvMatrahi", deger: (Number(b.toplamMatrah) + dahilToplam).toFixed(2) });
  } else {
    satirlar.push({ etiket: "kdvMatrahi", deger: b.toplamMatrah });
  }
  satirlar.push({ etiket: "hesaplananKdv", ek: oranlar.length === 1 ? `%${oranlar[0]}` : undefined, deger: b.toplamKdv }, ...vergiSatirlari(false));
  return satirlar;
}

/** FTR-39: irsaliyede sevk zamanı, araç, şoför, taşıyıcı ve teslim yeri. */
function tasimaBilgileri(b: BelgePdfVerisi, bic: ReturnType<typeof bicimleyiciler>): TicariBelgeModeli["bilgiler"] {
  const sevk = b.fiiliSevkZamani ? new Date(b.fiiliSevkZamani) : null;
  const saat = sevk ? sevk.toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }) : "";
  const gun = sevk ? sevk.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }) : "";
  const teslimYeri = b.teslimatAdres
    ? `${b.teslimatAdres}${b.teslimatPostaKodu ? ` ${b.teslimatPostaKodu}` : ""}${b.teslimatIlce || b.teslimatIl ? ` ${[b.teslimatIlce, b.teslimatIl].filter(Boolean).join("/")}` : ""}`
    : "";
  return [
    { etiket: "sevkTarihi", deger: sevk ? `${bic.tarih(gun)} ${saat}` : "" },
    { etiket: "tasiyici", deger: b.tasiyiciUnvan ?? "" },
    { etiket: "plaka", deger: [b.plaka, b.dorsePlaka].filter(Boolean).join(" / "), mono: true },
    { etiket: "sofor", deger: [b.soforAdi, b.soforSoyadi].filter(Boolean).join(" ") },
    { etiket: "teslimYeri", deger: teslimYeri },
  ];
}

export function belgePdfModeli(b: BelgePdfVerisi, kopya = false): TicariBelgeModeli {
  const dil = b.belgeDili ?? "tr";
  const ciftDil = ciftDilGecerli(dil, b.ciftDil);
  // Çift dilde değerler (tarih, ödeme metni) Türkçe yazılır; etiketler iki dilde.
  const degerDili: BelgeDili = ciftDil ? "tr" : dil;
  const bic = bicimleyiciler(dil, ciftDil);
  /** Değerin içine giren kısa etiket ("VKN: …"); çift dilde iki dilde. */
  const etiket = (k: EtiketAnahtari) => ciftDil ? `${cevir(k, "tr")} / ${cevir(k, dil)}` : cevir(k, dil);
  const tur = b.tur as TicariBelgeTuru;
  const baslik = `baslik.${b.tur}.${b.yon}` as EtiketAnahtari;
  // Numarasız belge: taslak ya da numarası gönderimde verilecek e-İrsaliye.
  const belgeNo = b.no ?? cevir(b.durum === "taslak" ? "taslakNo" : "eirsaliyeNo", degerDili);

  const tarihli = (no: string | null | undefined, tarih: string | null | undefined) =>
    no ? `${no}${tarih ? ` (${bic.tarih(tarih)})` : ""}` : "";
  /** Hazır seçenekler (ödeme, Incoterms) çevrilir; çift dilde iki dilde yazılır. */
  const ikiDilde = (uret: (d: BelgeDili) => string) => ciftDil ? `${uret("tr")} / ${uret(dil)}` : uret(dil);
  const trTeslimAdi = TESLIM_SARTLARI.find((t) => t.kod === b.teslimSekli)?.ad;
  const teslimSekli = b.teslimSekli
    ? ikiDilde((d) => d === "tr" || !ciftDil ? teslimSekliMetni(b.teslimSekli!, d, trTeslimAdi) : teslimSekliMetni(b.teslimSekli!, d, trTeslimAdi).replace(`${b.teslimSekli} — `, ""))
    : "";
  const adres = b.cari.adres;
  const ulke = ulkeAdi(adres?.ulke, degerDili);
  const adresSatiri = adres
    ? [adres.adres, [adres.postaKodu, [adres.ilce, adres.il].filter(Boolean).join(" / ")].filter(Boolean).join(" "), ulke].filter(Boolean).join(", ")
    : "";

  const kalemler = b.satirlar.map((s) => {
    const vergiNotu = s.ekVergiler?.length
      ? s.ekVergiler.map((v) => `${v.ad}${v.stopaj ? " (stopaj)" : ""}: ${bic.para(v.tutar)}`).join(" · ")
      : null;
    return {
      kod: s.satirKod ?? s.stokKod,
      ad: s.satirAd ?? s.stokAd,
      yabanciAd: dil === "tr" ? null : s.yabanciAd,
      aciklama: [s.satirAciklama, dil === "tr" ? null : s.yabanciAciklama].filter(Boolean).join(" · ") || null,
      ekBilgi: vergiNotu,
      miktar: s.miktar,
      birim: s.birim,
      birimFiyat: s.birimFiyat,
      iskontoOrani: s.iskontoOrani,
      kdvOrani: s.kdvOrani,
      tutar: s.toplamTutar,
    };
  });

  return {
    tur,
    baslik,
    dil,
    ciftDil,
    taslak: b.durum === "taslak",
    kopya,
    uyari: b.durum === "revize_edildi" ? "revizeEdildi" : null,
    belgeNo,
    kunye: [
      { etiket: "tarih", deger: bic.tarih(b.tarih) },
      ...(b.tur === "teklif" && b.gecerlilikTarihi ? [{ etiket: "gecerlilik" as const, deger: bic.tarih(b.gecerlilikTarihi) }] : []),
      ...(b.revizyonNo ? [{ etiket: "revizyon" as const, deger: belgeNoMetni("", b.revizyonNo).trim() }] : []),
      ...(b.matbuBelgeNo ? [{ etiket: "matbuNo" as const, deger: b.matbuBelgeNo, mono: true }] : []),
    ],
    taraf: {
      etiket: b.yon === "alis" ? "tedarikci" : "sayin",
      unvan: b.cari.unvan,
      satirlar: [
        adresSatiri,
        b.cari.vknTckn ? `${etiket("vkn")}: ${b.cari.vknTckn}${b.cari.vergiDairesi ? ` · ${vergiDairesiMetni(b.cari.vergiDairesi, etiket("vergiDairesi"))}` : ""}` : "",
      ],
    },
    bilgiler: [
      { etiket: "ilgili", deger: ilgiliKisiMetni(b) ?? "" },
      { etiket: "talepRef", deger: tarihli(b.talepNo, b.talepTarihi) },
      { etiket: "siparisRef", deger: tarihli(b.siparisNo, b.siparisTarihi) },
      { etiket: "doviz", deger: b.dovizCinsi === "TRY" ? "TL" : `${b.dovizCinsi} · ${bic.fiyat(b.kur)}` },
      { etiket: "odeme", deger: b.odemeVadeGun != null ? ikiDilde((d) => odemeMetni(b.odemeVadeGun!, d)) : "" },
      { etiket: "teslimSekli", deger: teslimSekli },
      { etiket: "teslimSuresi", deger: b.teslimSuresi?.trim() ?? "" },
      ...(b.tur === "irsaliye" ? tasimaBilgileri(b, bic) : []),
    ],
    doviz: b.dovizCinsi,
    kalemler,
    toplamlar: toplamSatirlari(b, degerDili),
    genelToplam: b.genelToplam,
    notlar: b.aciklama ? [b.aciklama] : [],
    bankalar: b.yon === "satis" ? (b.bankalar ?? []) : [],
    imzalar: IMZALAR[b.tur] ?? [],
  };
}

/** Belgenin HTML'i ve PDF motoruna verilecek sayfa altı. */
export function belgePdfHtml(b: BelgePdfVerisi, ortam: TicariBelgeOrtami, kopya = false): { html: string; altBilgi: string } {
  return ticariBelgeHtml(belgePdfModeli(b, kopya), ortam);
}
