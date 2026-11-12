import type { BildirimOnemi, BildirimTuru } from "@prisma/client";
import { resmiTatiller } from "@tekirextra/shared";
import { trSimdi } from "../ai/ai-zaman";

/**
 * CNL-06/07/08 kuralları (saf işlevler). Kendiliğinden mesajlar modelsizdir: bildirim merkezinin
 * kaydı (durum, rakam, önerilen adım bildirimin açıklamasındadır) hazır metne dönüşür; bu yüzden
 * bütçe dolduğunda kritik bildirimler gitmeyi sürdürebilir (CNL-12).
 */

export const ONEM_SIRASI: Record<BildirimOnemi, number> = { bilgi: 0, uyari: 1, kritik: 2 };
/** Bağdan ya da bundan eski bildirim Telegram'a gönderilmez: bağlanınca eski kayıtlar yağmaz. */
export const TELEGRAM_BILDIRIM_PENCERESI_MS = 24 * 60 * 60 * 1000;
/** CNL-08: brifing iş günü bu saatler arasında gider (sessiz saat bitince, en geç pencere sonuna dek). */
export const BRIFING_BASLANGIC = "08:30";
export const BRIFING_BITIS = "11:00";
export const BRIFING_MADDE = 5;
const OZET_SATIR = 10;

export interface TelegramTercihi {
  gunlukSinir: number;
  minOnem: BildirimOnemi;
  konular: BildirimTuru[];
  brifing: boolean;
  susBitis: Date | null;
  sessizBaslangic: string | null;
  sessizBitis: string | null;
}

export const VARSAYILAN_TERCIH: TelegramTercihi = {
  gunlukSinir: 5, minOnem: "uyari", konular: ["onay", "yapay_zeka", "ebelge", "donem", "vade"], brifing: true, susBitis: null, sessizBaslangic: null, sessizBitis: null,
};

export function tercihCoz(k: { telegramGunlukSinir: number; telegramMinOnem: BildirimOnemi; telegramKonular: BildirimTuru[]; telegramBrifing: boolean; telegramSusBitis: Date | null; sessizBaslangic: string | null; sessizBitis: string | null } | null): TelegramTercihi {
  if (!k) return VARSAYILAN_TERCIH;
  return { gunlukSinir: k.telegramGunlukSinir, minOnem: k.telegramMinOnem, konular: k.telegramKonular, brifing: k.telegramBrifing, susBitis: k.telegramSusBitis, sessizBaslangic: k.sessizBaslangic, sessizBitis: k.sessizBitis };
}

export interface AdayTeslimat {
  id: string;
  bildirim: { tur: BildirimTuru; onem: BildirimOnemi; baslik: string; aciklama: string; hedefYol: string | null; kapandiAt: Date | null };
}

export type AtlamaNedeni = "cozuldu" | "konu_disi" | "sus";

/**
 * CNL-06/07: hangi teslimat Telegram'a uygun, hangisi gerekçeyle atlanır. Kritik bildirim konu ve
 * önem seçiminden bağımsız uygundur; "sus" hepsini durdurur. Çözülmüş (kapanmış) olay yazılmaz.
 */
export function teslimatlariSec(adaylar: AdayTeslimat[], t: TelegramTercihi, simdi: Date): { uygun: AdayTeslimat[]; atlanan: Array<{ id: string; neden: AtlamaNedeni }> } {
  const uygun: AdayTeslimat[] = [];
  const atlanan: Array<{ id: string; neden: AtlamaNedeni }> = [];
  const sustu = !!t.susBitis && t.susBitis > simdi;
  for (const a of adaylar) {
    const kritik = a.bildirim.onem === "kritik";
    if (a.bildirim.kapandiAt) atlanan.push({ id: a.id, neden: "cozuldu" });
    else if (!kritik && (!t.konular.includes(a.bildirim.tur) || ONEM_SIRASI[a.bildirim.onem] < ONEM_SIRASI[t.minOnem])) atlanan.push({ id: a.id, neden: "konu_disi" });
    else if (sustu) atlanan.push({ id: a.id, neden: "sus" });
    else uygun.push(a);
  }
  uygun.sort((x, y) => ONEM_SIRASI[y.bildirim.onem] - ONEM_SIRASI[x.bildirim.onem]);
  return { uygun, atlanan };
}

