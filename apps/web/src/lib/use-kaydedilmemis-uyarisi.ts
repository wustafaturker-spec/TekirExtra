"use client";

import { useEffect } from "react";

/** Yenilemede ve aynı sekmedeki bağlantılarda kaydedilmemiş çalışmayı hatırlatır. */
export function useKaydedilmemisUyarisi(degisti: boolean) {
  useEffect(() => {
    if (!degisti) return;
    const ayrilma = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const tiklama = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!(e.target instanceof Element)) return;
      const hedef = e.target.closest<HTMLAnchorElement | HTMLButtonElement>("a[href], button[data-platform-navigation]");
      if (!hedef) return;
      if (hedef instanceof HTMLAnchorElement) {
        if (hedef.target === "_blank" || hedef.hasAttribute("download")) return;
        const url = new URL(hedef.href, location.href);
        if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      }
      if (!window.confirm("Kaydedilmemiş değişiklikleriniz var. Kaydetmeden ayrılmak istiyor musunuz?")) {
        e.preventDefault(); e.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", ayrilma);
    document.addEventListener("click", tiklama, true);
    return () => { window.removeEventListener("beforeunload", ayrilma); document.removeEventListener("click", tiklama, true); };
  }, [degisti]);
}
