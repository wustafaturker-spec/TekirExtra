/**
 * Fiyat önerisi (AI-12): müşteri grubu, vade ve miktara göre kurala dayalı
 * öneri — yapay zekâ değildir. Bütün tutarlar belge dövizindedir; maliyet
 * bilinmiyorsa marj denetimi ve taban fiyat üretilmez.
 */

export interface FiyatlandirmaGirdisi {
  stokId: string;
  bazFiyat: number;
  paraBirimi: string;
  /** Belge dövizinde birim maliyet; bilinmiyorsa null (varsayım yapılmaz). */
  maliyet?: number | null;
  /** Varsa ürünün geçmiş ortalama satış fiyatı */
  ortalamaSatisFiyati?: number | null;
  /** Fiyat cariye özel atanmış fiyat listesinden mi geldi? */
  fiyatListesindenGeldi?: boolean;
  fiyatListesiAdi?: string | null;
  /** Talep edilen vade günü (Peşin = 0, 30 gün, 60 gün vb.) */
  vadeGun: number;
  /** Müşteri grubu (bayi, toptan, perakende, vb.) */
  musteriGrubu?: string | null;
  /** Carinin geçmişteki ağırlıklı ortalama tahsilat gecikmesi (gün) */
  cariOrtalamaGecikmeGun?: number | null;
  /** Aylık piyasa finansman / faiz oranı (Yüzde olarak, varsayılan %4.5) */
  aylikFinansmanOrani?: number;
  /** İstenen sipariş miktarı (Hacim indirimi için) */
  miktar?: number;
}

export interface FiyatlandirmaSonucu {
  onerilenFiyat: number;
  paraBirimi: string;
  /** Maliyet + %10 taban; maliyet bilinmiyorsa null. */
  altSinirFiyat: number | null;
  ustSinirFiyat: number;
  iskontoVeyaVadeFarkiOrani: number; // Pozitif: Vade farkı / Negatif: İskonto
  /** Brüt kâr marjı; maliyet bilinmiyorsa null. */
  karMarjiYuzde: number | null;
  fiyatKaynagi: "fiyat_listesi" | "dinamik_hesap";
  uyarilar: string[]; // Kâr marjı düşüklüğü veya ortalama fiyat altı uyarıları
  kirilim: {
    bazFiyat: number;
    grupIskontosuYuzde: number;
    miktarIskontosuYuzde: number;
    efektifVadeGun: number;
    vadeFinansmanMaliyetiYuzde: number;
    asgariMaliyetKalkan: number | null;
  };
  gerekceler: string[];
  guvenSkoru: number;
}

