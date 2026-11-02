"use client";

import { useEffect, useRef } from "react";
import { BelgeCercevesi } from "./belge-cercevesi";

/**
 * Entegratörün çizdiği belge görünümünü tam ekran gösterir (L). Sihirbaz
 * paneli dar olduğu için önizleme orada okunmaz; bu katman panelin üstünde
 * açılır, kapanınca panel olduğu gibi kalır.
 *
 * Görünüm entegratörden gelir ve karekodu kendi betiğiyle çizer: çerçeve
 * betiğe izin verir ama ayrı kökende çalışır, sayfanın oturumuna erişemez.
 */
export function BelgeOnizlemeEkrani({ html, baslik, onKapat }: { html: string; baslik: string; onKapat: () => void }) {
  const kapatRef = useRef<HTMLButtonElement>(null);
  const onKapatRef = useRef(onKapat);
  onKapatRef.current = onKapat;

  useEffect(() => {
    const oncekiOdak = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    kapatRef.current?.focus();
    // Yakalama aşamasında durdurulur: alttaki sihirbaz paneli Esc'i ve Tab'ı
    // da dinliyor (kapatma ve odak kapanı). Bu katman açıkken ikisi de
    // yalnız buraya aittir; Tab'ın varsayılan davranışı korunur.
    function tus(event: KeyboardEvent) {
      if (event.key === "Tab") {
        event.stopPropagation();
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onKapatRef.current();
    }
    window.addEventListener("keydown", tus, true);
    return () => {
      window.removeEventListener("keydown", tus, true);
      if (oncekiOdak?.isConnected) oncekiOdak.focus();
    };
  }, []);

  return (
    <div aria-label={baslik} aria-modal="true" className="document-preview-screen" role="dialog">
      <div className="document-preview-screen__head">
        <h3>{baslik}</h3>
        <button className="btn btn--ghost" onClick={onKapat} ref={kapatRef} type="button">Kapat (Esc)</button>
      </div>
      <BelgeCercevesi className="document-preview-screen__frame" html={html} title={baslik} />
    </div>
  );
}
