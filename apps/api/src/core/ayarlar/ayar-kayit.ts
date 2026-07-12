import type { ZodType } from "zod";

/**
 * Modül ayarları kayıt defteri (AYR-01/03, MIMARI §4.2).
 *
 * Her modül, açılışta ayar şemasını ve varsayılanlarını bildirir; saklama,
 * doğrulama ve API bu altyapıdan gelir. Sistem ayarları (AYR-02) tenant
 * modülünün kendi uçlarındadır, bu kayıt defterine girmez.
 */
export interface AyarTanimi {
  sema: ZodType;
  varsayilanlar: Record<string, unknown>;
}

const tanimlar = new Map<string, AyarTanimi>();

export function registerModulAyar(
  modul: string,
  sema: ZodType,
  varsayilanlar: Record<string, unknown>,
): void {
  if (tanimlar.has(modul)) {
    throw new Error(`'${modul}' modülünün ayar şeması zaten kayıtlı`);
  }
  sema.parse(varsayilanlar); // varsayılanlar da şemaya uymalı
  tanimlar.set(modul, { sema, varsayilanlar });
}

export function ayarTanimiAl(modul: string): AyarTanimi | undefined {
  return tanimlar.get(modul);
}

export function kayitliModuller(): string[] {
  return [...tanimlar.keys()];
}

/** Yalnızca testlerin kullandığı sıfırlama. */
export function _tumTanimlariTemizle(): void {
  tanimlar.clear();
}
