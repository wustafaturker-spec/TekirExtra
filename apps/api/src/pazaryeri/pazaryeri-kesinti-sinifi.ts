/**
 * PZR-06/08: pazaryeri kesintisinin sınıfı. Faturalı kesintinin (komisyon,
 * kargo, hizmet, reklam) gideri pazaryerinin e-Faturasından yazılır; kesinti
 * yalnız mutabakat kaydıdır. Stopaj kasa/banka hareketine dönüşebilir
 * (PZR-09); ceza ve diğer faturasız kesinti masrafa dönüşür (PZR-10).
 *
 * Hazır eşleme ad kalıbına göredir ve temkinlidir: emin olunmayan ad
 * (ör. "Tax", "Promotion") `siniflandirilmamis` kalır, kullanıcı seçer.
 */
export type KesintiSinifi = "faturali" | "stopaj" | "ceza" | "diger_faturasiz" | "siniflandirilmamis";

const KURALLAR: [RegExp, KesintiSinifi][] = [
  [/stopaj|withh[oe]ld/i, "stopaj"],
  [/ceza|penalt/i, "ceza"],
  [/commission|komisyon|\bfees?\b|fee$|ücret|ucret|bedel|kargo|shipping|advertis|reklam|service|hizmet/i, "faturali"],
];

export function kesintiSinifiBul(tur: string): KesintiSinifi {
  // Türkçe küçültme İngilizce adlardaki "I"yı "ı" yapar ("COMMISSION"); yalnız /i bayrağı kullanılır.
  for (const [kalip, sinif] of KURALLAR) if (kalip.test(tur)) return sinif;
  return "siniflandirilmamis";
}

/** Sınıfın içe aktarmadaki başlangıç durumu: faturasız sınıflar doğrudan `faturasiz`. */
export function kesintiBaslangicDurumu(sinif: KesintiSinifi): "bekliyor" | "faturasiz" {
  return sinif === "ceza" || sinif === "diger_faturasiz" ? "faturasiz" : "bekliyor";
}
