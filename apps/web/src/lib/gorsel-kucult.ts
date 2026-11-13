/**
 * AI-13 / SAH-08: telefon fotoğrafı OCR için gereğinden büyük; görsel tarayıcıda uzun kenarı en çok
 * 1600 px JPEG'e küçültülür (istek gövde sınırına takılmaz, kuyrukta az yer tutar). PDF ve
 * okunamayan görsel olduğu gibi döner.
 */
export async function gorselKucult(dosya: File, uzunKenar = 1600, kalite = 0.82): Promise<Blob> {
  if (!dosya.type.startsWith("image/")) return dosya;
  const bitmap = await createImageBitmap(dosya).catch(() => null);
  if (!bitmap) return dosya;
  const oran = Math.min(1, uzunKenar / Math.max(bitmap.width, bitmap.height));
  // Zaten küçük JPEG'i yeniden sıkıştırmak kaliteyi düşürür.
  if (oran === 1 && dosya.type === "image/jpeg") { bitmap.close(); return dosya; }
  const tuval = document.createElement("canvas");
  tuval.width = Math.round(bitmap.width * oran); tuval.height = Math.round(bitmap.height * oran);
  tuval.getContext("2d")?.drawImage(bitmap, 0, 0, tuval.width, tuval.height);
  bitmap.close();
  return new Promise((coz) => tuval.toBlob((b) => coz(b ?? dosya), "image/jpeg", kalite));
}

/** Küçültülmüş görseli dosya adını koruyarak File'a çevirir (uzantı JPEG olur). */
export async function kucukDosya(dosya: File): Promise<File> {
  const b = await gorselKucult(dosya);
  if (b === dosya) return dosya;
  const ad = dosya.name.replace(/\.[^.]+$/, "") || "belge";
  return new File([b], `${ad}.jpg`, { type: b.type || "image/jpeg" });
}

export function dataUrlOku(b: Blob): Promise<string> {
  return new Promise((coz, red) => {
    const r = new FileReader();
    r.onload = () => coz(String(r.result));
    r.onerror = () => red(r.error ?? new Error("Dosya okunamadı"));
    r.readAsDataURL(b);
  });
}
