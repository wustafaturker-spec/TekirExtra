import qrcode from "qrcode-generator";

/** SAH-07: ödeme bağlantısının karekodu, ölçeklenebilir SVG (hata düzeltme M). */
export function odemeKarekodu(url: string): string {
  const qr = qrcode(0, "M");
  qr.addData(url, "Byte");
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}
