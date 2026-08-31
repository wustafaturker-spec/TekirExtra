"use client";

import { useTheme, THEME_OPTIONS } from "./theme-provider";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div aria-label="Tema seçimi" role="group" style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
      <div style={{ fontSize: "10px", fontWeight: "800", color: "var(--accent)", letterSpacing: "0.08em", display: "flex", alignItems: "center", gap: "4px" }}>
        🎨 TEMA SEÇİMİ
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "4px" }}>
        {THEME_OPTIONS.map((t) => {
          const isActive = theme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => setTheme(t.id)}
              title={t.name}
              style={{
                padding: "6px 8px",
                borderRadius: "var(--radius-sm)",
                fontSize: "11px",
                fontWeight: isActive ? "700" : "500",
                backgroundColor: isActive ? t.primaryColor : "rgba(255,255,255,0.06)",
                color: isActive ? "#ffffff" : "var(--sidebar-text, var(--text-muted))",
                border: isActive ? `1px solid ${t.primaryColor}` : "1px solid rgba(255,255,255,0.12)",
                cursor: "pointer",
                transition: "all 0.15s ease",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: t.primaryColor, flexShrink: 0, border: "1px solid rgba(255,255,255,0.4)" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.badge}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
