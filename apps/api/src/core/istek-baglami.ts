import { AsyncLocalStorage } from "node:async_hooks";
import type { Rol } from "@tekirextra/shared";

/**
 * İstek başına kimlik bağlamı (MIMARI §3). İstek, main.ts'teki middleware ile
 * boş bir tutucu içinde `run()` edilir; AuthGuard doğrulanan JWT'den doldurur.
 * (Guard içinde `enterWith` kullanılamaz: Express zincirinde guard'ın async
 * bağlamı handler'a taşınmaz — tutucu nesne mutasyonu bu yüzden gereklidir.)
 */
export interface IstekBaglami {
  tenantId: string;
  userId: string;
  rol: Rol;
}

/** MVZ-04: platform ekibi kimliği; kiracı bağlamıyla aynı istekte bulunmaz. */
export interface PlatformBaglami {
  kullaniciId: string;
  eposta: string;
}

interface BaglamTutucu {
  deger?: IstekBaglami;
  platform?: PlatformBaglami;
}

export const istekBaglami = new AsyncLocalStorage<BaglamTutucu>();

/** main.ts middleware'i: her isteği boş tutucuyla sarar. */
export function bosTutucuylaCalistir(devam: () => void): void {
  istekBaglami.run({}, devam);
}

/** AuthGuard doğrulama sonrası çağırır. */
export function baglamKur(deger: IstekBaglami): void {
  const tutucu = istekBaglami.getStore();
  if (tutucu) tutucu.deger = deger;
}

export function baglamAl(): IstekBaglami | undefined {
  return istekBaglami.getStore()?.deger;
}

export function aktifBaglam(): IstekBaglami {
  const deger = baglamAl();
  if (!deger) {
    throw new Error("Kimlik bağlamı kurulmadan kiracı verisine erişilemez");
  }
  return deger;
}

/** HTTP isteği dışındaki worker işlerini açık bir kimlik bağlamında çalıştırır. */
export function baglamlaCalistir<T>(deger: IstekBaglami, is: () => Promise<T>): Promise<T> {
  return istekBaglami.run({ deger }, is);
}

/** AuthGuard platform ucunda doğrulanan platform token'ından kurar. */
export function platformBaglamKur(deger: PlatformBaglami): void {
  const tutucu = istekBaglami.getStore();
  if (tutucu) tutucu.platform = deger;
}

export function aktifPlatformBaglam(): PlatformBaglami {
  const deger = istekBaglami.getStore()?.platform;
  if (!deger) throw new Error("Platform kimliği kurulmadan platform işlemi yapılamaz");
  return deger;
}

/** Testler ve betikler için: açık bir platform kimliğinde çalıştırır. */
export function platformBaglamiylaCalistir<T>(deger: PlatformBaglami, is: () => Promise<T>): Promise<T> {
  return istekBaglami.run({ platform: deger }, is);
}
