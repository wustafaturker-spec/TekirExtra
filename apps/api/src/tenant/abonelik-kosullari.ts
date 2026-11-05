import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { ABONELIK_PLANLARI } from "./abonelik-planlari";
import { abonelikTutari, type AbonelikSuresi, type AbonelikTutari } from "../abonelik-odeme/abonelik-tutari";
import { paketFiyatiHesapla } from "../abonelik-odeme/paket-fiyat-sozlesmesi";
import { paketKapsamSemasi, PAKET_KOTA_KODLARI } from "@tekirextra/shared";

const limit = z.number().int().min(0).max(2147483647).nullable();
const eskiKosulSemasi = z.object({
  semaSurumu: z.literal(1), kaynak: z.enum(["eski_plan_gecisi", "katalog_atamasi"]),
  planKodu: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), planAdi: z.string().min(1).max(100),
  limitler: z.object({ kullanici: limit, cari: limit, stok: limit, aylikFatura: limit }).strict(),
  fiyatlandirma: z.object({
    paraBirimi: z.literal("TRY"), vergiDahil: z.literal(false), kdvOrani: z.string(),
    donemler: z.array(z.object({ aySayisi: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]), matrah: z.string() }).strict()).min(1).max(4),
  }).strict().nullable(),
}).strict();
export const abonelikKosulSemasi = z.discriminatedUnion("semaSurumu", [eskiKosulSemasi,
  eskiKosulSemasi.extend({ semaSurumu: z.literal(2), kaynak: z.literal("katalog_atamasi"), kapsamSozlesmesi: paketKapsamSemasi }),
]).superRefine((g, c) => {
  if (g.semaSurumu === 2 && PAKET_KOTA_KODLARI.some((kod) => g.limitler[kod] !== g.kapsamSozlesmesi.kotalar[kod].sinir)) c.addIssue({ code: "custom", message: "Abonelik limitleri kapsam sözleşmesiyle eşleşmiyor." });
});
export type AbonelikKosullari = z.infer<typeof abonelikKosulSemasi>;
export interface BagliAbonelik { planKodu: string; paketSurumId?: string | null; paketKosullari?: unknown }
export function abonelikModulleriniOku(a: BagliAbonelik) {
  const k = abonelikKosullariniOku(a);
  return k?.semaSurumu === 2 ? k.kapsamSozlesmesi.moduller : null;
}

/** Null yalnız eski istemci/aktarılmamış plan yoludur; yarım veya bozuk bağ sessizce atlanmaz. */
export function abonelikKosullariniOku(a: BagliAbonelik): AbonelikKosullari | null {
  if (a.paketSurumId == null && a.paketKosullari == null) return null;
  const r = abonelikKosulSemasi.safeParse(a.paketKosullari);
  if (!z.uuid().safeParse(a.paketSurumId).success || !r.success || r.data.planKodu !== (a.planKodu === "v1" ? "profesyonel" : a.planKodu)) {
    throw new BadRequestException("Aboneliğin paket sürümü veya koşulları geçersiz; platform ekibiyle iletişime geçin.");
  }
  if (r.data.fiyatlandirma) {
    try { paketFiyatiHesapla(r.data.fiyatlandirma, r.data.fiyatlandirma.donemler[0].aySayisi); }
    catch { throw new BadRequestException("Aboneliğin kayıtlı dönem fiyatları geçersiz."); }
  }
  return r.data;
}

export function bagliAbonelikTutari(a: BagliAbonelik, ay: AbonelikSuresi): AbonelikTutari | null {
  const k = abonelikKosullariniOku(a);
  if (!k) return abonelikTutari(a.planKodu, ay);
  if (!k.fiyatlandirma || !k.fiyatlandirma.donemler.some((d) => d.aySayisi === ay)) return null;
  return { planKodu: k.planKodu, planAdi: k.planAdi, paketSurumId: a.paketSurumId!, fiyatKaynagi: k.kaynak, kdvOrani: k.fiyatlandirma.kdvOrani, aySayisi: ay, ...paketFiyatiHesapla(k.fiyatlandirma, ay) };
}

export function etkinAbonelikPlani(a: BagliAbonelik) {
  const k = abonelikKosullariniOku(a);
  const p = ABONELIK_PLANLARI.find((p) => p.kod === (a.planKodu === "v1" ? "profesyonel" : a.planKodu));
  if (!k) {
    if (!p) throw new BadRequestException("Geçersiz abonelik planı");
    return p;
  }
  const aylik = k.fiyatlandirma?.donemler.find((d) => d.aySayisi === 1);
  if (!p) return { kod: k.planKodu, ad: k.planAdi, aciklama: "", aylikFiyat: aylik ? Number(aylik.matrah) : null, limitler: k.limitler, ozellikler: [] as string[] };
  return { ...p, ad: k.planAdi, aylikFiyat: aylik ? Number(aylik.matrah) : null, limitler: k.limitler };
}
