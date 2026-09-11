/**
 * Nakit akışı tahmininin saf hesap katmanı (NAK-02, NAK-09, NAK-11, NAK-12).
 *
 * Veritabanına dokunmaz: kalemleri senaryoya göre tarihler, günlük bakiyeyi
 * yürütür ve döneme böler. Tarihler "YYYY-MM-DD" metni olarak taşınır; takvim
 * günü aritmetiği UTC üzerinden yapılır ki saat dilimi bir günü kaydırmasın.
 * Tutarlar kuruş cinsinden tamsayıdır; kayan noktalı toplama yüzlerce kalemde
 * kuruş kaydırır.
 */

export type Senaryo = "iyimser" | "baz" | "kotumser";
export const SENARYOLAR: Senaryo[] = ["iyimser", "baz", "kotumser"];
export type Ufuk = 7 | 30 | 90;

export type KalemKaynak =
  | "fatura"
  | "cek_senet"
  | "masraf"
  | "kira"
  | "kart_taksit"
  | "bordro"
  | "tekrarlayan_fatura"
  | "odeme_talimati";

export interface NakitKalemi {
  kaynak: KalemKaynak;
  kaynakId: string;
  yon: "giris" | "cikis";
  /** Belgedeki vade ya da ödeme tarihi. */
  vade: string;
  /** TL karşılığı, kuruş. */
  kurus: number;
  dovizCinsi: string;
  dovizTutar: number;
  aciklama: string;
  cariId: string | null;
  cariUnvan: string | null;
  /** Henüz belgesi olmayan kalem (bordro tekrarı, tekrarlayan fatura). */
  tahmin: boolean;
  /** Müşteriden tahsilat: senaryoya göre kaydırılır (NAK-09). */
  tahsilat: boolean;
  /** Kaynak kayda giden ekran yolu (NAK-11). */
  baglanti: string | null;
}

export interface CariTahsilatProfili {
  /** Tutar ağırlıklı ortalama tahsilat gecikmesi; geçmiş yetersizse null (CARI-20). */
  gecikmeGun: number | null;
  karaListe: boolean;
}

export interface SenaryoTarihi {
  /** Kalemin bu senaryodaki tarihi; tahsilat ufuk dışı sayıldıysa null. */
  tarih: string | null;
  neden: string | null;
}

export interface Donem {
  baslangic: string;
  bitis: string;
  giris: number;
  cikis: number;
  net: number;
  bakiye: number;
}

export interface SenaryoSonucu {
  donemler: Donem[];
  toplamGiris: number;
  toplamCikis: number;
  sonBakiye: number;
  ilkEksi: { tarih: string; bakiye: number } | null;
  enDusuk: { tarih: string; bakiye: number };
  /** İyimser senaryoda ufka giren ama bu senaryoda dışarı itilen tahsilatlar. */
  kaydirilanTahsilat: { adet: number; tutar: number };
}

export type TarihliKalem = NakitKalemi & { tarihler: Record<Senaryo, SenaryoTarihi> };

export interface TahminSonucu {
  bugun: string;
  ufukGun: Ufuk;
  ufukSonu: string;
  donemTipi: "gun" | "hafta";
  senaryolar: Record<Senaryo, SenaryoSonucu>;
  kalemler: TarihliKalem[];
}

/** Kötümser senaryoda vadesi bundan fazla geçmiş alacak tahsil edilmeyecek sayılır. */
export const KOTUMSER_ESIK_GUN = 90;

