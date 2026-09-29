/**
 * FTR-34: teklif revizyonu. Onaylı teklif düzenlenmez; "Revize et" aynı
 * numarayla yeni bir taslak sürüm açar, önceki sürüm "revize edildi" olur.
 * Yalnız son sürüm siparişe dönüşür; siparişe dönüşmüş teklif revize edilmez.
 */

/** Ekran ve çıktıdaki numara: ilk sürümde yalın, sonrakilerde "Rev.N" ekli. */
export function belgeNoMetni(no: string, revizyonNo?: number | null): string {
  return revizyonNo ? `${no} Rev.${revizyonNo}` : no;
}

/** Revize edilemiyorsa nedeni; edilebiliyorsa null. Sunucu ve ekran aynı kuralı kullanır. */
export function revizyonEngeli(b: { tur: string; durum: string }): string | null {
  if (b.tur !== "teklif") return "Yalnız teklifler revize edilir";
  if (b.durum === "taslak") return "Taslak teklif revize edilmez, doğrudan düzenlenir";
  if (b.durum === "kapandi") return "Siparişe dönüşmüş teklif revize edilemez";
  if (b.durum === "revize_edildi") return "Bu teklifin daha yeni bir sürümü var; son sürümü revize edin";
  if (b.durum !== "onaylandi") return "İptal edilmiş teklif revize edilemez";
  return null;
}
