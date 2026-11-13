/**
 * AI-13: fişin KDV kırılımı oran başına tek satıra indirilir (model aynı oranı iki kez yazabilir);
 * matrahı sıfır olan satır atılır. Birden çok oran kalırsa oran başına ayrı masraf taslağı açılır.
 */
export interface KirilimSatiri { oran: number; matrah: number; kdvTutari: number }

const kurus = (n: number) => Math.round(n * 100) / 100;

export function oranKirilimi(kirilim: KirilimSatiri[] | undefined | null): KirilimSatiri[] {
  const harita = new Map<number, KirilimSatiri>();
  for (const k of kirilim ?? []) {
    if (!Number.isFinite(k.oran) || !(k.matrah > 0)) continue;
    const m = harita.get(k.oran) ?? { oran: k.oran, matrah: 0, kdvTutari: 0 };
    m.matrah = kurus(m.matrah + k.matrah);
    m.kdvTutari = kurus(m.kdvTutari + Math.max(0, k.kdvTutari || 0));
    harita.set(k.oran, m);
  }
  return [...harita.values()].sort((a, b) => a.oran - b.oran);
}

export const kirilimToplami = (k: KirilimSatiri[]) => kurus(k.reduce((t, x) => t + x.matrah + x.kdvTutari, 0));
