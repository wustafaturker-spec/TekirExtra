"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeKey = "amber-default" | "slate-mint" | "corporate-navy" | "dark-obsidian" | "emerald-finance" | "high-contrast";

export interface ThemeMeta {
  id: ThemeKey;
  name: string;
  badge: string;
  primaryColor: string;
  bgColor: string;
}

export const THEME_OPTIONS: ThemeMeta[] = [
  { id: "amber-default", name: "Modern Amber", badge: "Standart", primaryColor: "#e8792b", bgColor: "#f7f8fa" },
  { id: "emerald-finance", name: "Emerald Accounting", badge: "Yeşil Güven", primaryColor: "#10b981", bgColor: "#f0fdf4" },
  { id: "slate-mint", name: "Slate Minimal & Mint", badge: "Ferah", primaryColor: "#059669", bgColor: "#f1f5f9" },
  { id: "corporate-navy", name: "Corporate Indigo & Navy", badge: "Executive", primaryColor: "#6366f1", bgColor: "#0f172a" },
  { id: "dark-obsidian", name: "Midnight Cyber", badge: "Dark Mode", primaryColor: "#3b82f6", bgColor: "#09090b" },
  { id: "high-contrast", name: "High Contrast", badge: "Erişilebilir", primaryColor: "#eab308", bgColor: "#000000" },
];

interface ThemeContextType {
  theme: ThemeKey;
  setTheme: (theme: ThemeKey) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeKey>("amber-default");

  useEffect(() => {
    const savedTheme = localStorage.getItem("tekir_theme") as ThemeKey;
    if (savedTheme && THEME_OPTIONS.some((t) => t.id === savedTheme)) {
      setThemeState(savedTheme);
      document.documentElement.setAttribute("data-theme", savedTheme);
    } else {
      document.documentElement.setAttribute("data-theme", "amber-default");
    }
  }, []);

  const setTheme = (newTheme: ThemeKey) => {
    setThemeState(newTheme);
    localStorage.setItem("tekir_theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
