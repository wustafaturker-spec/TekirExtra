/**
 * FTR-29: gönderilmemiş belgeyi taslağa geri alma. Kesinleşmiş fatura ve
 * onaylanmış irsaliye, e-Belgesi GİB'de karşılığı olan bir belgeye
 * dönüşmediyse taslağa döner; düzeltme taslak formunda yapılır. Sunucu da ekran
 * da bu kuralı kullanır; `null` uygun demektir, aksi hâlde engelin sebebi döner.
 *
 * e-Belge kaydı ancak hata almış ve entegratör referansı yoksa (belge
 * entegratöre hiç ulaşmamış) uygundur; sunucu bunu geri almada entegratöre
 * sorarak doğrular. Entegratörün ya da GİB'in reddettiği (referanslı) belge
 * için yeniden gönderim yolu henüz denenmedi — FTR-29 (4).
 */
interface EbelgeOzeti {
  durum: string;
  entegratorRef?: string | null;
}

function ebelgeEngeli(ebelge: EbelgeOzeti | null | undefined, ad: string): string | null {
  if (!ebelge) return null;
  if (ebelge.durum === "hata" && !ebelge.entegratorRef) return null;
  if (ebelge.durum === "hata") return `${ad} entegratöre ulaşıp reddedilmiş; reddedilen belgenin taslağa geri alınması henüz desteklenmiyor`;
  return `${ad} gönderilmiş ya da gönderimde; taslağa geri alınamaz`;
}

export function faturaGeriAlmaEngeli(fatura: { durum: string; tip: string; ebelge?: EbelgeOzeti | null }): string | null {
  if (fatura.durum !== "kesin") return "Yalnız kesinleşmiş fatura taslağa geri alınabilir";
  if (fatura.tip === "proforma") return "Proforma fatura taslağa geri alınmaz";
  return ebelgeEngeli(fatura.ebelge, "Faturanın e-Belgesi");
}

export function irsaliyeGeriAlmaEngeli(belge: { tur: string; durum: string; eirsaliye?: EbelgeOzeti | null }): string | null {
  if (belge.tur !== "irsaliye") return "Yalnız irsaliye taslağa geri alınabilir";
  if (belge.durum === "kapandi") return "Faturaya bağlı irsaliye taslağa geri alınamaz; önce faturayla bağını kaldırın";
  if (belge.durum !== "onaylandi") return "Yalnız onaylanmış irsaliye taslağa geri alınabilir";
  return ebelgeEngeli(belge.eirsaliye, "İrsaliyenin e-İrsaliyesi");
}
