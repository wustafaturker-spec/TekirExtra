import { ZodError } from "zod";
import { AiSinirHatasi } from "./ai-butce";
import { AiBosYanitHatasi } from "./ai-bos-yanit";
import { SaglayiciHatasi } from "./aracli-ortak";

/**
 * AI-102: sağlayıcı dayanıklılığı. Bir model isteği (tek kullanıcı eylemi)
 * için toplam süre tavanı içinde:
 *  - geçici sağlayıcı hatasında aynı modelle en çok 2 yeniden deneme (artan bekleme);
 *    zaman aşımında aynı model önce bir kez denenir, yedek varsa ona geçilir;
 *  - hâlâ başarısızsa firmanın onaylı diğer modeline (yedek) bir geçiş;
 *  - tekrar denenebilir boş yanıtta tek tekrar;
 *  - şemaya uymayan / JSON olmayan yapılandırılmış yanıtta tek onarım denemesi.
 * Sınır/bütçe hatası, kalıcı HTTP hatası ve engellenmiş yanıt denenmez.
 * Araç çalıştırma bu katmanda değildir; yalnız model çağrısı tekrarlanır.
 */
export const TOPLAM_SURE_MS = 120_000;
/** Yeni deneme ancak bu kadar süre kaldıysa başlar. */
export const ASGARI_KALAN_MS = 20_000;
export const AYNI_MODEL_TEKRAR = 2;
export const BEKLEMELER_MS = [1_000, 3_000];

export type DenemeNedeni = "yeniden_deneme" | "yedek_model" | "bos_yanit" | "sema_onarimi";

export interface DenemeDurumu {
  /** Aynı modelde yapılan yeniden deneme sayısı (geçici hata). */
  ayniModelTekrar: number;
  yedegeGecildi: boolean;
  bosTekrarYapildi: boolean;
  onarimYapildi: boolean;
  yedekVar: boolean;
  /** Yapılandırılmış üretim mi (şema onarımı yalnız orada). */
  yapilandirilmis: boolean;
  /** Çağıran kendi zaman aşımını koydu; zaman aşımında tekrar/yedek yapılmaz. */
  ozelZamanAsimi: boolean;
  kalanMs: number;
}

export type DenemeKarari = { neden: DenemeNedeni; beklemeMs: number } | null;

export function semaHatasiMi(hata: unknown): boolean {
  return hata instanceof ZodError || hata instanceof SyntaxError;
}

export function denemeKarari(hata: unknown, d: DenemeDurumu): DenemeKarari {
  if (hata instanceof AiSinirHatasi) return null;
  if (d.kalanMs < ASGARI_KALAN_MS) return null;
  if (hata instanceof AiBosYanitHatasi) {
    return hata.tekrarDenenebilir && !d.bosTekrarYapildi ? { neden: "bos_yanit", beklemeMs: 0 } : null;
  }
  if (d.yapilandirilmis && semaHatasiMi(hata)) {
    return d.onarimYapildi ? null : { neden: "sema_onarimi", beklemeMs: 0 };
  }
  if (!(hata instanceof SaglayiciHatasi) || !hata.gecici) return null;
  if (hata.tur === "zaman_asimi" && d.ozelZamanAsimi) return null;
  const yedek = d.yedekVar && !d.yedegeGecildi ? { neden: "yedek_model" as const, beklemeMs: 0 } : null;
  // Zaman aşımı pahalıdır: aynı model en çok bir kez, sonra yedek.
  const tekrarSiniri = hata.tur === "zaman_asimi" ? (yedek ? 0 : 1) : AYNI_MODEL_TEKRAR;
  if (d.ayniModelTekrar < tekrarSiniri) return { neden: "yeniden_deneme", beklemeMs: BEKLEMELER_MS[d.ayniModelTekrar] ?? 3_000 };
  return yedek;
}

/** Onarım denemesinde modele giden ek; yanıt içeriği değil yalnız alan yolları taşır. */
export function onarimTalimati(hata: unknown): string {
  const alanlar = hata instanceof ZodError ? [...new Set(hata.issues.map((i) => i.path.join(".") || "(kök)"))].slice(0, 10) : [];
  return `\n\nÖNEMLİ: Önceki yanıtın istenen JSON şemasına uymadı${alanlar.length ? ` (sorunlu alanlar: ${alanlar.join(", ")})` : " (geçerli JSON değildi)"}. Yalnız şemaya uyan geçerli JSON döndür; açıklama ya da kod bloğu ekleme.`;
}

export const bekle = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());
