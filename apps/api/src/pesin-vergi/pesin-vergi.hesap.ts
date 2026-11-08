import { Prisma } from "@prisma/client";
import type { PesinVergiKaynak, PesinVergiSatiri } from "./pesin-vergi-kaynaklari";

/** GLR-06: dönem özeti ve mahsup bakiyesi; veritabanına bakmaz. */
export interface MahsupKaydi {
  id: string;
  kaynakTur: string;
  kaynakId: string;
  beyannameTuru: string;
  yil: number;
  donem: number | null;
  not: string | null;
  tutarTry: Prisma.Decimal;
  belgeTarihi: Date;
  etiket: string;
}

export const KAYNAK_ADLARI: Record<PesinVergiKaynak, string> = {
  gelir: "Faaliyet dışı gelir",
  fatura: "Satış faturası",
  pazaryeri: "Pazaryeri e-ticaret stopajı",
};

const D0 = () => new Prisma.Decimal(0);
export const satirAnahtari = (s: { kaynakTur: string; kaynakId: string }) => `${s.kaynakTur}:${s.kaynakId}`;
export const satirEtiketi = (s: PesinVergiSatiri) => `${KAYNAK_ADLARI[s.kaynakTur]}${s.belgeNo ? ` · ${s.belgeNo}` : ""} · ${s.tur}`;

function kirilim(satirlar: PesinVergiSatiri[], ad: (s: PesinVergiSatiri) => string) {
  const toplamlar = new Map<string, { adet: number; tutarTry: Prisma.Decimal }>();
  for (const s of satirlar) {
    const t = toplamlar.get(ad(s)) ?? { adet: 0, tutarTry: D0() };
    t.adet += 1;
    t.tutarTry = t.tutarTry.add(s.tutarTry);
    toplamlar.set(ad(s), t);
  }
  return [...toplamlar.entries()]
    .sort(([x], [y]) => x.localeCompare(y, "tr"))
    .map(([baslik, t]) => ({ baslik, adet: t.adet, tutarTry: t.tutarTry.toFixed(2) }));
}

const topla = (satirlar: PesinVergiSatiri[]) => satirlar.reduce((t, s) => t.add(s.tutarTry), D0());

/**
 * `tumSatirlar` tarih süzgeçsizdir: bakiye dönem sonuna kadarki bütün işaretsiz
 * satırları toplar, işaretin kaynağı dönem dışında da olsa kopuk sanılmaz.
 */
export function pesinVergiOzeti(tumSatirlar: PesinVergiSatiri[], mahsuplar: MahsupKaydi[], baslangic: string, bitis: string) {
  const mahsupHaritasi = new Map(mahsuplar.map((m) => [satirAnahtari(m), m]));
  const donem = tumSatirlar.filter((s) => s.tarih >= baslangic && s.tarih <= bitis);
  const isaretli = (s: PesinVergiSatiri) => mahsupHaritasi.has(satirAnahtari(s));
  const satirHaritasi = new Map(tumSatirlar.map((s) => [satirAnahtari(s), s]));

  const kopuklar = mahsuplar.flatMap((m) => {
    const guncel = satirHaritasi.get(satirAnahtari(m));
    if (guncel && guncel.tutarTry.eq(m.tutarTry)) return [];
    return [{
      id: m.id, etiket: m.etiket, belgeTarihi: m.belgeTarihi.toISOString().slice(0, 10), tutarTry: m.tutarTry.toFixed(2),
      neden: guncel ? ("tutar_degisti" as const) : ("kaynak_yok" as const), guncelTutarTry: guncel?.tutarTry.toFixed(2) ?? null,
    }];
  });

  const beyanlar = new Map<string, { beyannameTuru: string; yil: number; donem: number | null; adet: number; tutarTry: Prisma.Decimal }>();
  for (const m of mahsuplar) {
    const anahtar = `${m.yil}|${m.beyannameTuru}|${m.donem ?? ""}`;
    const b = beyanlar.get(anahtar) ?? { beyannameTuru: m.beyannameTuru, yil: m.yil, donem: m.donem, adet: 0, tutarTry: D0() };
    b.adet += 1;
    b.tutarTry = b.tutarTry.add(m.tutarTry);
    beyanlar.set(anahtar, b);
  }

  return {
    baslangic,
    bitis,
    satirlar: donem.map((s) => {
      const m = mahsupHaritasi.get(satirAnahtari(s));
      return {
        kaynakTur: s.kaynakTur, kaynakAdi: KAYNAK_ADLARI[s.kaynakTur], kaynakId: s.kaynakId, tarih: s.tarih, belgeNo: s.belgeNo, cari: s.cari, tur: s.tur,
        matrah: s.matrah?.toFixed(2) ?? null, oran: s.oran, tutar: s.tutar.toFixed(2), dovizCinsi: s.dovizCinsi, kur: s.kur.toString(), tutarTry: s.tutarTry.toFixed(2), yol: s.yol,
        mahsup: m ? { id: m.id, beyannameTuru: m.beyannameTuru, yil: m.yil, donem: m.donem, not: m.not } : null,
      };
    }),
    ozet: {
      donemToplamTry: topla(donem).toFixed(2),
      mahsupEdilenTry: topla(donem.filter(isaretli)).toFixed(2),
      mahsupEdilecekTry: topla(donem.filter((s) => !isaretli(s))).toFixed(2),
      bakiyeTry: topla(tumSatirlar.filter((s) => s.tarih <= bitis && !isaretli(s))).toFixed(2),
    },
    kaynakKirilimi: kirilim(donem, (s) => KAYNAK_ADLARI[s.kaynakTur]),
    turKirilimi: kirilim(donem, (s) => s.tur),
    beyanlar: [...beyanlar.values()]
      .sort((x, y) => y.yil - x.yil || (y.donem ?? 5) - (x.donem ?? 5))
      .map((b) => ({ ...b, tutarTry: b.tutarTry.toFixed(2) })),
    kopuklar,
  };
}
