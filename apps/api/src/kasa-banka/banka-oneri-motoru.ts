import { Prisma } from "@prisma/client";
import { ettnleriBul, faturaNumaralariniBul } from "./fatura-referansi";
import { metniNormalle } from "./ekstre-oku";
import { karsiTarafAdaylari, adBenzerligi, maasOdemesiMi } from "./ekstre-karsi-taraf";
import { tutarEslesmesiBul, type TutarEslesmesi, type EslesmeFaturasi } from "./ad-tutar-eslesme";
import { kuralBul, type KuralKaydi } from "./ekstre-kural";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export type BankaSinyalTuru =
  | "fatura_no"
  | "ettn"
  | "vkn_tckn"
  | "iban"
  | "unvan"
  | "tutar"
  | "kural"
  | "talimat"
  | "yapay_zeka";

export interface BankaSinyali {
  tur: BankaSinyalTuru;
  puan: number;
  baslik: string;
  detay: string;
  deger?: string | null;
}

export interface BankaAlternatifAday {
  cariId: string;
  kod: string;
  unvan: string;
  skor: number;
  gerekce: string;
}

export interface BankaOneriSonucu {
  skor: number; // 0 - 100
  oneriTuru: "otomatik" | "oneri" | "belirsiz";
  onerilenTur: "cari" | "masraf" | "gelir" | "virman" | "odeme_talimati" | "cek" | "kredi_karti";
  onerilenCari?: { id: string; kod: string; unvan: string; tip?: string };
  sinyaller: BankaSinyali[];
  aciklama: string;
  dagitimPlani?: Array<{ faturaId: string; tutar: string; faturaNo?: string }>;
  kalanAvans?: string;
  alternatifAdaylar?: BankaAlternatifAday[];
  eslesenFatura?: { id: string; no: string | null; kalan: string };
  eslesenTalimat?: { id: string; no: string | null; aliciUnvan: string };
  kuralId?: string;
}

export interface BankaOneriGirdisi {
  satir: {
    id: string;
    tarih: Date;
    tutar: Prisma.Decimal;
    aciklama: string;
    karsiIban: string | null;
    karsiUnvan: string | null;
    dekontNo?: string | null;
    bankaHesapId: string;
    dovizCinsi: string;
  };
  kurallar?: Array<KuralKaydi & { id: string }>;
  cariler: Array<{
    id: string;
    kod: string;
    unvan: string;
    vknTckn?: string | null;
    iban?: string | null;
    tip?: string;
    ekBankaHesaplari?: Array<{ iban: string }>;
  }>;
  faturalar: Array<EslesmeFaturasi & {
    cariId: string;
    genelToplam: string;
    tip?: string;
  }>;
  odemeTalimatlari?: Array<{
    id: string;
    no: string | null;
    aliciUnvan: string;
    tutar: Prisma.Decimal;
    aciklamadaGeciyor: boolean;
  }>;
  kendiAdlari?: string[];
  cariBakiyeleri?: Map<string, Prisma.Decimal>;
}

/**
 * P-05 Açıklanabilir Banka Öneri Motoru
 * Kurallar, fatura no, ETTN, VKN/TCKN, IBAN, unvan benzerliği ve tutar uyumu sinyallerini
 * toplayarak 0-100 puanlık kalibre edilmiş güven skoru ve kanıt dökümü üretir.
 */