export function fiyatOnerisiHesapla(girdi: FiyatlandirmaGirdisi): FiyatlandirmaSonucu {
  const gerekceler: string[] = [];
  const uyarilar: string[] = [];
  const aylikFaiz = girdi.aylikFinansmanOrani ?? 4.5; // Aylık %4.5 finansman maliyeti
  const bazFiyat = Math.max(0, girdi.bazFiyat);
  const maliyet = girdi.maliyet && girdi.maliyet > 0 ? girdi.maliyet : null;

  let hesaplananFiyat = bazFiyat;
  let grupIskontosuYuzde = 0;
  let miktarIskontosuYuzde = 0;
  let vadeFinansmanMaliyetiYuzde = 0;
  let fiyatKaynagi: "fiyat_listesi" | "dinamik_hesap" = "dinamik_hesap";

  // 1. CARİYE ÖZEL FİYAT LİSTESİ ÖNCELİĞİ
  if (girdi.fiyatListesindenGeldi) {
    fiyatKaynagi = "fiyat_listesi";
    hesaplananFiyat = bazFiyat;
    gerekceler.push(
      `${girdi.fiyatListesiAdi || "Cariye tanımlı fiyat listesi"} esas alındı: ${bazFiyat.toFixed(2)} ${girdi.paraBirimi}.`
    );

    // Vadeli satışsa fiyat listesi üzerine sadece vade finansman farkı eklenebilir
    const gecikme = Math.max(0, girdi.cariOrtalamaGecikmeGun ?? 0);
    const efektifVadeGun = Math.max(0, girdi.vadeGun) + gecikme;
    if (efektifVadeGun > 0) {
      vadeFinansmanMaliyetiYuzde = Math.round(((aylikFaiz / 30) * efektifVadeGun) * 100) / 100;
      hesaplananFiyat = hesaplananFiyat * (1 + vadeFinansmanMaliyetiYuzde / 100);
      gerekceler.push(
        `Fiyat listesi tutarına ${efektifVadeGun} günlük vade finansman farkı (+%${vadeFinansmanMaliyetiYuzde}) ilave edildi.`
      );
    }
  } else {
    // 2. DİNAMİK MÜŞTERİ GRUBU VE HACİM HESAPLAMASI
    const grup = (girdi.musteriGrubu || "").toLocaleLowerCase("tr-TR");
    if (grup.includes("bayi") || grup.includes("distribütör")) {
      grupIskontosuYuzde = 15;
      gerekceler.push(`Bayi müşteri grubu için %${grupIskontosuYuzde} taban iskonto uygulandı.`);
    } else if (grup.includes("toptan")) {
      grupIskontosuYuzde = 10;
      gerekceler.push(`Toptan müşteri grubu için %${grupIskontosuYuzde} taban iskonto uygulandı.`);
    } else if (grup.includes("vip") || grup.includes("ozel")) {
      grupIskontosuYuzde = 8;
      gerekceler.push(`VIP müşteri grubu için %${grupIskontosuYuzde} iskonto uygulandı.`);
    }

    const miktar = girdi.miktar ?? 1;
    if (miktar >= 1000) {
      miktarIskontosuYuzde = 5;
      gerekceler.push(`1.000+ adetlik yüksek hacim için ek %${miktarIskontosuYuzde} iskonto uygulandı.`);
    } else if (miktar >= 250) {
      miktarIskontosuYuzde = 2.5;
      gerekceler.push(`250+ adetlik sipariş hacmi için ek %${miktarIskontosuYuzde} iskonto uygulandı.`);
    }

    const gecikme = Math.max(0, girdi.cariOrtalamaGecikmeGun ?? 0);
    const efektifVadeGun = Math.max(0, girdi.vadeGun) + gecikme;

    if (efektifVadeGun > 0) {
      vadeFinansmanMaliyetiYuzde = Math.round(((aylikFaiz / 30) * efektifVadeGun) * 100) / 100;
      if (gecikme > 0) {
        gerekceler.push(
          `Talep edilen ${girdi.vadeGun} gün vadeye, carinin geçmiş ortalama ${gecikme} gün gecikmesi eklenerek ${efektifVadeGun} günlük finansman maliyeti (+%${vadeFinansmanMaliyetiYuzde}) hesaplandı.`
        );
      } else {
        gerekceler.push(`${girdi.vadeGun} günlük vade finansman maliyeti (+%${vadeFinansmanMaliyetiYuzde}) fiyata yansıtıldı.`);
      }
    } else {
      gerekceler.push("Peşin ödeme: Vade finansman farkı eklenmedi.");
    }

    const toplamIskontoOrani = Math.min(0.35, (grupIskontosuYuzde + miktarIskontosuYuzde) / 100);
    const iskontoluFiyat = bazFiyat * (1 - toplamIskontoOrani);
    hesaplananFiyat = iskontoluFiyat * (1 + vadeFinansmanMaliyetiYuzde / 100);
  }

  // 3. ASGARİ MALİYET KALKANI: yalnız maliyet biliniyorsa.
  const asgariMaliyetKalkan = maliyet === null ? null : Math.round(maliyet * 1.10 * 100) / 100;
  if (asgariMaliyetKalkan !== null && hesaplananFiyat < asgariMaliyetKalkan) {
    hesaplananFiyat = asgariMaliyetKalkan;
    gerekceler.push(`Fiyat maliyet + %10 tabanına çekildi (${asgariMaliyetKalkan} ${girdi.paraBirimi}).`);
  }

  const onerilenFiyat = Math.round(hesaplananFiyat * 100) / 100;
  const altSinirFiyat = asgariMaliyetKalkan === null ? null : Math.round(Math.max(asgariMaliyetKalkan, onerilenFiyat * 0.95) * 100) / 100;
  const ustSinirFiyat = Math.round((onerilenFiyat * 1.08) * 100) / 100;

  // 4. KÂR MARJI: maliyet bilinmiyorsa hesaplanmaz.
  const karMarjiYuzde = maliyet === null || onerilenFiyat <= 0 ? null : Math.round(((onerilenFiyat - maliyet) / onerilenFiyat) * 1000) / 10;
  if (maliyet === null) {
    gerekceler.push("Maliyet bilinmediği için marj denetlenmedi.");
  } else if (karMarjiYuzde !== null && karMarjiYuzde < 15) {
    uyarilar.push(`Düşük kâr marjı: brüt marj %${karMarjiYuzde.toFixed(1)} (maliyet ${maliyet.toFixed(2)} ${girdi.paraBirimi}).`);
  }

  // 5. GEÇMİŞ ORTALAMA SATIŞ FİYATI KARŞILAŞTIRMASI VE UYARISI
  if (girdi.ortalamaSatisFiyati && girdi.ortalamaSatisFiyati > 0) {
    const ortalamaFiyat = Number(girdi.ortalamaSatisFiyati);
    if (onerilenFiyat < ortalamaFiyat * 0.92) {
      const farkYuzde = Math.round(((ortalamaFiyat - onerilenFiyat) / ortalamaFiyat) * 100);
      uyarilar.push(
        `Ortalama altı fiyat: önerilen fiyat (${onerilenFiyat} ${girdi.paraBirimi}), bu ürünün geçmiş ortalama satış fiyatının (${ortalamaFiyat.toFixed(2)} ${girdi.paraBirimi}) %${farkYuzde} altındadır!`
      );
    }
  }

  const netDegisimOrani = bazFiyat > 0 ? Math.round(((onerilenFiyat - bazFiyat) / bazFiyat) * 1000) / 10 : 0;
  const efektifVadeGun = Math.max(0, girdi.vadeGun) + Math.max(0, girdi.cariOrtalamaGecikmeGun ?? 0);

  return {
    onerilenFiyat,
    paraBirimi: girdi.paraBirimi,
    altSinirFiyat,
    ustSinirFiyat,
    iskontoVeyaVadeFarkiOrani: netDegisimOrani,
    karMarjiYuzde,
    fiyatKaynagi,
    uyarilar,
    kirilim: {
      bazFiyat,
      grupIskontosuYuzde,
      miktarIskontosuYuzde,
      efektifVadeGun,
      vadeFinansmanMaliyetiYuzde,
      asgariMaliyetKalkan,
    },
    gerekceler,
    guvenSkoru: girdi.fiyatListesindenGeldi ? 0.98 : girdi.cariOrtalamaGecikmeGun !== undefined ? 0.95 : 0.85,
  };
}