export function gunEkle(tarih: string, gun: number): string {
  const d = new Date(`${tarih}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + gun);
  return d.toISOString().slice(0, 10);
}

/** `b - a`, gün. */
export function gunFarki(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000);
}

export const kurusa = (tl: number) => Math.round(tl * 100);
const tl = (kurus: number) => kurus / 100;

/**
 * Kalemin senaryodaki tarihi. Borçlar ve tahsilat olmayan girişler her
 * senaryoda vadesindedir; yalnız müşteri tahsilatları kaydırılır. Vadesi
 * geçmiş kalem en erken bugüne düşer.
 */
export function senaryoTarihi(
  kalem: Pick<NakitKalemi, "vade" | "tahsilat">,
  senaryo: Senaryo,
  profil: CariTahsilatProfili | undefined,
  bugun: string,
): SenaryoTarihi {
  const bugune = (tarih: string, neden: string | null): SenaryoTarihi =>
    tarih < bugun
      ? { tarih: bugun, neden: neden ? `${neden}; tarihi geçtiği için bugüne alındı` : "Vadesi geçmiş; bugüne alındı" }
      : { tarih, neden };

  if (!kalem.tahsilat || senaryo === "iyimser") return bugune(kalem.vade, null);

  if (senaryo === "kotumser") {
    if (profil?.karaListe) return { tarih: null, neden: "Cari kara listede; tahsilat ufuk dışı sayıldı" };
    if (gunFarki(kalem.vade, bugun) > KOTUMSER_ESIK_GUN) {
      return { tarih: null, neden: `Vadesi ${KOTUMSER_ESIK_GUN} günden fazla geçmiş; tahsilat ufuk dışı sayıldı` };
    }
  }

  if (profil?.gecikmeGun == null) return bugune(kalem.vade, "Tahsilat geçmişi yetersiz; vadesinde sayıldı");
  if (profil.gecikmeGun === 0) return bugune(kalem.vade, null);
  const gun = senaryo === "baz" ? profil.gecikmeGun : profil.gecikmeGun * 2;
  const neden =
    senaryo === "baz"
      ? `Carinin ortalama tahsilat gecikmesi ${profil.gecikmeGun} gün`
      : `Ortalama gecikmenin iki katı (${gun} gün)`;
  return bugune(gunEkle(kalem.vade, gun), neden);
}

export function nakitTahmini(girdi: {
  bugun: string;
  ufukGun: Ufuk;
  baslangicKurus: number;
  kalemler: NakitKalemi[];
  profiller: Map<string, CariTahsilatProfili>;
}): TahminSonucu {
  const { bugun, ufukGun, baslangicKurus } = girdi;
  const ufukSonu = gunEkle(bugun, ufukGun - 1);
  const donemTipi = ufukGun === 90 ? "hafta" : "gun";

  const kalemler: TarihliKalem[] = girdi.kalemler.map((kalem) => {
    const profil = kalem.cariId ? girdi.profiller.get(kalem.cariId) : undefined;
    const tarihler = Object.fromEntries(
      SENARYOLAR.map((s) => [s, senaryoTarihi(kalem, s, profil, bugun)]),
    ) as Record<Senaryo, SenaryoTarihi>;
    return { ...kalem, tarihler };
  });

  const senaryolar = {} as Record<Senaryo, SenaryoSonucu>;
  for (const senaryo of SENARYOLAR) {
    const gunluk = new Map<string, { giris: number; cikis: number }>();
    let kaydirilanAdet = 0;
    let kaydirilanKurus = 0;
    for (const kalem of kalemler) {
      const tarih = kalem.tarihler[senaryo].tarih;
      if (tarih === null || tarih > ufukSonu) {
        const iyimser = kalem.tarihler.iyimser.tarih;
        if (kalem.tahsilat && iyimser !== null && iyimser <= ufukSonu) {
          kaydirilanAdet += 1;
          kaydirilanKurus += kalem.kurus;
        }
        continue;
      }
      const gun = gunluk.get(tarih) ?? { giris: 0, cikis: 0 };
      gun[kalem.yon] += kalem.kurus;
      gunluk.set(tarih, gun);
    }

    let bakiye = baslangicKurus;
    let ilkEksi: SenaryoSonucu["ilkEksi"] = null;
    let enDusuk = { tarih: bugun, bakiye: baslangicKurus };
    let toplamGiris = 0;
    let toplamCikis = 0;
    const gunler: { tarih: string; giris: number; cikis: number; bakiye: number }[] = [];
    for (let i = 0; i < ufukGun; i += 1) {
      const tarih = gunEkle(bugun, i);
      const { giris, cikis } = gunluk.get(tarih) ?? { giris: 0, cikis: 0 };
      bakiye += giris - cikis;
      toplamGiris += giris;
      toplamCikis += cikis;
      gunler.push({ tarih, giris, cikis, bakiye });
      if (bakiye < 0 && !ilkEksi) ilkEksi = { tarih, bakiye };
      if (bakiye < enDusuk.bakiye) enDusuk = { tarih, bakiye };
    }

    const adim = donemTipi === "hafta" ? 7 : 1;
    const donemler: Donem[] = [];
    for (let i = 0; i < gunler.length; i += adim) {
      const parca = gunler.slice(i, i + adim);
      const giris = parca.reduce((t, g) => t + g.giris, 0);
      const cikis = parca.reduce((t, g) => t + g.cikis, 0);
      donemler.push({
        baslangic: parca[0].tarih,
        bitis: parca[parca.length - 1].tarih,
        giris: tl(giris),
        cikis: tl(cikis),
        net: tl(giris - cikis),
        bakiye: tl(parca[parca.length - 1].bakiye),
      });
    }

    senaryolar[senaryo] = {
      donemler,
      toplamGiris: tl(toplamGiris),
      toplamCikis: tl(toplamCikis),
      sonBakiye: tl(bakiye),
      ilkEksi: ilkEksi ? { tarih: ilkEksi.tarih, bakiye: tl(ilkEksi.bakiye) } : null,
      enDusuk: { tarih: enDusuk.tarih, bakiye: tl(enDusuk.bakiye) },
      kaydirilanTahsilat: { adet: kaydirilanAdet, tutar: tl(kaydirilanKurus) },
    };
  }

  kalemler.sort((a, b) => (a.tarihler.baz.tarih ?? "9999").localeCompare(b.tarihler.baz.tarih ?? "9999") || a.vade.localeCompare(b.vade));
  return { bugun, ufukGun, ufukSonu, donemTipi, senaryolar, kalemler };
}
