"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme, THEME_OPTIONS } from "./theme-provider";

export function ThemeConfiguratorDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const oncekiOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const escapeIleKapat = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    window.addEventListener("keydown", escapeIleKapat);
    return () => {
      document.body.style.overflow = oncekiOverflow;
      window.removeEventListener("keydown", escapeIleKapat);
      openButtonRef.current?.focus();
    };
  }, [isOpen]);

  return (
    <>
      {/* Floating Gear Button (Fixed Right Middle) */}
      <button
        ref={openButtonRef}
        onClick={() => setIsOpen(true)}
        aria-expanded={isOpen}
        aria-controls="tema-yapilandirici"
        aria-label="Görünüm ve Tema Ayarlarını Aç"
        style={{
          position: "fixed",
          right: "20px",
          bottom: "30px",
          // Panellerin (quick-panel 80, önizleme 140…) altında kalır; yoksa sağ
          // alttaki eylem düğmelerini örter.
          zIndex: 70,
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          backgroundColor: "var(--surface)",
          color: "var(--accent)",
          border: "1px solid var(--border)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          fontSize: "20px",
          transition: "transform 0.2s ease, box-shadow 0.2s ease"
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.1) rotate(45deg)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1) rotate(0deg)"; }}
      >
        ⚙️
      </button>

      {/* Backdrop */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(4px)",
            zIndex: 998,
            transition: "opacity 0.25s ease"
          }}
        />
      )}

      {/* Slide-over Drawer Panel */}
      <aside
        id="tema-yapilandirici"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tema-yapilandirici-baslik"
        aria-hidden={!isOpen}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(100vw, 340px)",
          backgroundColor: "var(--surface)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-10px 0 30px rgba(0,0,0,0.15)",
          zIndex: 999,
          display: isOpen ? "flex" : "none",
          flexDirection: "column",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          visibility: isOpen ? "visible" : "hidden",
          pointerEvents: isOpen ? "auto" : "none",
          padding: "24px",
          color: "var(--text)"
        }}
      >
        {/* Drawer Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: "16px", marginBottom: "20px" }}>
          <div>
            <h3 id="tema-yapilandirici-baslik" style={{ fontSize: "16px", fontWeight: "800", margin: 0, color: "var(--text)" }}>Görünüm Ayarları</h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "2px 0 0 0" }}>Görünüm ve Tema Tercihleri</p>
          </div>
          <button
            ref={closeButtonRef}
            onClick={() => setIsOpen(false)}
            aria-label="Ayarları Kapat"
            style={{
              background: "none",
              border: "none",
              fontSize: "20px",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: "4px"
            }}
          >
            ✕
          </button>
        </div>

        {/* Drawer Body */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px", flex: 1, overflowY: "auto" }}>
          
          {/* Theme Presets */}
          <div>
            <label style={{ fontSize: "12px", fontWeight: "800", color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "12px" }}>
              Tema Konseptleri
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {THEME_OPTIONS.map((t) => {
                const isActive = theme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 14px",
                      borderRadius: "12px",
                      backgroundColor: isActive ? "var(--surface-2)" : "transparent",
                      border: isActive ? `2px solid ${t.primaryColor}` : "1px solid var(--border)",
                      cursor: "pointer",
                      transition: "all 0.2s ease"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ width: "16px", height: "16px", borderRadius: "50%", backgroundColor: t.primaryColor, boxShadow: `0 0 8px ${t.primaryColor}80` }} />
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontSize: "13px", fontWeight: isActive ? "700" : "500", color: "var(--text)" }}>{t.name}</div>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{t.badge} Modu</div>
                      </div>
                    </div>

                    {isActive && <span style={{ color: t.primaryColor, fontWeight: "bold" }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Info Box */}
          <div style={{ backgroundColor: "var(--accent-soft)", border: "1px solid var(--border)", borderRadius: "12px", padding: "14px", marginTop: "auto" }}>
            <div style={{ fontSize: "12px", fontWeight: "700", color: "var(--accent-text)", marginBottom: "4px" }}>💡 Bilgi</div>
            <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
              Seçtiğiniz tema tercihi otomatik olarak tarayıcı hafızasına kaydedilir.
            </p>
          </div>

        </div>
      </aside>
    </>
  );
}
