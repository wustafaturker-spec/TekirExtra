import { z } from "zod";
import { paketKapsamSemasi, PAKET_KOTA_KODLARI } from "@tekirextra/shared";
import { abonelikKosulSemasi, type AbonelikKosullari } from "./abonelik-kosullari";
import { paketFiyatSemasi } from "../mevzuat/platform-paket-fiyat";

const ozelFiyatSemasi = z.object({ paraBirimi: z.literal("TRY"), vergiDahil: z.literal(false), kdvOrani: z.string(),
  donemler: z.array(z.object({ aySayisi: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]), matrah: z.string() }).strict()).min(1).max(4),
}).strict().superRefine((g, c) => {
  const sonuc = paketFiyatSemasi.safeParse({ ...g, gecerlilikTarihi: "2026-01-01" });
  if (!sonuc.success) c.addIssue({ code: "custom", message: "Geçersiz özel fiyat sözleşmesi." });
});

/** İstisna tam bir fiyat/kapsam sözleşmesidir; dönem fiyatı tahmin edilmez. */
export const firmaPaketIstisnaSemasi = z.object({
  tenantId: z.uuid(), paketSurumId: z.uuid(),
  neden: z.string().trim().min(5).max(1000),
  baslangic: z.iso.datetime({ offset: true }), bitis: z.iso.datetime({ offset: true }),
  fiyatlandirma: ozelFiyatSemasi.optional(),
  kapsamSozlesmesi: paketKapsamSemasi.optional(),
}).strict().superRefine((g, c) => {
  if (Date.parse(g.bitis) <= Date.parse(g.baslangic)) c.addIssue({ code: "custom", message: "Bitiş başlangıçtan sonra olmalıdır." });
  if (!g.fiyatlandirma && !g.kapsamSozlesmesi) c.addIssue({ code: "custom", message: "Özel fiyat veya kapsam gerekir." });
});
export type FirmaPaketIstisnasi = z.infer<typeof firmaPaketIstisnaSemasi>;

/** Başlangıç dahil, bitiş hariç; süre sonunda kaynak sözleşme aynen döner. */
export function firmaIstisnasiniCoz(kaynak: AbonelikKosullari, bag: { tenantId: string; paketSurumId: string }, veri: unknown, simdi = new Date()) {
  const temel = abonelikKosulSemasi.parse(kaynak);
  const istisna = firmaPaketIstisnaSemasi.parse(veri);
  if (istisna.tenantId !== bag.tenantId || istisna.paketSurumId !== bag.paketSurumId) throw new Error("İstisna firma veya paket sürümüyle eşleşmiyor.");
  if (!Number.isFinite(simdi.getTime())) throw new Error("Geçersiz değerlendirme zamanı.");
  const etkin = simdi.getTime() >= Date.parse(istisna.baslangic) && simdi.getTime() < Date.parse(istisna.bitis);
  if (!etkin) return { etkin: false, kosullar: temel, neden: null };
  if (istisna.fiyatlandirma && temel.fiyatlandirma?.donemler.some((d) => !istisna.fiyatlandirma!.donemler.some((h) => h.aySayisi === d.aySayisi))) throw new Error("İstisna mevcut ödeme dönemlerini kaldıramaz.");
  const kapsam = istisna.kapsamSozlesmesi;
  const kosullar = abonelikKosulSemasi.parse({ ...temel,
    ...(istisna.fiyatlandirma ? { fiyatlandirma: istisna.fiyatlandirma } : {}),
    ...(kapsam ? { semaSurumu: 2, kaynak: "katalog_atamasi", kapsamSozlesmesi: kapsam,
      limitler: Object.fromEntries(PAKET_KOTA_KODLARI.map((kod) => [kod, kapsam.kotalar[kod].sinir])) } : {}),
  });
  return { etkin: true, kosullar, neden: istisna.neden };
}
