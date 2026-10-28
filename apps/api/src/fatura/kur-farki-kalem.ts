/**
 * KSB-26: gerçekleşen kur farkı kalemleri dövizli faturayı kapatan her
 * kapamadan türetilir (doğrudan bağlama, birden çok faturaya dağıtım, vadeye
 * göre otomatik denkleştirme, kredi kartı, çek/senet, alış–satış mahsubu).
 * Kalem kimliği kapamanınkidir; faturalama/eşleştirme/kapatma bağı kapamada
 * tutulur. Fark = kapamanın TL değeri − kapanan tutarın fatura kurundaki TL değeri.
 *
 * TL değeri kaynağa göre: kasa/banka fişinin gerçek TL tutarından payı; kart
 * ve aynı dövizli çekte işlem (çekte fiilî tahsil/ödeme) günü TCMB kuru;
 * mahsupta mahsup tarihinin kuru (satış tarafı döviz alış, alış tarafı satış).
 * İade faturasıyla kapama kur farkı doğurmaz.
 */
import { Prisma } from "@prisma/client";
import { kurCoz } from "../doviz/kur-coz";
import { kurFarkiYonu, type KurFarkiYonu } from "./kur-farki-kural";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export type KurFarkiDurumu = "bekleyen" | "islenen";
export type KurFarkiKaynagi = "kasa_banka" | "kredi_karti" | "cek_senet" | "mahsup";

/** KSB-27: asıl faturanın satır grubu; kur farkı bu ağırlıklarla bölünür. */
export interface KurFarkiGrubu {
  kdvOrani: Prisma.Decimal;
  gibIstisnaKodu: string | null;
  tevkifatKodu: string | null;
  /** Tevkifat oranı (pay/payda), yoksa 0. */
  tevkifatOrani: Prisma.Decimal;
  /** Grubun ödenecek tutardaki payı (matrah × (1 + KDV × (1 − tevkifat))). */
  agirlik: Prisma.Decimal;
}

export interface KurFarkiKalemi {
  /** Kapama kimliği (eski alan adı korunur: ekran ve uçlar bu adla gönderir). */
  hareketId: string;
  kaynakTur: KurFarkiKaynagi;
  tarih: string;
  /** Faturanın yönü: tahsilat (satış/alış iadesi) ya da tediye (alış/satış iadesi). */
  tip: "tahsilat" | "tediye";
  hesap: string;
  tutar: string;
  dovizCinsi: string;
  cari: { id: string; kod: string; unvan: string };
  fatura: { id: string; no: string | null; tip: string; dovizCinsi: string; kur: string };
  mahsup: string;
  odemeKuru: string | null;
  kurFarkiTry: string;
  yon: KurFarkiYonu;
  /** Görüntüleme için baskın satırın oranı; fatura satırları `gruplar`dan üretilir. */
  kdvOrani: string;
  gibIstisnaKodu: string | null;
  gruplar: KurFarkiGrubu[];
  /** KSB-28: ihracat faturası ya da fatura adresi yurt dışında; kur farkı faturası kesilmez. */
  yurtDisi: boolean;
  kapandi: boolean;
  kurFarkiFaturasi: { id: string; no: string | null; tip: string; durum: string; tarih: string } | null;
}

export interface KurFarkiSuzgeci {
  durum: KurFarkiDurumu;
  kalemIdleri?: string[];
  baslangic?: string;
  bitis?: string;
}

const gun = (d: Date) => d.toISOString().slice(0, 10);
const SATIS_YONU = new Set(["satis", "alis_iade"]);

/** Faturanın satır grupları ve ödenecek tutardaki ağırlıkları (KSB-27). */
export function kurFarkiGruplari(satirlar: { matrah: Prisma.Decimal; kdvOrani: Prisma.Decimal; gibIstisnaKodu: string | null; tevkifatKodu: string | null; tevkifatPay: number | null; tevkifatPayda: number | null }[]): KurFarkiGrubu[] {
  const gruplar = new Map<string, KurFarkiGrubu>();
  for (const s of satirlar) {
    const t = s.tevkifatKodu && s.tevkifatPay && s.tevkifatPayda ? D(s.tevkifatPay).div(s.tevkifatPayda) : D(0);
    const anahtar = `${s.kdvOrani.toFixed(2)}|${s.gibIstisnaKodu ?? ""}|${s.tevkifatKodu ?? ""}`;
    const odenecek = s.matrah.mul(D(1).add(s.kdvOrani.div(100).mul(D(1).sub(t))));
    const g = gruplar.get(anahtar) ?? { kdvOrani: s.kdvOrani, gibIstisnaKodu: s.gibIstisnaKodu, tevkifatKodu: s.tevkifatKodu, tevkifatOrani: t, agirlik: D(0) };
    g.agirlik = g.agirlik.add(odenecek);
    gruplar.set(anahtar, g);
  }
  return [...gruplar.values()].filter((g) => g.agirlik.gt(0));
}