const IKON: Record<BildirimOnemi, string> = { kritik: "🔴", uyari: "🟠", bilgi: "ℹ️" };
const panel = () => (process.env.APP_URL ?? "http://localhost:3100").replace(/\/+$/, "");
const SUS_NOTU = "Kendiliğinden mesajları durdurmak için “sus” (24 saat) ya da “bugünlük yeter” yazın.";

/** Tek bildirim ayrıntıyla, birden çoğu tek özet mesajla gider (günlük sınıra bir sayılır). */
export function bildirimMesaji(liste: AdayTeslimat[]): string {
  if (liste.length === 1) {
    const b = liste[0].bildirim;
    return `${IKON[b.onem]} ${b.baslik}\n\n${b.aciklama}\n\n${panel()}${b.hedefYol ?? "/panel/bildirimler"}\n\n${SUS_NOTU}`;
  }
  const satirlar = liste.slice(0, OZET_SATIR).map((t) => `${IKON[t.bildirim.onem]} ${t.bildirim.baslik}`);
  const fazla = liste.length > OZET_SATIR ? `\n… ve ${liste.length - OZET_SATIR} bildirim daha.` : "";
  return `${liste.length} yeni bildirim:\n${satirlar.join("\n")}${fazla}\n\nAyrıntı: ${panel()}/panel/bildirimler\nHerhangi birini sorabilirsiniz.\n\n${SUS_NOTU}`;
}

/** CNL-08: iş günü (hafta içi, resmî tatil değil; arife yarım gün iş günü sayılır). */
export function isGunuMu(gun: string, haftaGunu: number): boolean {
  if (haftaGunu > 5) return false;
  return !resmiTatiller(Number(gun.slice(0, 4))).some((t) => t.tarih === gun && !t.yarimGun);
}

export function brifingZamaniMi(simdi: Date): boolean {
  const s = trSimdi(simdi);
  return isGunuMu(s.gun, s.haftaGunu) && s.saat >= BRIFING_BASLANGIC && s.saat < BRIFING_BITIS;
}

/**
 * CNL-08: belirlenimci brifing metninden en çok beş madde. Bakiyenin eksiye düştüğü uyarısı varsa
 * en üste alınır; her madde alt satırlarıyla birlikte taşınır.
 */
export function brifingMaddeleri(metin: string): string {
  const [baslik, ...satirlar] = metin.split("\n");
  const gruplar: string[][] = [];
  for (const s of satirlar) {
    if (s.startsWith("•") || !gruplar.length) gruplar.push([s]);
    else gruplar[gruplar.length - 1].push(s);
  }
  const acil = (g: string[]) => g.some((s) => /eksiye düşüyor/.test(s));
  const sirali = [...gruplar.filter(acil), ...gruplar.filter((g) => !acil(g))].slice(0, BRIFING_MADDE);
  return `☀️ ${baslik}\n\n${sirali.map((g) => g.join("\n")).join("\n")}\n\nHer maddenin ayrıntısını buradan sorabilirsiniz.`;
}

/** "bugünlük yeter": Türkiye'de gün sonu (ertesi gün 00:00). */
export function gunSonu(simdi: Date): Date {
  return new Date(Date.parse(`${trSimdi(simdi).gun}T00:00:00+03:00`) + 24 * 60 * 60 * 1000);
}

/** Türkiye'de bugünün başlangıcı (günlük sınır sayımı). */
export function gunBasi(simdi: Date): Date {
  return new Date(`${trSimdi(simdi).gun}T00:00:00+03:00`);
}

/** CNL-07 sohbet komutları: tam eşleşme (cümle içinde geçen "sus" komut sayılmaz). */
export function ritimKomutu(metin: string): "sus" | "bugunluk" | "devam" | null {
  const m = metin.toLocaleLowerCase("tr-TR").replace(/[.!…]+$/u, "").trim();
  if (m === "sus" || m === "/sus") return "sus";
  if (m === "bugünlük yeter" || m === "bugunluk yeter" || m === "/yeter") return "bugunluk";
  if (m === "/devam") return "devam";
  return null;
}
