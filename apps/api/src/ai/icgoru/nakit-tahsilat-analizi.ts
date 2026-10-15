/**
 * AI-23/AI-24: nakit ve tahsilat analizi. Dil modeli kullanılmaz; rakamlar ekran
 * uçlarının döndürdüğü değerlerdir, burada yalnız sınıflandırılır ve özetlenir.
 */

export type IcgoruOnemi = "kritik" | "uyari" | "bilgi";

interface SenaryoOzeti {
  sonBakiye: number;
  ilkEksi: { tarih: string; bakiye: number } | null;
  enDusuk: { tarih: string; bakiye: number };
}

/** `GET /nakit-akisi` yanıtının kullanılan kısmı (TL). */
export interface NakitGirdisi {
  ufukGun: number;
  ufukSonu: string;
  baslangicBakiye: number;
  senaryolar: { baz: SenaryoOzeti; kotumser: SenaryoOzeti };
  uyarilar: string[];
  hesapEsaslari?: { surum?: string };
}

/** `GET /rapor/vadesi-gecenler` yanıtının kullanılan kısmı. */
export interface VadesiGecenGirdisi {
  toplamAlacak: string;
  alacakSayisi: number;
}

/** `GET /cari/vade-hatirlatma/oncelikler` satırı (AI-18). */
export interface OncelikGirdisi {
  cariId: string;
  cariUnvan: string;
  kalanTry: number;
  enEskiGecikmeGun: number;
  faturaSayisi: number;
  puan: number;
  risk: string;
}

export type AnalizBolumu = "nakit" | "vadesiGecenler" | "oncelikler";

export interface AnalizGirdisi {
  nakit: NakitGirdisi | null;
  vadesiGecenler: VadesiGecenGirdisi | null;
  oncelikler: OncelikGirdisi[] | null;
  /** Rolün erişemediği bölümler. */
  erisimYok: AnalizBolumu[];
}

export interface IcgoruBulgusu {
  metin: string;
  baglanti: string | null;
}

export interface IcgoruKaniti {
  kaynak: string;
  aciklama: string;
}

export interface IcgoruIcerigi {
  onem: IcgoruOnemi;
  baslik: string;
  ozet: string;
  metrikler: Record<string, number | string>;
  bulgular: IcgoruBulgusu[];
  kanitlar: IcgoruKaniti[];
  varsayimlar: string[];
  uyarilar: string[];
}

const BOLUM_ADI: Record<AnalizBolumu, string> = {
  nakit: "Nakit akışı tahmini",
  vadesiGecenler: "Vadesi geçen alacaklar",
  oncelikler: "Tahsilat öncelikleri",
};

const ONCELIK_ADEDI = 5;

