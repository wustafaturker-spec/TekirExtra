import { AsyncLocalStorage } from "node:async_hooks";
import { ConsoleLogger } from "@nestjs/common";

/**
 * PLT-16: zamanlayıcı nabzı. `nabizla(ad, is)` işi bir çalışma bağlamında
 * yürütür; iş sırasında herhangi bir servis `Logger.error` yazarsa (çoğu
 * zamanlayıcı hatayı yakalayıp yalnız loglar) o çalışma hatalı sayılır.
 * Sonuç kayıtçıya iletilir; kayıtçı yoksa (testler, betikler) iş aynen çalışır.
 */
interface Calisma { hatalar: string[] }

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
    super.error(message, ...(rest as [string?]));
  }
}

/** BLD-12: tur süresi aralığın bu oranını aşınca "uzun tur" sayılır. */
export const TUR_ASIM_ORANI = 0.8;

/** BLD-12: bu süreçte hâlâ süren işler (ad başına tek tur). */
const surenIsler = new Set<string>();

export async function nabizla<T>(ad: string, is: () => Promise<T>, aralikMs?: number): Promise<T | undefined> {
  const baslangic = new Date();
  // BLD-12: önceki tur bitmeden gelen tetik atlanır ve ayrıca kaydedilir;
  // eskiden iş kendi korumasıyla hemen dönüyor, "0 ms başarılı" yazılıyordu.
  if (surenIsler.has(ad)) {
    if (kaydedici) await kaydedici({ ad, baslangic, bitis: baslangic, hata: null, aralikMs, atlandi: true }).catch(() => undefined);
    return undefined;
  }
  surenIsler.add(ad);
  const c: Calisma = { hatalar: [] };
  let sonuc: T | undefined;
  try {
    sonuc = await calismaBaglami.run(c, is);
  } catch (hata) {
    c.hatalar.push(metin(hata));
  } finally {
    surenIsler.delete(ad);
  }
  if (kaydedici) {
    await kaydedici({ ad, baslangic, bitis: new Date(), hata: c.hatalar.length ? c.hatalar.join(" · ").slice(0, 1000) : null, aralikMs }).catch(() => undefined);
  }
  return sonuc;
}
