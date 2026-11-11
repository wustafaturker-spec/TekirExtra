"use client";

import { useEffect } from "react";
import { hataBildir } from "@/lib/hata-bildir";

/**
 * PLT-119: panel sayfası çökerse beyaz ekran yerine bu görünür; hata kaydına bildirilir.
 * Menü ve üst çubuk (panel düzeni) yerinde kalır.
 */
export default function PanelHatasi({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { hataBildir(error, "sayfa"); }, [error]);
  return (
    <div className="hero">
      <h2 className="hero__title" style={{ fontSize: "1.6rem" }}>Bu sayfa beklenmedik bir hatayla karşılaştı</h2>
      <p className="hero__sub">Sayfayı yeniden deneyebilir ya da başka bir ekrana geçebilirsiniz. Sorun sürerse destek ekibine bildirin.</p>
      <div className="hero__actions">
        <button type="button" className="btn btn--primary" onClick={() => reset()}>Yeniden dene</button>
        <a href="/panel" className="btn">Ana sayfa</a>
      </div>
    </div>
  );
}
