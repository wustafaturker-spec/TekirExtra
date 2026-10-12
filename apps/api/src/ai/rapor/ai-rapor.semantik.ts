import { Prisma } from "@prisma/client";

export type SemantikRaporTuru =
  | "CIRO_VE_KARLILIK"
  | "EN_COK_SATAN_MUSTERILER"
  | "VADESI_GECMIS_ALACAKLAR"
  | "MASRAF_KIRILIMI"
  | "EN_COK_SATAN_URUNLER"
  | "NAKIT_DURUMU";

export interface SemantikSorguSonucu {
  raporTuru: SemantikRaporTuru;
  baslik: string;
  donem: string;
  metrikler: Record<string, number | string>;
  tablo?: Array<Record<string, unknown>>;
  grafikTuru?: "bar" | "pie" | "metric" | "line";
  icgoruler: string[];
}

/**
 * 1. Ciro ve Kârlılık Analizi
 */
export async function semantikCiroVeKarlilik(
  tx: Prisma.TransactionClient,
  tenantId: string,
  baslangic?: Date,
  bitis?: Date,
): Promise<SemantikSorguSonucu> {
  const simdikiTarih = new Date();
  const ilkGun = baslangic || new Date(simdikiTarih.getFullYear(), simdikiTarih.getMonth(), 1);
  const sonGun = bitis || simdikiTarih;

  const faturalar = await tx.fatura.findMany({
    where: {
      tenantId,
      tip: "satis",
      durum: "kesin",
      tarih: { gte: ilkGun, lte: sonGun },
    },
    select: {
      toplamMatrah: true,
      toplamKdv: true,
      genelToplam: true,
      satirlar: {
        select: {
          matrah: true,
          miktar: true,
          stok: { select: { alisFiyati: true } },
        },
      },
    },
  });

  let toplamCiro = 0;
  let toplamKdv = 0;
  let toplamTahminiMaliyet = 0;

  for (const f of faturalar) {
    toplamCiro += Number(f.toplamMatrah);
    toplamKdv += Number(f.toplamKdv);

    for (const s of f.satirlar) {
      const alis = s.stok?.alisFiyati ? Number(s.stok.alisFiyati) : Number(s.matrah) * 0.7;
      toplamTahminiMaliyet += alis * Number(s.miktar || 1);
    }
  }

  const brutKar = Math.max(0, toplamCiro - toplamTahminiMaliyet);
  const karMarji = toplamCiro > 0 ? (brutKar / toplamCiro) * 100 : 0;

  const icgoruler: string[] = [];
  if (toplamCiro === 0) {
    icgoruler.push("Bu dönemde henüz kesinleşmiş satış faturası kaydı bulunmamaktadır.");
  } else {
    icgoruler.push(`Toplam ${faturalar.length} adet kesinleşmiş satış faturasından ${toplamCiro.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL net ciro üretildi.`);
    icgoruler.push(`Tahmini brüt kâr marjınız %${karMarji.toFixed(1)} seviyesindedir.`);
    if (karMarji < 20) {
      icgoruler.push("⚠️ Kâr marjınız sektör ortalamasının altında seyrediyor, maliyet ve iskontoları gözden geçirmelisiniz.");
    } else {
      icgoruler.push("✅ Sağlıklı bir kârlılık marjı korunmaktadır.");
    }
  }

  return {
    raporTuru: "CIRO_VE_KARLILIK",
    baslik: "Ciro ve Kârlılık Raporu",
    donem: `${ilkGun.toISOString().slice(0, 10)} - ${sonGun.toISOString().slice(0, 10)}`,
    metrikler: {
      toplamCiro: Math.round(toplamCiro * 100) / 100,
      toplamKdv: Math.round(toplamKdv * 100) / 100,
      tahminiMaliyet: Math.round(toplamTahminiMaliyet * 100) / 100,
      brutKar: Math.round(brutKar * 100) / 100,
      karMarjiYuzde: Math.round(karMarji * 10) / 10,
      faturaSayisi: faturalar.length,
    },
    grafikTuru: "metric",
    icgoruler,
  };
}

/**
 * 2. En Çok Satış Yapılan İlk N Müşteri
 */
