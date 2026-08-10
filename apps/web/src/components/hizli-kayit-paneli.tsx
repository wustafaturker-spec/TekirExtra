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
  const onKapatRef = useRef(onKapat);
  const oncekiOdakRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  onKapatRef.current = onKapat;

  useEffect(() => {
    const odaklanabilirSecici = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled])") ?? panel)?.focus();

    function tus(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onKapatRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const odaklanabilirler = Array.from(panel.querySelectorAll<HTMLElement>(odaklanabilirSecici))
        .filter((oge) => !oge.hasAttribute("hidden") && oge.getAttribute("aria-hidden") !== "true");
      if (odaklanabilirler.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const ilk = odaklanabilirler[0];
      const son = odaklanabilirler[odaklanabilirler.length - 1];
      if (event.shiftKey && (document.activeElement === ilk || !panel.contains(document.activeElement))) {
        event.preventDefault();
        son.focus();
      } else if (!event.shiftKey && (document.activeElement === son || !panel.contains(document.activeElement))) {
        event.preventDefault();
        ilk.focus();
      }
    }
    document.addEventListener("keydown", tus);
    return () => {
      document.removeEventListener("keydown", tus);
      if (oncekiOdakRef.current?.isConnected) oncekiOdakRef.current.focus();
    };
  }, []);

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
