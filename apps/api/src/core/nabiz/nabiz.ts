import { AsyncLocalStorage } from "node:async_hooks";
import { ConsoleLogger } from "@nestjs/common";
import { structuredLogger } from "../observability/structured-logger";
import { gunlukHatasiniKaydet, isHatasiniKaydet } from "../observability/surec-hatalari";
import { pencereIsareti, uzayanKilitle } from "../redis-kilit";

/**
 * PLT-16: zamanlayıcı nabzı. `nabizla(ad, is)` işi bir çalışma bağlamında
 * yürütür; iş sırasında herhangi bir servis `Logger.error` yazarsa (çoğu
 * zamanlayıcı hatayı yakalayıp yalnız loglar) o çalışma hatalı sayılır.
 * Sonuç kayıtçıya iletilir; kayıtçı yoksa (testler, betikler) iş aynen çalışır.
 */
interface Calisma { hatalar: string[]; ad?: string }

const calismaBaglami = new AsyncLocalStorage<Calisma>();

/**
 * BLD-12: `aralikMs` işin tetik aralığıdır (açılış tetiğinde bilinmez, verilmez).
 * `atlandi`: önceki tur hâlâ sürerken gelen tetik; iş çalıştırılmaz, süre ezilmez.
 */
export interface NabizSonucu { ad: string; baslangic: Date; bitis: Date; hata: string | null; aralikMs?: number; atlandi?: boolean }
export type NabizKaydedici = (s: NabizSonucu) => Promise<void>;

let kaydedici: NabizKaydedici | null = null;
export function nabizKaydediciAyarla(k: NabizKaydedici | null) { kaydedici = k; }

const metin = (m: unknown) => (m instanceof Error ? m.message : typeof m === "string" ? m : JSON.stringify(m)).slice(0, 300);

/** Çalışma bağlamındaki hata; bağlam dışında (istek, kuyruk işi) yok sayılır. */
export function nabizHatasi(mesaj: unknown) {
  const c = calismaBaglami.getStore();
  if (c && c.hatalar.length < 3) c.hatalar.push(metin(mesaj));
}

/** Nest'in varsayılan logger'ı + nabız: hata satırları açık çalışmaya işlenir. */
export class NabizLogger extends ConsoleLogger {
  override error(message: unknown, ...rest: unknown[]) {
    nabizHatasi(message);
    // PLT-123: hata ayrıca uygulama hataları gruplamasına düşer (iş içindeyse iş adıyla).
    gunlukHatasiniKaydet(message, rest, calismaBaglami.getStore()?.ad ?? null);
    super.error(message, ...(rest as [string?]));
  }
}

/** BLD-12: tur süresi aralığın bu oranını aşınca "uzun tur" sayılır. */
export const TUR_ASIM_ORANI = 0.8;

/** BLD-12: bu süreçte hâlâ süren işler (ad başına tek tur). */
const surenIsler = new Set<string>();

/** BLD-18: süreç ölürse kilit en geç bu sürede düşer. */
const KILIT_SN = 120;
/** Worker'ların tetikleri kayık gelir; pencere aralıktan biraz kısadır ki sonraki tur kaçmasın. */
const PENCERE_ORANI = 0.9;
type TurKilidi = { durum: "al"; birak: () => Promise<void> } | { durum: "suruyor" } | { durum: "yapildi" };

/**
 * BLD-18: birden çok worker'da iş tek çalışır. Kilit aynı anda iki çalışmayı, pencere işareti
 * aynı turun iki worker'da art arda çalışmasını önler. Açılış tetiği (`aralikMs` yok) pencereye
 * bakmaz. Redis erişilemezse iş yine çalışır: arka plan işlerinin durması çift turdan kötüdür.
 */
async function turKilidiAl(ad: string, aralikMs?: number): Promise<TurKilidi> {
  let birak = async () => undefined as void;
  try {
    const kilit = await uzayanKilitle(`tekir:nabiz:kilit:${ad}`, KILIT_SN);
    if (!kilit) return { durum: "suruyor" };
    birak = kilit;
    if (aralikMs && !(await pencereIsareti(`tekir:nabiz:tur:${ad}`, Math.max(1, Math.floor((aralikMs * PENCERE_ORANI) / 1000))))) {
      await kilit();
      return { durum: "yapildi" };
    }
  } catch (hata) {
    structuredLogger.warn("nabiz_kilit_alinamadi", { ad, hata: metin(hata) });
  }
  return { durum: "al", birak };
}

/** `tekSurec: false`: tetiği zaten tekil olan iş (BullMQ iş zamanlayıcısı) süreçler arası kilit almaz. */
export async function nabizla<T>(ad: string, is: () => Promise<T>, aralikMs?: number, secenek: { tekSurec?: boolean } = {}): Promise<T | undefined> {
  const baslangic = new Date();
  // BLD-12: önceki tur bitmeden gelen tetik atlanır ve ayrıca kaydedilir;
  // eskiden iş kendi korumasıyla hemen dönüyor, "0 ms başarılı" yazılıyordu.
  if (surenIsler.has(ad)) {
    if (kaydedici) await kaydedici({ ad, baslangic, bitis: baslangic, hata: null, aralikMs, atlandi: true }).catch(() => undefined);
    return undefined;
  }
  surenIsler.add(ad);
  const kilit: TurKilidi = secenek.tekSurec === false ? { durum: "al", birak: async () => undefined } : await turKilidiAl(ad, aralikMs);
  if (kilit.durum !== "al") {
    surenIsler.delete(ad);
    // Başka worker turu yaptıysa atlama değildir; hâlâ sürüyorsa BLD-12 alarmına sayılır.
    if (kilit.durum === "suruyor" && kaydedici) await kaydedici({ ad, baslangic, bitis: baslangic, hata: null, aralikMs, atlandi: true }).catch(() => undefined);
    return undefined;
  }
  const c: Calisma = { hatalar: [], ad };
  let sonuc: T | undefined;
  try {
    sonuc = await calismaBaglami.run(c, is);
  } catch (hata) {
    c.hatalar.push(metin(hata));
    isHatasiniKaydet(hata, ad);
  } finally {
    surenIsler.delete(ad);
    await kilit.birak();
  }
  if (kaydedici) {
    await kaydedici({ ad, baslangic, bitis: new Date(), hata: c.hatalar.length ? c.hatalar.join(" · ").slice(0, 1000) : null, aralikMs }).catch(() => undefined);
  }
  return sonuc;
}

/**
 * BLD-17: kuyruklu taramada tur, planlayıcı yeniden çalıştığında önceki turun
 * firma işleri hâlâ kuyruktaysa "atlandı" sayılır (BLD-12 alarmı aynı kalır).
 */
export async function nabizAtlandi(ad: string, aralikMs?: number): Promise<void> {
  const simdi = new Date();
  if (kaydedici) await kaydedici({ ad, baslangic: simdi, bitis: simdi, hata: null, aralikMs, atlandi: true }).catch(() => undefined);
}