const tl = (n: number) => `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
const tarih = (t: string) => t.split("-").reverse().join(".");

export class AnalizYapilamadi extends Error {}

export function nakitTahsilatAnalizi(girdi: AnalizGirdisi): IcgoruIcerigi {
  const { nakit, vadesiGecenler, oncelikler } = girdi;
  if (!nakit && !vadesiGecenler && !oncelikler) {
    throw new AnalizYapilamadi("Analiz yapılamadı: nakit akışı, vadesi geçen alacaklar ve tahsilat öncelikleri bu rolle görülemiyor.");
  }

  const metrikler: Record<string, number | string> = {};
  const bulgular: IcgoruBulgusu[] = [];
  const kanitlar: IcgoruKaniti[] = [];
  const varsayimlar: string[] = [];
  const uyarilar = girdi.erisimYok.map((b) => `${BOLUM_ADI[b]} rolünüzle görülemiyor; analize katılmadı.`);
  const ozet: string[] = [];
  let onem: IcgoruOnemi = "bilgi";

  if (nakit) {
    const { baz, kotumser } = nakit.senaryolar;
    metrikler.baslangicBakiye = nakit.baslangicBakiye;
    metrikler.bazSonBakiye = baz.sonBakiye;
    metrikler.kotumserEnDusuk = kotumser.enDusuk.bakiye;
    metrikler.ufukSonu = nakit.ufukSonu;
    kanitlar.push({ kaynak: "GET /nakit-akisi", aciklama: `${nakit.ufukGun} günlük tahmin, ${nakit.hesapEsaslari?.surum ?? "nakit-kapsam"} hesap esası` });
    varsayimlar.push(
      "Baz senaryoda müşteri tahsilatları carinin ortalama gecikmesi kadar kaydırılır.",
      "Kötümser senaryoda gecikme iki katına çıkar; 90 günden eski ve kara listedeki alacaklar tahsil edilmeyecek sayılır.",
    );
    uyarilar.push(...nakit.uyarilar);
    if (baz.ilkEksi) {
      onem = "kritik";
      ozet.push(`Baz senaryoda nakit ${tarih(baz.ilkEksi.tarih)} tarihinde eksiye düşüyor (${tl(baz.ilkEksi.bakiye)}).`);
      bulgular.push({ metin: `Baz senaryoda en düşük bakiye ${tl(baz.enDusuk.bakiye)} (${tarih(baz.enDusuk.tarih)}).`, baglanti: "/panel/nakit-akisi" });
    } else if (kotumser.ilkEksi) {
      onem = "uyari";
      ozet.push(`Kötümser senaryoda nakit ${tarih(kotumser.ilkEksi.tarih)} tarihinde eksiye düşüyor (${tl(kotumser.ilkEksi.bakiye)}); baz senaryoda düşmüyor.`);
      bulgular.push({ metin: `Kötümser senaryoda en düşük bakiye ${tl(kotumser.enDusuk.bakiye)} (${tarih(kotumser.enDusuk.tarih)}).`, baglanti: "/panel/nakit-akisi" });
    } else {
      ozet.push(`${nakit.ufukGun} gün içinde nakit hiçbir senaryoda eksiye düşmüyor; baz senaryo dönem sonu ${tl(baz.sonBakiye)}.`);
    }
  }

  if (vadesiGecenler) {
    const toplam = Number(vadesiGecenler.toplamAlacak);
    metrikler.vadesiGecenAlacak = toplam;
    metrikler.vadesiGecenFaturaSayisi = vadesiGecenler.alacakSayisi;
    kanitlar.push({ kaynak: "GET /rapor/vadesi-gecenler", aciklama: "Vadesi geçen alacaklar raporu (RPR-17)" });
    if (toplam > 0) {
      if (onem === "bilgi") onem = "uyari";
      ozet.push(`${vadesiGecenler.alacakSayisi} faturada vadesi geçmiş ${tl(toplam)} alacak var.`);
      bulgular.push({ metin: `Vadesi geçen alacak: ${tl(toplam)} (${vadesiGecenler.alacakSayisi} fatura).`, baglanti: "/panel/cari/vade-hatirlatma" });
    }
  }

  if (oncelikler) {
    const ilk = oncelikler.slice(0, ONCELIK_ADEDI);
    kanitlar.push({ kaynak: "GET /cari/vade-hatirlatma/oncelikler", aciklama: "Tahsilat öncelik puanı (AI-18): kalan × risk katsayısı × (1 + gecikme/30)" });
    for (const o of ilk) {
      const gecikme = o.enEskiGecikmeGun > 0 ? `${o.enEskiGecikmeGun} gün gecikmiş` : `${-o.enEskiGecikmeGun} gün içinde vadesi doluyor`;
      bulgular.push({ metin: `${o.cariUnvan}: ${tl(o.kalanTry)}, ${gecikme}, risk ${o.risk}, puan ${Math.round(o.puan).toLocaleString("tr-TR")}.`, baglanti: `/panel/cari/${o.cariId}` });
    }
    if (ilk.length) ozet.push(`Bugün öncelikle aranacak cari: ${ilk[0].cariUnvan}.`);
  }

  return {
    onem,
    baslik: "Nakit ve tahsilat analizi",
    ozet: ozet.length ? ozet.join(" ") : "Dikkat gerektiren bir bulgu yok.",
    metrikler,
    bulgular,
    kanitlar,
    varsayimlar,
    uyarilar,
  };
}

/** Bildirim ve görev sonucu için düz metin. */
export function icgoruMetni(i: Pick<IcgoruIcerigi, "ozet" | "bulgular" | "uyarilar">): string {
  return [i.ozet, ...i.bulgular.map((b) => `• ${b.metin}`), ...i.uyarilar.map((u) => `Not: ${u}`)].join("\n");
}
