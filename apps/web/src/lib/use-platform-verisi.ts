"use client";

import { useCallback, useEffect, useState } from "react";
import { platformApi, platformTokenAl } from "./platform-api";

/** Filtre değiştiğinde önceki isteği iptal eder; eski yanıt yeni görünümü değiştiremez. */
export function usePlatformVerisi<T>(yol: string | null) {
  const [tekrar, setTekrar] = useState(0);
  const [sonuc, setSonuc] = useState<{ yol: string | null; veri: T | null; hata: string; yukleniyor: boolean }>({
    yol: null, veri: null, hata: "", yukleniyor: false,
  });
  const yenile = useCallback(() => setTekrar((v) => v + 1), []);

  useEffect(() => {
    if (!yol || !platformTokenAl()) return;
    const kontrol = new AbortController();
    setSonuc({ yol, veri: null, hata: "", yukleniyor: true });
    void platformApi<T>(yol, { signal: kontrol.signal })
      .then((veri) => { if (!kontrol.signal.aborted) setSonuc({ yol, veri, hata: "", yukleniyor: false }); })
      .catch((e: unknown) => {
        if (!kontrol.signal.aborted) setSonuc({ yol, veri: null, hata: e instanceof Error ? e.message : "Veriler yüklenemedi.", yukleniyor: false });
      });
    return () => kontrol.abort();
  }, [yol, tekrar]);

  const guncel = sonuc.yol === yol;
  return {
    veri: yol && guncel ? sonuc.veri : null,
    hata: yol && guncel ? sonuc.hata : "",
    yukleniyor: Boolean(yol) && (!guncel || sonuc.yukleniyor),
    yenile,
  };
}