export async function semantikEnCokSatanMusteriler(
  tx: Prisma.TransactionClient,
  tenantId: string,
  limit = 5,
): Promise<SemantikSorguSonucu> {
  const faturalar = await tx.fatura.findMany({
    where: { tenantId, tip: "satis", durum: "kesin" },
    select: {
      cariId: true,
      toplamMatrah: true,
      cari: { select: { unvan: true, kod: true } },
    },
  });

  const musteriMap = new Map<string, { unvan: string; kod: string; ciro: number; adet: number }>();

  for (const f of faturalar) {
    const mev = musteriMap.get(f.cariId) || { unvan: f.cari.unvan, kod: f.cari.kod, ciro: 0, adet: 0 };
    mev.ciro += Number(f.toplamMatrah);
    mev.adet += 1;
    musteriMap.set(f.cariId, mev);
  }

  const sirali = [...musteriMap.values()]
    .sort((a, b) => b.ciro - a.ciro)
    .slice(0, limit);

  const genelToplamCiro = [...musteriMap.values()].reduce((acc, m) => acc + m.ciro, 0);

  const tablo = sirali.map((m, index) => ({
    sira: index + 1,
    unvan: m.unvan,
    kod: m.kod,
    ciro: Math.round(m.ciro * 100) / 100,
    faturaSayisi: m.adet,
    payYuzdesi: genelToplamCiro > 0 ? Math.round((m.ciro / genelToplamCiro) * 1000) / 10 : 0,
  }));

  const icgoruler: string[] = [];
  if (sirali.length > 0) {
    const lider = sirali[0];
    const liderPayi = genelToplamCiro > 0 ? ((lider.ciro / genelToplamCiro) * 100).toFixed(1) : "0";
    icgoruler.push(`En büyük müşteriniz ${lider.unvan}, toplam cironuzun %${liderPayi}'sini oluşturmaktadır.`);
    if (Number(liderPayi) > 40) {
      icgoruler.push("⚠️ Müşteri konsantrasyonu yüksek risk seviyesindedir. Tek bir müşteriye bağımlılık nakit akışı riski yaratabilir.");
    }
  } else {
    icgoruler.push("Henüz kayıtlı kesinleşmiş satış faturası bulunamadı.");
  }

  return {
    raporTuru: "EN_COK_SATAN_MUSTERILER",
    baslik: `En Çok Satış Yapılan İlk ${limit} Müşteri`,
    donem: "Tüm Zamanlar",
    metrikler: {
      liderMusteri: sirali[0]?.unvan || "-",
      liderCiro: sirali[0]?.ciro || 0,
      musteriSayisi: musteriMap.size,
    },
    tablo,
    grafikTuru: "bar",
    icgoruler,
  };
}

/**
 * 3. Vadesi Geçmiş Alacaklar ve Risk Raporu
 */
