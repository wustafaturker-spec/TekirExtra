"use client";

import { useEffect, useRef, type CSSProperties } from "react";

/**
 * SEC-15: entegratörden gelen belge görünümünü gösterir. Görünüm karekodu satır içi
 * betikle çizer; srcDoc çerçevesi sayfanın nonce'lu CSP'sini devraldığı için betik
 * çalışmazdı. Bu yüzden görünüm kendi CSP'si olan yalıtılmış sayfaya mesajla verilir:
 * ayrı kökende çalışır, sayfanın oturumuna ve API'ye erişemez, dışarıya istek atamaz.
 */
export function BelgeCercevesi({ html, title, className, style }: { html: string; title: string; className?: string; style?: CSSProperties }) {
  const cerceve = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function dinle(olay: MessageEvent) {
      const hedef = cerceve.current?.contentWindow;
      if (!hedef || olay.source !== hedef || (olay.data as { tur?: unknown } | null)?.tur !== "belge-cerceve-hazir") return;
      // Çerçevenin kökeni opak olduğundan hedef köken belirtilemez.
      hedef.postMessage({ tur: "belge-cerceve-icerik", html }, "*");
    }
    window.addEventListener("message", dinle);
    return () => window.removeEventListener("message", dinle);
  }, [html]);

  // Çerçeve içeriği bir kez yazar; yeni görünüm için key ile baştan yüklenir.
  return <iframe key={html} ref={cerceve} className={className} sandbox="allow-scripts" src="/belge-cerceve.html" style={style} title={title} />;
}
