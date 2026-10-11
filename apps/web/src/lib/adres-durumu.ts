"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * RPR-21 (inceleme P2-6): ayrı rapor ekranlarının dönem ve süzgeçleri adreste
 * durur; bağlantı paylaşılınca aynı görünüm açılır, yenilemede kaybolmaz.
 * Yalnız `varsayilan`daki anahtarlar okunur; boş olmayan her değer yazılır
 * (varsayılan dönem "bugün"e bağlı, bağlantı başka gün de aynı dönemi açsın). `hazir` adres okunana kadar false'tur — sayfa veri çekmeyi
 * bekletir, yoksa önce varsayılanla, sonra adresteki değerle iki istek gider.
 */
export function useAdresDurumu<T extends Record<string, string>>(varsayilan: T): [T, (yeni: Partial<T>) => void, boolean] {
  const [durum, setDurum] = useState<T>(varsayilan);
  const [hazir, setHazir] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const okunan = { ...varsayilan };
    for (const anahtar of Object.keys(varsayilan) as (keyof T)[]) {
      const deger = p.get(String(anahtar));
      if (deger !== null) okunan[anahtar] = deger as T[keyof T];
    }
    setDurum(okunan);
    setHazir(true);
    // Yalnız ilk açılışta okunur; varsayılan her çizimde yeni nesne olabilir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hazir) return;
    const p = new URLSearchParams(window.location.search);
    for (const [anahtar, deger] of Object.entries(durum)) {
      if (deger === "") p.delete(anahtar);
      else p.set(anahtar, deger);
    }
    const sorgu = p.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${sorgu ? `?${sorgu}` : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durum, hazir]);

  const guncelle = useCallback((yeni: Partial<T>) => setDurum((eski) => ({ ...eski, ...yeni })), []);
  return [durum, guncelle, hazir];
}
