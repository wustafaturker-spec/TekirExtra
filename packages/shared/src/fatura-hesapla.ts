export interface FaturaHesaplaSatirGirdi {
  stokId: string;
  miktar: number;
  birimFiyat: number; // TL cinsinden (örn. 10.50 veya 1.2345)
  kdvOrani: number;   // Yüzde (örn. 20, 10, 1)
  iskontoOrani?: number; // Yüzde (örn. 10)
  tevkifatPay?: number; // Örn. 5 (5/10 için)
  tevkifatPayda?: number; // Örn. 10
  /**
   * EBLG-120: KDV dışı vergiler (belgedeki tutarlarıyla). Stopaj ödenecekten
   * düşer; diğerleri bedele eklenir, KDV matrahına dahil olanlar KDV'yi artırır.
   */
  ekVergiler?: EkVergiHesapGirdisi[];
}

/**
 * EBLG-120/126: tutar belgedeki gibi verilir (gelen belge) ya da hesaplanır —
 * "oran": satır matrahı × oran/100 (nispi), "birim": satır miktarı × birim
 * tutar (maktu, ör. litre başına ÖTV).
 */
export interface EkVergiHesapGirdisi {
  stopaj: boolean;
  kdvMatrahinaDahil: boolean;
  hesap?: "oran" | "birim" | null;
  tutar?: number;
  oran?: number;
  birimTutar?: number;
}

export interface FaturaHesaplaGirdi {
  satirlar: FaturaHesaplaSatirGirdi[];
  genelIskontoYuzdesi?: number; // Genel iskonto yüzde (örn. 5)
  genelIskontoTutari?: number;  // VEYA genel iskonto tutarı (örn. 100.00 TL)
  /**
   * İhraç kayıtlı satış (EBLG-60): KDV hesaplanır ve belgede görünür ama
   * tahsil edilmez. Net KDV sıfır, genel toplam matrahtır.
   */
  kdvTahsilEdilmez?: boolean;
  /**
   * Özel matrah faturasında (KDV K. 23) KDV satırlardan değil, belgeye girilen
   * özel matrahtan doğar: satırlar KDV'siz yazılır, hesaplanan KDV toplam
   * KDV'ye ve genel toplama eklenir (karar 2026-09-20). Tutar TL'dir.
   */
  ozelMatrahKdvsi?: number;
}

export interface FaturaHesaplaSatirSonuc {
  stokId: string;
  miktar: number;
  birimFiyat: number;
  brutTutar: number;       // miktar * birimFiyat (yuvarlanmamış)
  iskontoOrani: number;
  iskontoTutari: number;   // satır iskontosu (yuvarlanmış)
  genelIskontoPayi: number; // bu satıra düşen genel iskonto payı (yuvarlanmış)
  matrah: number;          // brutTutar - iskontoTutari - genelIskontoPayi (yuvarlanmış)
  kdvOrani: number;
  kdvTutari: number;       // matrah * kdvOrani / 100 (yuvarlanmış)
  tevkifatPay?: number;
  tevkifatPayda?: number;
  tevkifatTutari: number;  // kdvTutari * (pay/payda) (yuvarlanmış)
  netKdvTutari: number;    // kdvTutari - tevkifatTutari
  /** EBLG-120: bedele eklenen KDV dışı vergiler ve stopaj (satırın). */
  ekVergiTutari: number;
  /** Girdideki sırayla her ek verginin (hesaplanmış) tutarı. */
  ekVergiTutarlari: number[];
  stopajTutari: number;
  /** KDV matrahı: matrah + KDV matrahına dahil vergiler. */
  kdvMatrahi: number;
  toplamTutar: number;     // matrah + ekVergi + netKdvTutari − stopaj
}

export interface KdvDetay {
  kdvOrani: number;
  matrah: number;
  kdvTutari: number;
  tevkifatTutari: number;
}

export interface FaturaHesaplaSonuc {
  satirlar: FaturaHesaplaSatirSonuc[];
  toplamBrut: number;
  toplamSatirIskontosu: number;
  genelIskontoTutari: number;
  toplamMatrah: number;
  toplamKdv: number;
  toplamTevkifat: number;
  toplamNetKdv: number;
  /** EBLG-120: bedele eklenen KDV dışı vergiler ve kesilen stopaj toplamı. */
  toplamEkVergi: number;
  toplamStopaj: number;
  genelToplam: number;
  kdvDetaylari: KdvDetay[];
}

function Y(sayi: number): number {
  return Math.round(sayi * 100) / 100;
}