export function bankaOnerisiUret(girdi: BankaOneriGirdisi): BankaOneriSonucu {
  const { satir, kurallar = [], cariler, faturalar, odemeTalimatlari = [], kendiAdlari = [], cariBakiyeleri = new Map() } = girdi;
  const giris = !satir.tutar.isNegative();
  const mutlak = satir.tutar.abs();
  const doviz = satir.dovizCinsi;

  // 1. Ödeme Talimatı Önceliği (Giden ödemeler için)
  if (!giris && odemeTalimatlari.length > 0) {
    const anilanlar = odemeTalimatlari.filter((t) => t.aciklamadaGeciyor && t.tutar.equals(mutlak));
    if (anilanlar.length === 1) {
      const t = anilanlar[0];
      return {
        skor: 98,
        oneriTuru: "otomatik",
        onerilenTur: "odeme_talimati",
        eslesenTalimat: { id: t.id, no: t.no, aliciUnvan: t.aliciUnvan },
        aciklama: `Ödeme talimatı #${t.no} (${t.aliciUnvan}) açıklamada geçiyor ve tutar (${mutlak.toFixed(2)} ${doviz}) birebir uyuyor.`,
        sinyaller: [
          { tur: "talimat", puan: 50, baslik: "Talimat Numarası Eşleşti", detay: `Açıklamada ${t.no} bulundu.`, deger: t.no },
          { tur: "tutar", puan: 48, baslik: "Talimat Tutarı Birebir", detay: `Tutar: ${mutlak.toFixed(2)} ${doviz}` },
        ],
      };
    }
  }

  // 2. Kayıtlı Kural Önceliği (Masraf, Gelir, Virman vb.)
  if (kurallar.length > 0) {
    const k = kuralBul(kurallar, { bankaHesapId: satir.bankaHesapId, tutar: satir.tutar, aciklama: satir.aciklama, karsiUnvan: satir.karsiUnvan });
    if (k) {
      if (k.eslesmeTuru === "masraf" && k.masrafKategoriId && !giris) {
        return {
          skor: 95,
          oneriTuru: "otomatik",
          onerilenTur: "masraf",
          kuralId: k.id,
          aciklama: `Kayıtlı masraf kuralı ile eşleşti (Kural: "${k.anahtar}")`,
          sinyaller: [{ tur: "kural", puan: 95, baslik: "Kayıtlı Masraf Kuralı", detay: `"${k.anahtar}" anahtar kelimesi uyarlandı`, deger: k.anahtar }],
        };
      }
      if (k.eslesmeTuru === "gelir" && k.gelirKategoriId && giris) {
        return {
          skor: 95,
          oneriTuru: "otomatik",
          onerilenTur: "gelir",
          kuralId: k.id,
          aciklama: `Kayıtlı gelir kuralı ile eşleşti (Kural: "${k.anahtar}")`,
          sinyaller: [{ tur: "kural", puan: 95, baslik: "Kayıtlı Gelir Kuralı", detay: `"${k.anahtar}" anahtar kelimesi uyarlandı`, deger: k.anahtar }],
        };
      }
      if (k.eslesmeTuru === "virman" && (k.hedefKasaId || k.hedefBankaHesapId)) {
        return {
          skor: 95,
          oneriTuru: "otomatik",
          onerilenTur: "virman",
          kuralId: k.id,
          aciklama: `Kayıtlı virman kuralı ile eşleşti (Kural: "${k.anahtar}")`,
          sinyaller: [{ tur: "kural", puan: 95, baslik: "Kayıtlı Virman Kuralı", detay: `"${k.anahtar}" transfer kuralı uygulandı`, deger: k.anahtar }],
        };
      }
    }
  }

  // 3. Cari ve Fatura Eşleştirme Sinyalleri Çıkarımı
  const metinTam = `${satir.aciklama} ${satir.karsiUnvan ?? ""}`;
  const faturaNumaralari = faturaNumaralariniBul(metinTam, satir.tarih);
  const ettnler = ettnleriBul(metinTam);
  const aciklamaVknleri: string[] = metinTam.match(/\d{10,11}/g) ?? [];
  const temizIban = satir.karsiIban ? satir.karsiIban.replace(/\s+/g, "").toUpperCase() : null;

  // Açıklamadaki karşı taraf aday adları
  const adayAdlar = karsiTarafAdaylari(satir.aciklama, satir.karsiUnvan, giris, kendiAdlari);
  const isMaas = !giris && maasOdemesiMi(satir.aciklama);

  // Aday carileri puanlayalım
  interface AdayPuan {
    cari: BankaOneriGirdisi["cariler"][number];
    sinyaller: BankaSinyali[];
    toplamPuan: number;
    tutarEslesmesi: TutarEslesmesi | null;
    fatura: EslesmeFaturasi | null;
  }

  const adayPuanlari: AdayPuan[] = [];

  for (const c of cariler) {
    const sinyaller: BankaSinyali[] = [];
    let puan = 0;

    // Yön uyumluluğu kontrolü:
    if (isMaas && c.tip === "personel") {
      sinyaller.push({ tur: "unvan", puan: 15, baslik: "Maaş Personel Kartı", detay: "Maaş açıklaması için personel kartı önceliği" });
      puan += 15;
    }

    // A. IBAN Eşleşmesi (+35 puan)
    if (temizIban) {
      const anaIbanUyum = c.iban && c.iban.replace(/\s+/g, "").toUpperCase() === temizIban;
      const ekIbanUyum = c.ekBankaHesaplari?.some((b) => b.iban.replace(/\s+/g, "").toUpperCase() === temizIban);
      if (anaIbanUyum || ekIbanUyum) {
        sinyaller.push({ tur: "iban", puan: 35, baslik: "Kayıtlı IBAN Eşleşti", detay: `Karşı IBAN (${temizIban}) cari hesabın kayıtlı IBAN'ı ile birebir uyuyor.`, deger: temizIban });
        puan += 35;
      }
    }

    // B. VKN/TCKN Eşleşmesi (+30 puan)
    if (c.vknTckn && aciklamaVknleri.includes(c.vknTckn)) {
      sinyaller.push({ tur: "vkn_tckn", puan: 30, baslik: "VKN/TCKN Eşleşti", detay: `Açıklamada geçen ${c.vknTckn} numarası cari ile eşleşiyor.`, deger: c.vknTckn });
      puan += 30;
    }

    // C. Fatura No / ETTN Eşleşmesi (+40 puan)
    const carininFaturalari = faturalar.filter((f) => f.cariId === c.id);
    let eslesenFatura: EslesmeFaturasi | null = null;

    if (faturaNumaralari.length > 0 || ettnler.length > 0) {
      for (const f of carininFaturalari) {
        if (f.no && faturaNumaralari.includes(f.no)) {
          sinyaller.push({ tur: "fatura_no", puan: 40, baslik: "Fatura Numarası Eşleşti", detay: `Açıklamada geçen #${f.no} faturası bu cariye ait.`, deger: f.no });
          puan += 40;
          eslesenFatura = f;
          break;
        }
        if (ettnler.includes(f.id.toLowerCase())) {
          sinyaller.push({ tur: "ettn", puan: 40, baslik: "ETTN Eşleşti", detay: `Açıklamada geçen ETTN (${f.id}) bu faturaya ait.`, deger: f.id });
          puan += 40;
          eslesenFatura = f;
          break;
        }
      }
    }

    // D. Unvan Benzerliği (+10 .. +25 puan)
    let enIyiBenzerlik = 0;
    let benzerAd = "";
    for (const aday of adayAdlar) {
      const b = adBenzerligi(aday.ad, c.unvan);
      if (b > enIyiBenzerlik) {
        enIyiBenzerlik = b;
        benzerAd = aday.ad;
      }
    }

    if (enIyiBenzerlik >= 0.5) {
      const unvanPuani = enIyiBenzerlik >= 0.85 ? 25 : enIyiBenzerlik >= 0.7 ? 18 : 10;
      sinyaller.push({
        tur: "unvan",
        puan: unvanPuani,
        baslik: "Karşı Taraf Unvan Benzerliği",
        detay: `Açıklamadaki “${benzerAd}” ile cari unvanı %${Math.round(enIyiBenzerlik * 100)} benzerlik gösteriyor.`,
        deger: benzerAd,
      });
      puan += unvanPuani;
    } else {
      const normUnvan = metniNormalle(c.unvan);
      if (normUnvan.length >= 4 && metniNormalle(metinTam).includes(normUnvan)) {
        sinyaller.push({ tur: "unvan", puan: 20, baslik: "Unvan Metin Eşleşmesi", detay: `Cari unvanı açıklamada tam olarak geçiyor.` });
        puan += 20;
      }
    }

    // E. Tutar Uyumu (+15 .. +20 puan)
    const cariBakiye = cariBakiyeleri.get(c.id) ?? null;
    const tutarEslesme = tutarEslesmesiBul(carininFaturalari, cariBakiye, mutlak, giris, doviz);
    if (tutarEslesme) {
      const tutarPuani = tutarEslesme.tur === "tek_fatura" ? 20 : 15;
      sinyaller.push({
        tur: "tutar",
        puan: tutarPuani,
        baslik: "Tutar Tam Uyumu",
        detay: tutarEslesme.aciklama,
      });
      puan += tutarPuani;
      if (!eslesenFatura && tutarEslesme.dagitim.length === 1) {
        eslesenFatura = carininFaturalari.find((f) => f.id === tutarEslesme.dagitim[0].faturaId) ?? null;
      }
    }

    if (puan > 0) {
      adayPuanlari.push({
        cari: c,
        sinyaller,
        toplamPuan: Math.min(puan, 100),
        tutarEslesmesi: tutarEslesme,
        fatura: eslesenFatura,
      });
    }
  }

  // Puanlara göre sırala (en yüksek puan en başta)
  adayPuanlari.sort((a, b) => b.toplamPuan - a.toplamPuan);

  if (adayPuanlari.length === 0) {
    return {
      skor: 0,
      oneriTuru: "belirsiz",
      onerilenTur: "cari",
      aciklama: "Banka satırı için güvenilir bir eşleşme adayı bulunamadı.",
      sinyaller: [],
    };
  }

  const enIyi = adayPuanlari[0];
  const ikinci = adayPuanlari[1];

  // Disambiguation (Çift aday / Yakın skor kontrolü)
  // Eğer en iyi adayın skoru < 90 ise ve ikinci adayla fark <= 10 ise seçim istenir
  const yakinIkinciVar = ikinci && (enIyi.toplamPuan - ikinci.toplamPuan <= 10 || (ikinci.toplamPuan >= 60 && enIyi.toplamPuan < 90));

  if (yakinIkinciVar) {
    const alternatifler: BankaAlternatifAday[] = [
      {
        cariId: enIyi.cari.id,
        kod: enIyi.cari.kod,
        unvan: enIyi.cari.unvan,
        skor: enIyi.toplamPuan,
        gerekce: enIyi.sinyaller.map((s) => s.baslik).join(", "),
      },
      {
        cariId: ikinci.cari.id,
        kod: ikinci.cari.kod,
        unvan: ikinci.cari.unvan,
        skor: ikinci.toplamPuan,
        gerekce: ikinci.sinyaller.map((s) => s.baslik).join(", "),
      },
    ];

    return {
      skor: enIyi.toplamPuan,
      oneriTuru: "belirsiz",
      onerilenTur: "cari",
      onerilenCari: { id: enIyi.cari.id, kod: enIyi.cari.kod, unvan: enIyi.cari.unvan, tip: enIyi.cari.tip },
      sinyaller: enIyi.sinyaller,
      alternatifAdaylar: alternatifler,
      aciklama: `Birden fazla yakın cari adayı tespit edildi (${enIyi.cari.unvan} %${enIyi.toplamPuan} vs ${ikinci.cari.unvan} %${ikinci.toplamPuan}). Lütfen doğru cariyi seçin.`,
    };
  }

  // Net tek aday
  const dagitimPlani = enIyi.tutarEslesmesi?.dagitim.map((d) => {
    const f = faturalar.find((x) => x.id === d.faturaId);
    return { faturaId: d.faturaId, tutar: d.tutar, faturaNo: f?.no ?? undefined };
  });

  const dagitilanToplam = (dagitimPlani ?? []).reduce((t, d) => t.add(d.tutar), D(0));
  const kalanAvans = mutlak.sub(dagitilanToplam).gt(0) ? mutlak.sub(dagitilanToplam).toFixed(2) : undefined;

  const oneriTuru = enIyi.toplamPuan >= 90 ? "otomatik" : enIyi.toplamPuan >= 70 ? "oneri" : "belirsiz";
  const ozetGerekce = enIyi.sinyaller.map((s) => s.baslik).join(" + ");

  return {
    skor: enIyi.toplamPuan,
    oneriTuru,
    onerilenTur: "cari",
    onerilenCari: { id: enIyi.cari.id, kod: enIyi.cari.kod, unvan: enIyi.cari.unvan, tip: enIyi.cari.tip },
    sinyaller: enIyi.sinyaller,
    aciklama: `Güven Skoru %${enIyi.toplamPuan}: ${ozetGerekce}`,
    dagitimPlani,
    kalanAvans,
    eslesenFatura: enIyi.fatura ? { id: enIyi.fatura.id, no: enIyi.fatura.no, kalan: enIyi.fatura.kalan } : undefined,
  };
}