export async function kurFarkiKalemleri(tx: Tx, tenantId: string, suzgec: KurFarkiSuzgeci): Promise<KurFarkiKalemi[]> {
  const bekleyenKosulu: Prisma.FaturaKapamaWhereInput = {
    kurFarkiKapandi: false,
    OR: [{ kurFarkiFaturaId: null }, { kurFarkiFatura: { durum: "iptal" } }],
  };
  const kapamalar = await tx.faturaKapama.findMany({
    where: {
      ...(suzgec.durum === "bekleyen" ? bekleyenKosulu : { NOT: bekleyenKosulu }),
      ...(suzgec.kalemIdleri ? { id: { in: suzgec.kalemIdleri } } : {}),
      fatura: { dovizCinsi: { not: "TRY" }, durum: "kesin" },
      iadeFaturaId: null,
      cariHareketId: null,
    },
    select: {
      id: true, tutar: true, kaynakTutari: true, kaynakTutariTry: true, kurFarkiKapandi: true, createdAt: true,
      kurFarkiFatura: { select: { id: true, no: true, tip: true, durum: true, tarih: true } },
      kasaBankaHareket: { select: { tip: true, tarih: true, tutar: true, tutarTry: true, dovizCinsi: true, faturaKarsiligi: true, kaynakTur: true, kasa: { select: { ad: true } }, bankaHesap: { select: { ad: true } }, posHesap: { select: { ad: true } } } },
      krediKartiHareket: { select: { tarih: true, tutar: true, krediKarti: { select: { ad: true, dovizCinsi: true } } } },
      cekSenet: { select: { tur: true, portfoyNo: true, yon: true, dovizCinsi: true, ciroCariId: true, olaylar: { where: { geriAlindi: false, geriAlma: false, yeniDurum: { in: ["tahsil_edildi", "odendi", "ciro_edildi"] } }, select: { yeniDurum: true, islemTarihi: true }, orderBy: { islemTarihi: "desc" } } } },
      mahsup: { select: { tarih: true, dovizCinsi: true, geriAlindiAt: true } },
      fatura: {
        select: {
          id: true, no: true, tip: true, dovizCinsi: true, kur: true, ihracatTeslimSarti: true,
          cari: { select: { id: true, kod: true, unvan: true, adresler: { select: { tip: true, ulke: true } } } },
          satirlar: { select: { matrah: true, kdvOrani: true, gibIstisnaKodu: true, tevkifatKodu: true, tevkifatPay: true, tevkifatPayda: true } },
        },
      },
    },
  });

  const kurlar = new Map<string, Prisma.Decimal | null>();
  const kur = async (doviz: string, tarih: Date, tip: "alis" | "satis") => {
    const a = `${doviz}|${gun(tarih)}|${tip}`;
    if (!kurlar.has(a)) kurlar.set(a, await kurCoz(tx, tenantId, doviz, tarih, tip));
    return kurlar.get(a)!;
  };

  const sonuc: KurFarkiKalemi[] = [];
  for (const k of kapamalar) {
    const f = k.fatura;
    const satisYonu = SATIS_YONU.has(f.tip);
    let tl: Prisma.Decimal | null = null;
    let tarih: Date | null = null;
    let kaynakTur: KurFarkiKaynagi;
    let hesap = "—";
    let odemeTutari = k.kaynakTutari ?? k.tutar;
    let odemeDovizi: string = f.dovizCinsi;

    if (k.kasaBankaHareket) {
      const h = k.kasaBankaHareket;
      if (h.kaynakTur === "ters_kayit") continue;
      kaynakTur = "kasa_banka";
      tarih = h.tarih;
      hesap = h.kasa?.ad ?? h.bankaHesap?.ad ?? h.posHesap?.ad ?? "—";
      odemeDovizi = h.dovizCinsi;
      // Fişin bu faturaya düşen kısmı, fişin kendi dövizinde.
      const pay = k.kaynakTutari
        ?? (h.dovizCinsi === f.dovizCinsi ? k.tutar : h.faturaKarsiligi?.gt(0) ? k.tutar.mul(h.tutar).div(h.faturaKarsiligi) : null);
      if (!pay || !h.tutar.gt(0)) continue;
      odemeTutari = pay.toDecimalPlaces(2);
      tl = k.kaynakTutariTry ?? h.tutarTry.mul(pay).div(h.tutar);
    } else if (k.krediKartiHareket) {
      const h = k.krediKartiHareket;
      kaynakTur = "kredi_karti";
      tarih = h.tarih;
      hesap = h.krediKarti.ad;
      odemeDovizi = h.krediKarti.dovizCinsi;
      if (h.krediKarti.dovizCinsi === "TRY") tl = k.kaynakTutariTry ?? k.kaynakTutari;
      else if (h.krediKarti.dovizCinsi === f.dovizCinsi) { const c = await kur(f.dovizCinsi, h.tarih, "satis"); tl = c ? k.tutar.mul(c) : null; }
    } else if (k.cekSenet) {
      const c = k.cekSenet;
      kaynakTur = "cek_senet";
      hesap = `${c.tur === "cek" ? "Çek" : "Senet"} ${c.portfoyNo}`;
      odemeDovizi = c.dovizCinsi;
      // Fiilî tahsil/ödeme günü; tahsil ya da ödeme olmadan kur farkı doğmaz.
      const beklenen = c.ciroCariId === f.cari.id ? "ciro_edildi" : c.yon === "alinan" ? "tahsil_edildi" : "odendi";
      const olay = c.olaylar.find((o) => o.yeniDurum === beklenen);
      if (!olay) continue;
      tarih = olay.islemTarihi;
      if (c.dovizCinsi === "TRY") tl = k.kaynakTutariTry ?? k.kaynakTutari;
      else if (c.dovizCinsi === f.dovizCinsi) { const r = await kur(f.dovizCinsi, olay.islemTarihi, satisYonu ? "alis" : "satis"); tl = r ? k.tutar.mul(r) : null; }
    } else if (k.mahsup) {
      if (k.mahsup.geriAlindiAt) continue;
      kaynakTur = "mahsup";
      tarih = k.mahsup.tarih;
      hesap = "Alış–satış mahsubu";
      odemeDovizi = k.mahsup.dovizCinsi;
      if (k.kaynakTutari && k.mahsup.dovizCinsi === "TRY") tl = k.kaynakTutariTry ?? k.kaynakTutari;
      else { const r = await kur(f.dovizCinsi, k.mahsup.tarih, satisYonu ? "alis" : "satis"); tl = r ? k.tutar.mul(r) : null; }
    } else continue;

    if (!tl || !tarih) continue;
    if (suzgec.baslangic && gun(tarih) < suzgec.baslangic) continue;
    if (suzgec.bitis && gun(tarih) > suzgec.bitis) continue;
    const fark = tl.sub(k.tutar.mul(f.kur)).toDecimalPlaces(2);
    if (fark.abs().lt(D("0.01"))) continue;
    const tip = satisYonu ? "tahsilat" : "tediye";
    const baskin = [...f.satirlar].sort((a, b) => b.matrah.comparedTo(a.matrah))[0];
    const faturaAdresi = f.cari.adresler.find((a) => a.tip === "fatura") ?? f.cari.adresler[0];
    const kf = k.kurFarkiFatura && k.kurFarkiFatura.durum !== "iptal" ? k.kurFarkiFatura : null;
    sonuc.push({
      hareketId: k.id,
      kaynakTur,
      tarih: gun(tarih),
      tip,
      hesap,
      tutar: odemeTutari.toFixed(2),
      dovizCinsi: odemeDovizi,
      cari: { id: f.cari.id, kod: f.cari.kod, unvan: f.cari.unvan },
      fatura: { id: f.id, no: f.no, tip: f.tip, dovizCinsi: f.dovizCinsi, kur: f.kur.toFixed(4) },
      mahsup: k.tutar.toFixed(2),
      odemeKuru: k.tutar.gt(0) ? tl.div(k.tutar).toFixed(4) : null,
      kurFarkiTry: fark.toFixed(2),
      yon: kurFarkiYonu(tip, fark),
      kdvOrani: (baskin?.kdvOrani ?? D(20)).toFixed(2),
      gibIstisnaKodu: baskin?.gibIstisnaKodu ?? null,
      gruplar: kurFarkiGruplari(f.satirlar),
      yurtDisi: Boolean(f.ihracatTeslimSarti) || Boolean(faturaAdresi && faturaAdresi.ulke && faturaAdresi.ulke !== "TR"),
      kapandi: k.kurFarkiKapandi,
      kurFarkiFaturasi: kf ? { id: kf.id, no: kf.no, tip: kf.tip, durum: kf.durum, tarih: gun(kf.tarih) } : null,
    });
  }
  return sonuc.sort((a, b) => b.tarih.localeCompare(a.tarih));
}