export async function semantikVadesiGecmisAlacaklar(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<SemantikSorguSonucu> {
  const bugun = new Date();

  const gecikenHareketler = await tx.cariHareket.findMany({
    where: {
      tenantId,
      tip: "borc",
      vadeTarihi: { lt: bugun },
    },
    include: {
      cari: { select: { unvan: true, kod: true, telefon: true } },
    },
    orderBy: { vadeTarihi: "asc" },
  });

  const cariGecikmeMap = new Map<string, { unvan: string; kod: string; toplamGeciken: number; enEskiVade: Date; faturaAdet: number }>();

  let genelToplamGecikme = 0;

  for (const h of gecikenHareketler) {
    const tutar = Number(h.tutarTry);
    genelToplamGecikme += tutar;

    const mev = cariGecikmeMap.get(h.cariId) || {
      unvan: h.cari.unvan,
      kod: h.cari.kod,
      toplamGeciken: 0,
      enEskiVade: h.vadeTarihi || bugun,
      faturaAdet: 0,
    };
    mev.toplamGeciken += tutar;
    mev.faturaAdet += 1;
    if (h.vadeTarihi && h.vadeTarihi < mev.enEskiVade) {
      mev.enEskiVade = h.vadeTarihi;
    }
    cariGecikmeMap.set(h.cariId, mev);
  }

  const enRiskliCariler = [...cariGecikmeMap.values()]
    .sort((a, b) => b.toplamGeciken - a.toplamGeciken)
    .slice(0, 5);

  const tablo = enRiskliCariler.map((c, i) => {
    const gecikmeGunu = Math.floor((bugun.getTime() - c.enEskiVade.getTime()) / (1000 * 60 * 60 * 24));
    return {
      sira: i + 1,
      unvan: c.unvan,
      kod: c.kod,
      gecikenTutar: Math.round(c.toplamGeciken * 100) / 100,
      gecikmeGunu,
      faturaSayisi: c.faturaAdet,
    };
  });

  const icgoruler: string[] = [];
  if (genelToplamGecikme > 0) {
    icgoruler.push(`Toplam ${cariGecikmeMap.size} farklı caride vadesi geçmiş ${genelToplamGecikme.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL tahsil edilmeyi beklemektedir.`);
    if (enRiskliCariler.length > 0) {
      icgoruler.push(`En yüksek risk ${enRiskliCariler[0].unvan} üzerindedir (${enRiskliCariler[0].toplamGeciken.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL).`);
    }
    icgoruler.push("👉 Bu carilere WhatsApp veya E-posta üzerinden otomatik ödeme hatırlatması gönderebilirsiniz.");
  } else {
    icgoruler.push("✅ Tebrikler! Sistemde vadesi geçmiş hiçbir alacağınız bulunmamaktadır.");
  }

  return {
    raporTuru: "VADESI_GECMIS_ALACAKLAR",
    baslik: "Vadesi Geçmiş Alacaklar ve Risk Raporu",
    donem: bugun.toISOString().slice(0, 10),
    metrikler: {
      toplamGecikenTutar: Math.round(genelToplamGecikme * 100) / 100,
      riskliCariSayisi: cariGecikmeMap.size,
      enYuksekRiskTutari: enRiskliCariler[0]?.toplamGeciken || 0,
    },
    tablo,
    grafikTuru: "bar",
    icgoruler,
  };
}

/**
 * 4. Masraf ve Gider Kırılımı Raporu
 */
export async function semantikMasrafKirilimi(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<SemantikSorguSonucu> {
  const masraflar = await tx.masraf.findMany({
    where: { tenantId },
    select: {
      toplam: true,
      kategori: { select: { ad: true } },
    },
  });

  const kategoriMap = new Map<string, number>();
  let toplamGider = 0;

  for (const m of masraflar) {
    const tutar = Number(m.toplam);
    toplamGider += tutar;
    const kat = m.kategori?.ad || "Genel Giderler";
    kategoriMap.set(kat, (kategoriMap.get(kat) || 0) + tutar);
  }

  const tablo = [...kategoriMap.entries()]
    .map(([kategori, tutar]) => ({
      kategori,
      tutar: Math.round(tutar * 100) / 100,
      payYuzdesi: toplamGider > 0 ? Math.round((tutar / toplamGider) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.tutar - a.tutar);

  const icgoruler: string[] = [];
  if (tablo.length > 0) {
    icgoruler.push(`En büyük harcama kaleminiz ${tablo[0].kategori} (${tablo[0].tutar.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL, %${tablo[0].payYuzdesi}).`);
  } else {
    icgoruler.push("Kayıtlı masraf bulunmamaktadır.");
  }

  return {
    raporTuru: "MASRAF_KIRILIMI",
    baslik: "Masraf ve Harcama Kırılımı",
    donem: "Tüm Zamanlar",
    metrikler: {
      toplamGider: Math.round(toplamGider * 100) / 100,
      kategoriSayisi: kategoriMap.size,
    },
    tablo,
    grafikTuru: "pie",
    icgoruler,
  };
}

/**
 * 5. Kasa, Banka ve Likidite Durumu
 */
export async function semantikNakitDurumu(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<SemantikSorguSonucu> {
  const [kasalar, bankalar, hareketler] = await Promise.all([
    tx.kasa.findMany({
      where: { tenantId, aktif: true },
      select: { id: true, ad: true, dovizCinsi: true },
    }),
    tx.bankaHesap.findMany({
      where: { tenantId, aktif: true },
      select: { id: true, ad: true, bankaAdi: true, dovizCinsi: true },
    }),
    tx.kasaBankaHareket.findMany({
      where: { tenantId },
      select: { tip: true, tutarTry: true },
    }),
  ]);

  let toplamTryNakit = 0;
  for (const h of hareketler) {
    const tutar = Number(h.tutarTry);
    if (h.tip === "tahsilat" || h.tip === "virman_gelis") toplamTryNakit += tutar;
    else if (h.tip === "tediye" || h.tip === "virman_gidis") toplamTryNakit -= tutar;
  }

  const tablo = [
    ...kasalar.map((k) => ({
      ad: k.ad,
      tur: "Kasa",
      dovizCinsi: k.dovizCinsi,
    })),
    ...bankalar.map((b) => ({
      ad: `${b.bankaAdi} - ${b.ad}`,
      tur: "Banka",
      dovizCinsi: b.dovizCinsi,
    })),
  ];

  const hesapSayisi = kasalar.length + bankalar.length;

  return {
    raporTuru: "NAKIT_DURUMU",
    baslik: "Nakit ve Banka Hesapları Durumu",
    donem: new Date().toISOString().slice(0, 10),
    metrikler: {
      toplamTryNakit: Math.round(toplamTryNakit * 100) / 100,
      aktifHesapSayisi: hesapSayisi,
    },
    tablo,
    grafikTuru: "bar",
    icgoruler: [
      `Şirket bünyesinde ${hesapSayisi} adet aktif kasa ve banka hesabı bulunmaktadır.`,
      `Toplam TL likidite mevcudunuz: ${toplamTryNakit.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL.`,
    ],
  };
}
