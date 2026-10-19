import { z } from "zod";

/** AI-66: iş kutusundan kaldırma nedenleri. */
export const KAPANIS_NEDENLERI = ["elle_yapildi", "iptal", "teklif_degil"] as const;
export type KapanisNedeni = (typeof KAPANIS_NEDENLERI)[number];
export type KapanisTuru = "eposta" | "yanit" | "onay";

export const NEDEN_ADI: Record<KapanisNedeni, string> = {
  elle_yapildi: "Elle yapıldı",
  iptal: "İptal / gerek yok",
  teklif_degil: "Teklif talebi değil",
};

/** Kutuda görünen e-posta işlemi durumları (taslağı olmayanlar için). */
export const INCELENECEK = ["incelenmeli", "cari_yok", "sinirda", "hata"];
/** Kapanış gününden bu kadar gün "Kapatılanlar"da görünür (AI-69). */
export const KAPATILAN_GUN = 30;

export const kapatSemasi = z.object({
  tur: z.enum(["eposta", "yanit", "onay"]),
  id: z.string().uuid(),
  neden: z.enum(KAPANIS_NEDENLERI),
  not: z.string().trim().max(300).optional().nullable(),
  belgeId: z.string().uuid().optional().nullable(),
}).strict()
  // Teklif talebi değil yalnız e-posta talebinde; teklif bağı yalnız "Elle yapıldı"da anlamlıdır.
  .refine((g) => g.tur === "eposta" || g.neden !== "teklif_degil", { message: "Teklif talebi değil yalnız e-posta talepleri için seçilebilir", path: ["neden"] })
  .refine((g) => !g.belgeId || (g.tur === "eposta" && g.neden === "elle_yapildi"), { message: "Teklif yalnız e-posta talebi \"Elle yapıldı\" ile kapatılırken bağlanır", path: ["belgeId"] });
export type KapatGirdisi = z.infer<typeof kapatSemasi>;

/**
 * AI-48: e-posta işlemi iş kutusunda mı? Cari seçimi bekleyen, taslağı olmayan
 * incelenecek ya da taslağı hâlâ taslak olan kayıtlar kutudadır.
 */
export function epostaKutudaMi(durum: string, belgeDurumu: string | null): boolean {
  if (durum === "kapatildi" || durum === "teklif_degil") return false;
  if (durum === "cari_secimi") return true;
  if (belgeDurumu === null) return INCELENECEK.includes(durum);
  return belgeDurumu === "taslak";
}

/** Kapanışın kullanıcıya görünen özeti: "Elle yapıldı — not". */
export function kapanisMetni(neden: KapanisNedeni, not?: string | null): string {
  return `İş kutusundan kaldırıldı: ${NEDEN_ADI[neden]}${not ? ` — ${not}` : ""}`;
}

export interface EpostaOncesi { durum: string; belgeId: string | null; cariId: string | null; uyarilar: unknown }

/**
 * AI-69: geri alınan e-posta işleminin döneceği hâl. Taslak silinmiş ya da
 * iptal edilmişse eski taslağa dönülmez; kayıt "incelenecek"e düşer ve
 * "Yeniden dene" yeni taslak hazırlar.
 */
export function epostaGeriDonus(onceki: EpostaOncesi, taslakSonucu: string | null) {
  if (onceki.belgeId && taslakSonucu) {
    return {
      durum: "incelenmeli", belgeId: null, cariId: onceki.cariId,
      uyarilar: ["Kaldırılırken e-postadan açılan taslak silinmişti; \"Yeniden dene\" yeni taslak hazırlar."],
    };
  }
  return { durum: onceki.durum, belgeId: onceki.belgeId, cariId: onceki.cariId, uyarilar: onceki.uyarilar };
}