export function faturaHesapla(girdi: FaturaHesaplaGirdi): FaturaHesaplaSonuc {
  const satirlar = girdi.satirlar.map((s) => {
    const miktar = s.miktar || 0;
    const birimFiyat = s.birimFiyat || 0;
    const brutTutar = Y(miktar * birimFiyat);
    const iskontoOrani = s.iskontoOrani || 0;
    const iskontoTutari = Y(brutTutar * (iskontoOrani / 100));

    return {
      stokId: s.stokId,
      miktar,
      birimFiyat,
      brutTutar,
      iskontoOrani,
      iskontoTutari,
      tevkifatPay: s.tevkifatPay,
      tevkifatPayda: s.tevkifatPayda,
      ekVergiler: s.ekVergiler ?? [],
      ekVergiTutarlari: [] as number[],
      ekVergiTutari: 0,
      stopajTutari: 0,
      kdvMatrahi: 0,
      kdvOrani: s.kdvOrani || 0,
      kdvTutari: 0,
      tevkifatTutari: 0,
      netKdvTutari: 0,
      genelIskontoPayi: 0,
      matrah: 0,
      toplamTutar: 0,
    };
  });

  // Genel İskonto Hesaplama
  const matrahOncesiSubtotal = satirlar.reduce(
    (t, s) => t + (s.brutTutar - s.iskontoTutari),
    0,
  );

  let genelIskontoToplam = 0;
  if (girdi.genelIskontoYuzdesi && girdi.genelIskontoYuzdesi > 0) {
    genelIskontoToplam = Y(matrahOncesiSubtotal * (girdi.genelIskontoYuzdesi / 100));
  } else if (girdi.genelIskontoTutari && girdi.genelIskontoTutari > 0) {
    genelIskontoToplam = Y(girdi.genelIskontoTutari);
  }

  // Genel iskontoyu satırlara matrah oranına göre dağıtalım (pro-rata)
  let dagitilanIskonto = 0;
  satirlar.forEach((s, index) => {
    const satirMatrahOncesi = s.brutTutar - s.iskontoTutari;
    if (index === satirlar.length - 1) {
      // Son satırda yuvarlama farkını kapatmak için kalan tamamını düş
      s.genelIskontoPayi = Y(genelIskontoToplam - dagitilanIskonto);
    } else {
      const pay =
        matrahOncesiSubtotal > 0
          ? Y(genelIskontoToplam * (satirMatrahOncesi / matrahOncesiSubtotal))
          : 0;
      s.genelIskontoPayi = pay;
      dagitilanIskonto = Y(dagitilanIskonto + pay);
    }

    s.matrah = Y(satirMatrahOncesi - s.genelIskontoPayi);

    // EBLG-120/126: ek vergi tutarı belgeden ya da orandan/birim tutardan; KDV matrahına dahil olanlar KDV'yi artırır.
    s.ekVergiTutarlari = s.ekVergiler.map((v) =>
      v.hesap === "oran" ? Y(s.matrah * (v.oran ?? 0) / 100) : v.hesap === "birim" ? Y(s.miktar * (v.birimTutar ?? 0)) : Y(v.tutar ?? 0));
    const ekToplam = (kosul: (v: EkVergiHesapGirdisi) => boolean) => Y(s.ekVergiler.reduce((t, v, i) => t + (kosul(v) ? s.ekVergiTutarlari[i] : 0), 0));
    s.ekVergiTutari = ekToplam((v) => !v.stopaj);
    s.stopajTutari = ekToplam((v) => v.stopaj);
    s.kdvMatrahi = Y(s.matrah + ekToplam((v) => !v.stopaj && v.kdvMatrahinaDahil));

    // KDV & Tevkifat Hesaplama
    s.kdvTutari = Y(s.kdvMatrahi * (s.kdvOrani / 100));

    if (s.tevkifatPay && s.tevkifatPayda && s.tevkifatPayda > 0) {
      s.tevkifatTutari = Y(s.kdvTutari * (s.tevkifatPay / s.tevkifatPayda));
    } else {
      s.tevkifatTutari = 0;
    }

    s.netKdvTutari = girdi.kdvTahsilEdilmez ? 0 : Y(s.kdvTutari - s.tevkifatTutari);
    s.toplamTutar = Y(s.matrah + s.ekVergiTutari + s.netKdvTutari - s.stopajTutari);
  });

  // Toplamları Topla
  const toplamBrut = Y(satirlar.reduce((t, s) => t + s.brutTutar, 0));
  const toplamSatirIskontosu = Y(satirlar.reduce((t, s) => t + s.iskontoTutari, 0));
  const toplamMatrah = Y(satirlar.reduce((t, s) => t + s.matrah, 0));
  // Özel matrahın KDV'si satırlarda değil belgededir; toplamlara buradan girer.
  const ozelMatrahKdvsi = Y(girdi.ozelMatrahKdvsi ?? 0);
  const toplamKdv = Y(satirlar.reduce((t, s) => t + s.kdvTutari, 0) + ozelMatrahKdvsi);
  const toplamTevkifat = Y(satirlar.reduce((t, s) => t + s.tevkifatTutari, 0));
  const toplamNetKdv = Y(satirlar.reduce((t, s) => t + s.netKdvTutari, 0) + ozelMatrahKdvsi);
  const toplamEkVergi = Y(satirlar.reduce((t, s) => t + s.ekVergiTutari, 0));
  const toplamStopaj = Y(satirlar.reduce((t, s) => t + s.stopajTutari, 0));
  const genelToplam = Y(toplamMatrah + toplamEkVergi + toplamNetKdv - toplamStopaj);

  // KDV Oranlarına Göre Kırılım Detayları
  const kdvMap = new Map<number, KdvDetay>();
  satirlar.forEach((s) => {
    const mevcut = kdvMap.get(s.kdvOrani) ?? {
      kdvOrani: s.kdvOrani,
      matrah: 0,
      kdvTutari: 0,
      tevkifatTutari: 0,
    };
    mevcut.matrah = Y(mevcut.matrah + s.kdvMatrahi);
    mevcut.kdvTutari = Y(mevcut.kdvTutari + s.kdvTutari);
    mevcut.tevkifatTutari = Y(mevcut.tevkifatTutari + s.tevkifatTutari);
    kdvMap.set(s.kdvOrani, mevcut);
  });

  const kdvDetaylari = [...kdvMap.values()].sort((a, b) => b.kdvOrani - a.kdvOrani);

  return {
    satirlar,
    toplamBrut,
    toplamSatirIskontosu,
    genelIskontoTutari: genelIskontoToplam,
    toplamMatrah,
    toplamKdv,
    toplamTevkifat,
    toplamNetKdv,
    toplamEkVergi,
    toplamStopaj,
    genelToplam,
    kdvDetaylari,
  };
}
