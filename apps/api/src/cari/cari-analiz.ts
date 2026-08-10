export interface AnalizHareketi {
  tip: "borc" | "alacak";
  tutarTry: number;
  tarih: Date;
  vadeTarihi: Date | null;
}

export interface CariAnalizSonucu {
  riskSkoru: number;
  riskSeviyesi: "dusuk" | "orta" | "yuksek";
  tahminiGecikmeGun: number | null;
  odemeDavranisi: "veri_yetersiz" | "zamaninda" | "kismen_gec" | "gecikmeli";
  onerilenRiskLimiti: string;
  guven: "dusuk" | "orta" | "yuksek";
  metrikler: {
    kapananBorcSayisi: number;
    ortalamaGecikmeGun: number | null;
    zamanindaOdemeOrani: number | null;
    acikBakiye: string;
    vadesiGecmisBakiye: string;
    limitKullanimOrani: number | null;
  };
  gerekceler: string[];
}

const GUN_MS = 86_400_000;
const yuvarlaYuzluk = (deger: number) => Math.max(0, Math.round(deger / 100) * 100);

export function cariDavranisAnalizi(
  hareketler: AnalizHareketi[],
  riskLimiti: number | null,
  bugun = new Date(),
): CariAnalizSonucu {
  const sirali = [...hareketler].sort((a, b) => a.tarih.getTime() - b.tarih.getTime());
  const acikBorclar: { kalan: number; vade: Date }[] = [];
  let kapananBorcSayisi = 0;
  let kapananTutar = 0;
  let agirlikliGecikme = 0;
  let zamanindaTutar = 0;
  let sonAltiAyBorc = 0;
  const altiAyOnce = new Date(bugun); altiAyOnce.setMonth(altiAyOnce.getMonth() - 6);

  for (const hareket of sirali) {
    const tutar = Math.max(0, hareket.tutarTry);
    if (hareket.tip === "borc") {
      acikBorclar.push({ kalan: tutar, vade: hareket.vadeTarihi ?? hareket.tarih });
      if (hareket.tarih >= altiAyOnce) sonAltiAyBorc += tutar;
      continue;
    }
    let alacak = tutar;
    while (alacak > 0.005 && acikBorclar.length) {
      const borc = acikBorclar[0];
      const kapanan = Math.min(alacak, borc.kalan);
      const gecikme = Math.max(0, Math.round((hareket.tarih.getTime() - borc.vade.getTime()) / GUN_MS));
      agirlikliGecikme += gecikme * kapanan;
      kapananTutar += kapanan;
      if (gecikme === 0) zamanindaTutar += kapanan;
      borc.kalan -= kapanan; alacak -= kapanan;
      if (borc.kalan <= 0.005) { acikBorclar.shift(); kapananBorcSayisi += 1; }
    }
  }

  const acikBakiye = acikBorclar.reduce((toplam, b) => toplam + b.kalan, 0);
  const vadesiGecmis = acikBorclar.filter((b) => b.vade < bugun).reduce((toplam, b) => toplam + b.kalan, 0);
  const ortalamaGecikme = kapananTutar ? agirlikliGecikme / kapananTutar : null;
  const zamanindaOran = kapananTutar ? zamanindaTutar / kapananTutar : null;
  const gecmisOrani = acikBakiye ? vadesiGecmis / acikBakiye : 0;
  const limitKullanim = riskLimiti && riskLimiti > 0 ? acikBakiye / riskLimiti : null;
  const riskSkoru = Math.round(Math.min(100,
    gecmisOrani * 50 + Math.min(ortalamaGecikme ?? 0, 60) / 60 * 30 + Math.min(limitKullanim ?? 0, 1.5) / 1.5 * 20,
  ));
  const riskSeviyesi = riskSkoru >= 65 ? "yuksek" : riskSkoru >= 35 ? "orta" : "dusuk";
  const odemeDavranisi = kapananBorcSayisi < 2 ? "veri_yetersiz" : (ortalamaGecikme ?? 0) <= 3 ? "zamaninda" : (ortalamaGecikme ?? 0) <= 15 ? "kismen_gec" : "gecikmeli";
  const guven = kapananBorcSayisi >= 10 ? "yuksek" : kapananBorcSayisi >= 3 ? "orta" : "dusuk";
  const aylikOrtalama = sonAltiAyBorc / 6;
  const riskCarpani = riskSeviyesi === "dusuk" ? 2 : riskSeviyesi === "orta" ? 1.25 : 0.75;
  const onerilenLimit = yuvarlaYuzluk(Math.max(acikBakiye, aylikOrtalama * riskCarpani));
  const gerekceler = [
    `${kapananBorcSayisi} kapanmış borç üzerinden ${guven} güven düzeyi`,
    ortalamaGecikme === null ? "Gecikme hesabı için kapanmış borç yok" : `Tutar ağırlıklı ortalama gecikme ${Math.round(ortalamaGecikme)} gün`,
    `Açık bakiyenin %${Math.round(gecmisOrani * 100)} kadarı vadesi geçmiş`,
    "Limit önerisi son 6 aylık aylık borç ortalaması, açık bakiye ve risk seviyesiyle hesaplandı",
  ];

  return {
    riskSkoru, riskSeviyesi,
    tahminiGecikmeGun: ortalamaGecikme === null ? null : Math.round(ortalamaGecikme),
    odemeDavranisi, onerilenRiskLimiti: onerilenLimit.toFixed(2), guven,
    metrikler: {
      kapananBorcSayisi,
      ortalamaGecikmeGun: ortalamaGecikme === null ? null : Math.round(ortalamaGecikme * 10) / 10,
      zamanindaOdemeOrani: zamanindaOran === null ? null : Math.round(zamanindaOran * 100),
      acikBakiye: acikBakiye.toFixed(2), vadesiGecmisBakiye: vadesiGecmis.toFixed(2),
      limitKullanimOrani: limitKullanim === null ? null : Math.round(limitKullanim * 100),
    },
    gerekceler,
  };
}
