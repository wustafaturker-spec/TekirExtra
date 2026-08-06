"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function HizliKayitPaneli({
  baslik,
  onKapat,
  children,
}: {
  baslik: string;
  onKapat: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    function tus(event: KeyboardEvent) {
      if (event.key === "Escape") onKapat();
    }
    document.addEventListener("keydown", tus);
    return () => document.removeEventListener("keydown", tus);
  }, [onKapat]);

  return (
    <div className="quick-panel-layer">
      <button aria-label="Paneli kapat" className="quick-panel-backdrop" onClick={onKapat} type="button" />
      <aside aria-label={baslik} aria-modal="true" className="quick-panel" ref={panelRef} role="dialog" tabIndex={-1}>
        <div className="quick-panel__head">
          <h3>{baslik}</h3>
          <button aria-label="Kapat" className="quick-panel__close" onClick={onKapat} title="Kapat" type="button">×</button>
        </div>
        <div className="quick-panel__body">{children}</div>
      </aside>
    </div>
  );
}
