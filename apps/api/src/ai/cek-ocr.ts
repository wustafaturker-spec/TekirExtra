import { z } from "zod";
import { Prisma } from "@prisma/client";
import { DOVIZ_CINSLERI } from "@tekirextra/shared";

export const cekOcrGirdiSemasi = z.object({
  gorselBase64: z.string().min(1).max(10_000_000),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
}).strict();
const metin = (uzunluk: number) => z.string().max(uzunluk).nullable();
export const cekOcrSonucSemasi = z.object({
  belgeTuru: z.enum(["CEK", "SENET", "BILINMIYOR"]),
  cekNo: metin(50), banka: metin(100), sube: metin(100), hesapNo: metin(50),
  borclu: metin(255), kesideYeri: metin(100), tarih: metin(30),
  tutar: metin(40), paraBirimi: metin(10), yaziylaTutar: metin(500), yaziylaTutarSayisal: metin(40),
  guvenSkoru: z.number().min(0).max(1), belirsizAlanlar: z.array(z.string().max(100)).max(20),
});
export type CekOcrVerisi = z.infer<typeof cekOcrSonucSemasi>;
const tutarDogrula = (s: string | null) => s !== null && /^\d{1,13}(\.\d{1,2})?$/.test(s) && new Prisma.Decimal(s).greaterThan(0);

export function cekOcrDogrula(ham: CekOcrVerisi) {
  const veri = { ...ham };
  const uyarilar: string[] = [];
  if (veri.belgeTuru === "BILINMIYOR") uyarilar.push("Belge çek/senet olarak tanınmadı; forma aktarılmayacak.");
  if (!tutarDogrula(veri.tutar)) { veri.tutar = null; uyarilar.push("Tutar okunamadı veya geçersiz; elle girin."); }
  if (veri.tutar && tutarDogrula(veri.yaziylaTutarSayisal) && !new Prisma.Decimal(veri.tutar).equals(veri.yaziylaTutarSayisal!)) {
    veri.tutar = null; uyarilar.push("Rakamla ve yazıyla okunan tutar farklı; tutar forma aktarılmayacak. Belgeyi kontrol edin.");
  }
  if (!veri.tarih || !z.string().date().safeParse(veri.tarih).success) {
    veri.tarih = null; uyarilar.push("Belge tarihi okunamadı veya geçersiz; vade tarihi otomatik varsayılmayacak.");
  }
  if (!veri.paraBirimi || !(DOVIZ_CINSLERI as readonly string[]).includes(veri.paraBirimi)) {
    veri.paraBirimi = null; uyarilar.push("Para birimi okunamadı veya desteklenmiyor; elle seçin.");
  }
  if (!veri.borclu?.trim()) uyarilar.push("Keşideci/borçlu okunamadı; elle girin.");
  if (veri.belgeTuru === "CEK" && !veri.cekNo?.trim()) uyarilar.push("Çek numarası okunamadı; elle girin.");
  if (veri.guvenSkoru < 0.8) uyarilar.push("Modelin bildirdiği güven düşük; tüm alanları görüntüyle karşılaştırın.");
  uyarilar.push(...veri.belirsizAlanlar.map((a) => `Belirsiz alan: ${a}`));
  uyarilar.push("Bu okuma belgenin gerçekliğini veya tahsil edilebilirliğini doğrulamaz. Model güven skoru doğruluk garantisi değildir.");
  return { veri, uyarilar };
}
