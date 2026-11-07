/**
 * P1-9: kasa/banka hesap ekstresi. Dönem başı devir, yürüyen bakiye ve dönem
 * sonu bakiyesi saf olarak burada hesaplanır; servis yalnız veriyi okur.
 * Tutarlar hesabın dövizindedir; TL karşılığı her hareketin kendi kuruyla
 * (kayıttaki `tutarTry`) toplanır, değerleme yapılmaz.
 */
import { Prisma } from "@prisma/client";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);

export const girisMi = (tip: string) => tip === "tahsilat" || tip === "virman_gelis";

/** Fişi üreten modül; ekstrede açıklamanın altında küçük yazılır. */
export const KAYNAK_ADLARI: Record<string, string> = {
  fatura_kapama: "Fatura ödemesi",
  masraf: "Masraf",
  faturasiz_gelir: "Faaliyet dışı gelir",
  pos_tahsilat: "POS tahsilatı",
  pos_mutabakat: "POS mutabakatı",
  pos_iade: "POS iadesi",
  cek_senet: "Çek / senet",
  kredi_karti_ekstre: "Kredi kartı",
  odeme_talimati: "Ödeme talimatı",
  pazaryeri_kesinti: "Pazaryeri kesintisi",
  pazaryeri_stopaj: "Pazaryeri stopajı (mahsup edilecek)",
};

export function kaynakAdi(kaynakTur: string): string | null {
  if (kaynakTur.startsWith("personel_")) return "Personel";
  return KAYNAK_ADLARI[kaynakTur] ?? null;
}

/** Ekstrede hareketin adı; açılış ve ters kayıt tipten önce gelir. */
export function islemAdi(h: { tip: string; kaynakTur: string }): string {
  if (h.kaynakTur === "acilis") return "Açılış";
  if (h.kaynakTur === "ters_kayit") return "Ters kayıt";
  // KSB-39: POS hesabı tarafında aktarım ve kesinti ayrı adlandırılır.
  if (h.kaynakTur === "pos_mutabakat" && h.tip === "virman_gidis") return "Bankaya aktarım";
  if (h.kaynakTur === "pos_mutabakat" && h.tip === "tediye") return "Komisyon / kesinti";
  if (h.kaynakTur === "pos_iade") return "İade";
  if (h.tip === "virman_gelis") return "Virman girişi";
  if (h.tip === "virman_gidis") return "Virman çıkışı";
  return h.tip === "tahsilat" ? "Tahsilat" : "Ödeme";
}

export interface EkstreHareketi {
  id: string;
  tarih: Date;
  tip: string;
  tutar: Prisma.Decimal;
  kur: Prisma.Decimal;
  tutarTry: Prisma.Decimal;
  kaynakTur: string;
  makbuzNo: string | null;
  aciklama: string | null;
  cari: string | null;
  belge: string | null;
  /** Virmanın karşı hesabı. */
  karsiHesap: string | null;
}

/** Dönem başından önceki hareketlerin tip bazında toplamı. */
export interface DevirGrubu {
  tip: string;
  tutar: Prisma.Decimal | null;
  tutarTry: Prisma.Decimal | null;
}

export function hesapEkstresiHesapla(devirGruplari: DevirGrubu[], hareketler: EkstreHareketi[]) {
  let devir = D(0);
  let devirTry = D(0);
  for (const g of devirGruplari) {
    const isaret = girisMi(g.tip) ? 1 : -1;
    devir = devir.add(D(g.tutar ?? 0).mul(isaret));
    devirTry = devirTry.add(D(g.tutarTry ?? 0).mul(isaret));
  }

  let bakiye = devir;
  let giris = D(0);
  let cikis = D(0);
  let girisTry = D(0);
  let cikisTry = D(0);
  const satirlar = hareketler.map((h) => {
    const g = girisMi(h.tip);
    bakiye = g ? bakiye.add(h.tutar) : bakiye.sub(h.tutar);
    if (g) { giris = giris.add(h.tutar); girisTry = girisTry.add(h.tutarTry); }
    else { cikis = cikis.add(h.tutar); cikisTry = cikisTry.add(h.tutarTry); }
    return {
      id: h.id,
      tarih: h.tarih.toISOString().slice(0, 10),
      makbuzNo: h.makbuzNo,
      islem: islemAdi(h),
      tip: h.tip,
      kaynakTur: h.kaynakTur,
      kaynak: kaynakAdi(h.kaynakTur),
      aciklama: h.aciklama,
      cari: h.cari,
      belge: h.belge,
      karsiHesap: h.karsiHesap,
      giris: g ? h.tutar.toFixed(2) : null,
      cikis: g ? null : h.tutar.toFixed(2),
      kur: h.kur.toFixed(6),
      tutarTry: (g ? h.tutarTry : h.tutarTry.negated()).toFixed(2),
      bakiye: bakiye.toFixed(2),
    };
  });

  return {
    devir: devir.toFixed(2),
    devirTry: devirTry.toFixed(2),
    giris: giris.toFixed(2),
    cikis: cikis.toFixed(2),
    girisTry: girisTry.toFixed(2),
    cikisTry: cikisTry.toFixed(2),
    donemSonu: bakiye.toFixed(2),
    donemSonuTry: devirTry.add(girisTry).sub(cikisTry).toFixed(2),
    satirlar,
  };
}
