"use client";

import Link from "next/link";
import { useState } from "react";

type ThemeKey = "amber-default" | "slate-mint" | "corporate-navy" | "dark-obsidian";

interface ThemeConfig {
  name: string;
  badge: string;
  bg: string;
  cardBg: string;
  cardBorder: string;
  sidebarBg: string;
  sidebarBorder: string;
  sidebarText: string;
  sidebarMuted: string;
  sidebarActiveBg: string;
  sidebarActiveText: string;
  headerBg: string;
  headerBorder: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  accentText: string;
  tableHeaderBg: string;
  rowBorder: string;
  inputBg: string;
  inputBorder: string;
  aiBg: string;
  aiBorder: string;
  aiText: string;
  isDark?: boolean;
}

const themes: Record<ThemeKey, ThemeConfig> = {
  "amber-default": {
    name: "1. Modern Amber (Standart)",
    badge: "CANLI TEMA",
    bg: "#f7f8fa",
    cardBg: "#ffffff",
    cardBorder: "#e6e9ee",
    sidebarBg: "#09090b",
    sidebarBorder: "#27272a",
    sidebarText: "#f8fafc",
    sidebarMuted: "#a1a1aa",
    sidebarActiveBg: "#e8792b",
    sidebarActiveText: "#ffffff",
    headerBg: "#ffffff",
    headerBorder: "#e2e8f0",
    text: "#18202f",
    textMuted: "#667085",
    textSubtle: "#98a2b3",
    accent: "#e8792b",
    accentStrong: "#d76c1f",
    accentSoft: "#fdefe2",
    accentText: "#b45613",
    tableHeaderBg: "#f8fafc",
    rowBorder: "#f1f5f9",
    inputBg: "#f1f5f9",
    inputBorder: "#cbd5e1",
    aiBg: "#fff7ed",
    aiBorder: "#ffedd5",
    aiText: "#9a3412",
  },
  "slate-mint": {
    name: "2. Slate Minimal & Mint",
    badge: "FERAH FERAH",
    bg: "#f1f5f9",
    cardBg: "#ffffff",
    cardBorder: "#e2e8f0",
    sidebarBg: "#0f172a",
    sidebarBorder: "#1e293b",
    sidebarText: "#f8fafc",
    sidebarMuted: "#94a3b8",
    sidebarActiveBg: "#10b981",
    sidebarActiveText: "#ffffff",
    headerBg: "#ffffff",
    headerBorder: "#e2e8f0",
    text: "#0f172a",
    textMuted: "#64748b",
    textSubtle: "#94a3b8",
    accent: "#10b981",
    accentStrong: "#059669",
    accentSoft: "#ecfdf5",
    accentText: "#047857",
    tableHeaderBg: "#f8fafc",
    rowBorder: "#f1f5f9",
    inputBg: "#f8fafc",
    inputBorder: "#cbd5e1",
    aiBg: "#ecfdf5",
    aiBorder: "#a7f3d0",
    aiText: "#065f46",
  },
  "corporate-navy": {
    name: "3. Corporate Indigo & Navy",
    badge: "EXECUTIVE PRO",
    bg: "#0f172a",
    cardBg: "#1e293b",
    cardBorder: "#334155",
    sidebarBg: "#020617",
    sidebarBorder: "#1e293b",
    sidebarText: "#f8fafc",
    sidebarMuted: "#64748b",
    sidebarActiveBg: "#6366f1",
    sidebarActiveText: "#ffffff",
    headerBg: "#1e293b",
    headerBorder: "#334155",
    text: "#f8fafc",
    textMuted: "#94a3b8",
    textSubtle: "#64748b",
    accent: "#6366f1",
    accentStrong: "#4f46e5",
    accentSoft: "rgba(99, 102, 241, 0.15)",
    accentText: "#818cf8",
    tableHeaderBg: "#0f172a",
    rowBorder: "#334155",
    inputBg: "#0f172a",
    inputBorder: "#475569",
    aiBg: "rgba(99, 102, 241, 0.12)",
    aiBorder: "rgba(99, 102, 241, 0.3)",
    aiText: "#c7d2fe",
    isDark: true,
  },
  "dark-obsidian": {
    name: "4. Midnight Cyber (Dark)",
    badge: "DARK MODE",
    bg: "#09090b",
    cardBg: "#18181b",
    cardBorder: "#27272a",
    sidebarBg: "#000000",
    sidebarBorder: "#18181b",
    sidebarText: "#fafafa",
    sidebarMuted: "#71717a",
    sidebarActiveBg: "#2563eb",
    sidebarActiveText: "#ffffff",
    headerBg: "#18181b",
    headerBorder: "#27272a",
    text: "#fafafa",
    textMuted: "#a1a1aa",
    textSubtle: "#71717a",
    accent: "#3b82f6",
    accentStrong: "#2563eb",
    accentSoft: "rgba(59, 130, 246, 0.15)",
    accentText: "#60a5fa",
    tableHeaderBg: "#09090b",
    rowBorder: "#27272a",
    inputBg: "#09090b",
    inputBorder: "#3f3f46",
    aiBg: "rgba(59, 130, 246, 0.12)",
    aiBorder: "rgba(59, 130, 246, 0.3)",
    aiText: "#93c5fd",
    isDark: true,
  },
};

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  badge?: string;
  badgeColor?: string;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

const menuSections: MenuSection[] = [
  {
    title: "GENEL",
    items: [
      { id: "dashboard", label: "Özet & Finans", icon: "📊" },
      { id: "ai-assistant", label: "AI Finans Asistanı", icon: "✨", badge: "YENİ", badgeColor: "#8b5cf6" },
    ],
  },
  {
    title: "SATIŞ & GİDER",
    items: [
      { id: "faturalar", label: "Fatura Operasyonları", icon: "📄", badge: "14", badgeColor: "#ef4444" },
      { id: "cariler", label: "Müşteri & Cariler", icon: "👥" },
      { id: "stok", label: "Stok & Depo Yönetimi", icon: "📦" },
    ],
  },
  {
    title: "BANKA & FİNANS",
    items: [
      { id: "bankalar", label: "Banka Hesapları & POS", icon: "💳" },
      { id: "kasa", label: "Nakit & Kasa Takibi", icon: "💰" },
      { id: "raporlar", label: "Mali Raporlar & KDV", icon: "📈" },
    ],
  },
  {
    title: "SİSTEM",
    items: [
      { id: "entegrasyon", label: "e-Fatura Entegrasyonu", icon: "🔌" },
      { id: "ayarlar", label: "Firma Ayarları", icon: "⚙️" },
    ],
  },
];

export default function UIOrnekSayfasi() {
  const [activeThemeKey, setActiveThemeKey] = useState<ThemeKey>("amber-default");
  const [activeTab, setActiveTab] = useState("ozet");
  const [activeMenuItem, setActiveMenuItem] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const t = themes[activeThemeKey];

  return (
    <div style={{ minHeight: "100vh", backgroundColor: t.bg, color: t.text, fontFamily: "system-ui, -apple-system, sans-serif", transition: "all 0.25s ease" }}>

      {/* Top Dynamic Theme Switcher Bar */}
      <div style={{ backgroundColor: t.sidebarBg, padding: "10px 24px", color: "#ffffff", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${t.sidebarBorder}`, zIndex: 100, position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: "600" }}>
          <span>🎨 Canlı Tema Önizleme Modu:</span>
          <span style={{ backgroundColor: t.accent, color: "#fff", padding: "2px 8px", borderRadius: "12px", fontSize: "11px" }}>{t.badge}</span>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {(Object.keys(themes) as ThemeKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setActiveThemeKey(key)}
              style={{
                padding: "6px 14px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: activeThemeKey === key ? "700" : "500",
                backgroundColor: activeThemeKey === key ? t.accent : "rgba(255,255,255,0.1)",
                color: "#ffffff",
                border: "none",
                cursor: "pointer",
                transition: "background 0.2s"
              }}
            >
              {themes[key].name}
            </button>
          ))}
        </div>
      </div>

      {/* Main Layout Container (Sidebar + Content) */}
      <div style={{ display: "flex", minHeight: "calc(100vh - 45px)" }}>

        {/* 🌟 Interactive Left Sidebar Menu 🌟 */}
        <aside
          style={{
            width: sidebarCollapsed ? "72px" : "250px",
            backgroundColor: t.sidebarBg,
            borderRight: `1px solid ${t.sidebarBorder}`,
            display: "flex",
            flexDirection: "column",
            transition: "width 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
            padding: "16px 12px",
            gap: "20px",
            flexShrink: 0,
            userSelect: "none"
          }}
        >
          {/* Brand Logo & Collapse Toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: sidebarCollapsed ? "center" : "space-between", paddingInline: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: `linear-gradient(135deg, ${t.accent} 0%, ${t.accentStrong} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#ffffff", fontWeight: "bold", fontSize: "16px", flexShrink: 0 }}>
                T
              </div>
              {!sidebarCollapsed && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "15px", fontWeight: "800", color: t.sidebarText, letterSpacing: "-0.01em" }}>TekirExtra</span>
                  <span style={{ fontSize: "10px", color: t.sidebarMuted, fontWeight: "600" }}>SaaS Ön Muhasebe</span>
                </div>
              )}
            </div>

            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? "Menüyü Genişlet" : "Menüyü Daralt"}
              style={{
                width: "24px",
                height: "24px",
                borderRadius: "6px",
                border: `1px solid ${t.sidebarBorder}`,
                backgroundColor: "rgba(255,255,255,0.05)",
                color: t.sidebarMuted,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: "12px"
              }}
            >
              {sidebarCollapsed ? "➔" : "⬅"}
            </button>
          </div>

          {/* Navigation Items */}
          <nav style={{ display: "flex", flexDirection: "column", gap: "16px", flex: 1, overflowY: "auto" }}>
            {menuSections.map((section, idx) => (
              <div key={idx} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {!sidebarCollapsed && (
                  <div style={{ fontSize: "10px", fontWeight: "800", color: t.accent, paddingInline: "8px", letterSpacing: "0.08em", marginBottom: "2px" }}>
                    {section.title}
                  </div>
                )}
                {section.items.map((item) => {
                  const isActive = activeMenuItem === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveMenuItem(item.id)}
                      title={sidebarCollapsed ? item.label : undefined}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: sidebarCollapsed ? "center" : "space-between",
                        padding: sidebarCollapsed ? "10px" : "8px 12px",
                        borderRadius: "8px",
                        fontSize: "13px",
                        fontWeight: isActive ? "700" : "500",
                        backgroundColor: isActive ? t.sidebarActiveBg : "transparent",
                        color: isActive ? t.sidebarActiveText : t.sidebarMuted,
                        border: "none",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        textAlign: "left",
                        width: "100%"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "16px", flexShrink: 0 }}>{item.icon}</span>
                        {!sidebarCollapsed && <span>{item.label}</span>}
                      </div>

                      {!sidebarCollapsed && item.badge && (
                        <span style={{ backgroundColor: item.badgeColor || t.accent, color: "#fff", fontSize: "10px", fontWeight: "700", padding: "1px 6px", borderRadius: "10px" }}>
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* User Profile Card at Sidebar Bottom */}
          <div style={{ borderTop: `1px solid ${t.sidebarBorder}`, paddingTop: "14px", display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "34px", height: "34px", borderRadius: "50%", backgroundColor: t.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "13px", flexShrink: 0 }}>
              MK
            </div>
            {!sidebarCollapsed && (
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: "12px", fontWeight: "700", color: t.sidebarText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Mustafa Yılmaz</span>
                <span style={{ fontSize: "10px", color: t.sidebarMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Tekir Lojistik A.Ş.</span>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content Area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

          {/* Header Bar */}
          <header style={{ backgroundColor: t.headerBg, borderBottom: `1px solid ${t.headerBorder}`, padding: "16px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h1 style={{ fontSize: "18px", fontWeight: "700", margin: 0, lineHeight: 1.2 }}>
                TekirExtra <span style={{ fontSize: "11px", backgroundColor: t.accentSoft, color: t.accentText, padding: "2px 8px", borderRadius: "12px", fontWeight: "600" }}>MENÜ & TEMA DEMO</span>
              </h1>
              <p style={{ fontSize: "12px", color: t.textMuted, margin: 0 }}>Gelişmiş Sol Menü & Canlı Tema Switcher Entegrasyonu</p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  placeholder="Hızlı Arama (⌘K)..."
                  style={{ backgroundColor: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text, borderRadius: "8px", padding: "8px 14px 8px 32px", fontSize: "13px", width: "240px", outline: "none" }}
                />
                <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", fontSize: "14px", color: t.textMuted }}>🔍</span>
              </div>
              <Link href="/panel" style={{ padding: "8px 16px", backgroundColor: t.accent, color: "#ffffff", borderRadius: "8px", textDecoration: "none", fontSize: "13px", fontWeight: "600", boxShadow: `0 2px 8px ${t.accent}40` }}>
                Mevcut Panele Dön →
              </Link>
            </div>
          </header>

          {/* Main Dashboard Content */}
          <main style={{ maxWidth: "1280px", width: "100%", margin: "0 auto", padding: "32px 24px", flex: 1 }}>

            {/* Page Title & Quick Actions */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "24px" }}>
              <div>
                <h2 style={{ fontSize: "24px", fontWeight: "800", margin: "0 0 4px 0" }}>Finansal Durum & Analiz</h2>
                <p style={{ fontSize: "14px", color: t.textMuted, margin: 0 }}>Bugünün canlı nakit akışı ve fatura operasyon özetiniz</p>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button style={{ padding: "10px 16px", backgroundColor: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: "8px", fontSize: "13px", fontWeight: "600", cursor: "pointer", color: t.text }}>
                  📥 Rapor Dışa Aktar
                </button>
                <button style={{ padding: "10px 16px", backgroundColor: t.accent, border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: "600", cursor: "pointer", color: "#ffffff", boxShadow: `0 2px 8px ${t.accent}40` }}>
                  + Yeni Fatura Oluştur
                </button>
              </div>
            </div>

            {/* Tab Navigation */}
            <div style={{ display: "flex", gap: "8px", borderBottom: `1px solid ${t.cardBorder}`, marginBottom: "24px" }}>
              {["ozet", "tahsilatlar", "odemeler", "nakit-akisi"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "10px 16px",
                    fontSize: "14px",
                    fontWeight: activeTab === tab ? "700" : "500",
                    color: activeTab === tab ? t.accent : t.textMuted,
                    borderBottom: activeTab === tab ? `2px solid ${t.accent}` : "2px solid transparent",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    textTransform: "capitalize"
                  }}
                >
                  {tab === "ozet" ? "Genel Özet" : tab === "tahsilatlar" ? "Bekleyen Tahsilatlar" : tab === "odemeler" ? "Gelecek Ödemeler" : "Nakit Akışı"}
                </button>
              ))}
            </div>

            {/* Top Metric Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px", marginBottom: "32px" }}>

              <div style={{ backgroundColor: t.cardBg, padding: "20px", borderRadius: "12px", border: `1px solid ${t.cardBorder}`, boxShadow: "0 2px 6px rgba(0,0,0,0.03)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: t.textMuted, fontSize: "13px", fontWeight: "500", marginBottom: "8px" }}>
                  <span>Nakit & Banka Varlıkları</span>
                  <span style={{ backgroundColor: "#dcfce7", color: "#15803d", padding: "2px 6px", borderRadius: "6px", fontSize: "11px", fontWeight: "700" }}>+12.4%</span>
                </div>
                <div style={{ fontSize: "24px", fontWeight: "800", color: t.text, marginBottom: "4px" }}>₺1.428.500,00</div>
                <div style={{ fontSize: "12px", color: t.textSubtle }}>3 farklı banka hesabında aktif bakiyeler</div>
              </div>

              <div style={{ backgroundColor: t.cardBg, padding: "20px", borderRadius: "12px", border: `1px solid ${t.cardBorder}`, boxShadow: "0 2px 6px rgba(0,0,0,0.03)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: t.textMuted, fontSize: "13px", fontWeight: "500", marginBottom: "8px" }}>
                  <span>Beklenen Alacaklar</span>
                  <span style={{ backgroundColor: "#fef3c7", color: "#b45309", padding: "2px 6px", borderRadius: "6px", fontSize: "11px", fontWeight: "700" }}>5 Vadesi Geçen</span>
                </div>
                <div style={{ fontSize: "24px", fontWeight: "800", color: t.text, marginBottom: "4px" }}>₺342.180,50</div>
                <div style={{ fontSize: "12px", color: t.textSubtle }}>Bu ay tahsil edilecek 14 adet fatura</div>
              </div>

              <div style={{ backgroundColor: t.cardBg, padding: "20px", borderRadius: "12px", border: `1px solid ${t.cardBorder}`, boxShadow: "0 2px 6px rgba(0,0,0,0.03)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: t.textMuted, fontSize: "13px", fontWeight: "500", marginBottom: "8px" }}>
                  <span>Ödenecek Borçlar</span>
                  <span style={{ backgroundColor: "#fee2e2", color: "#dc2626", padding: "2px 6px", borderRadius: "6px", fontSize: "11px", fontWeight: "700" }}>Bu Hafta</span>
                </div>
                <div style={{ fontSize: "24px", fontWeight: "800", color: t.text, marginBottom: "4px" }}>₺189.400,00</div>
                <div style={{ fontSize: "12px", color: t.textSubtle }}>Tedarikçilere ödenmesi gereken tutar</div>
              </div>

              <div style={{ backgroundColor: t.cardBg, padding: "20px", borderRadius: "12px", border: `1px solid ${t.cardBorder}`, boxShadow: "0 2px 6px rgba(0,0,0,0.03)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: t.textMuted, fontSize: "13px", fontWeight: "500", marginBottom: "8px" }}>
                  <span>Net Stok Değeri</span>
                  <span style={{ backgroundColor: t.inputBg, color: t.textMuted, padding: "2px 6px", borderRadius: "6px", fontSize: "11px", fontWeight: "700" }}>84 SKU</span>
                </div>
                <div style={{ fontSize: "24px", fontWeight: "800", color: t.text, marginBottom: "4px" }}>₺895.000,00</div>
                <div style={{ fontSize: "12px", color: t.textSubtle }}>Kritik stok seviyesinde 3 ürün var</div>
              </div>

            </div>

            {/* Content Section: Modern Table & Chart Placeholder */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "24px" }}>

              {/* Table Card */}
              <div style={{ backgroundColor: t.cardBg, borderRadius: "12px", border: `1px solid ${t.cardBorder}`, padding: "20px", boxShadow: "0 2px 6px rgba(0,0,0,0.03)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <h3 style={{ fontSize: "16px", fontWeight: "700", margin: 0 }}>Son Fatura İşlemleri</h3>
                  <button style={{ fontSize: "13px", color: t.accent, fontWeight: "600", background: "none", border: "none", cursor: "pointer" }}>Tümünü Gör →</button>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${t.cardBorder}`, color: t.textMuted, backgroundColor: t.tableHeaderBg }}>
                        <th style={{ padding: "10px 8px", fontWeight: "600" }}>Fatura No</th>
                        <th style={{ padding: "10px 8px", fontWeight: "600" }}>Müşteri / Cari</th>
                        <th style={{ padding: "10px 8px", fontWeight: "600" }}>Vade Tarihi</th>
                        <th style={{ padding: "10px 8px", fontWeight: "600" }}>Durum</th>
                        <th style={{ padding: "10px 8px", fontWeight: "600", textAlign: "right" }}>Tutar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { no: "FTR-2026-00412", cari: "ACME Lojistik A.Ş.", vade: "24 Ağu 2026", durum: "Tahsil Edildi", durumRenk: "#dcfce7", durumYazi: "#15803d", tutar: "₺45.200,00" },
                        { no: "FTR-2026-00411", cari: "TeknoSoft Yazılım Ltd.", vade: "28 Ağu 2026", durum: "Bekliyor", durumRenk: "#fef3c7", durumYazi: "#b45309", tutar: "₺18.900,00" },
                        { no: "FTR-2026-00410", cari: "Kutup Gıda Tedarik", vade: "18 Ağu 2026", durum: "Gecikmede", durumRenk: "#fee2e2", durumYazi: "#dc2626", tutar: "₺128.450,00" },
                        { no: "FTR-2026-00409", cari: "Bosphorus Mimarlık", vade: "02 Eylül 2026", durum: "Taslak", durumRenk: t.inputBg, durumYazi: t.textMuted, tutar: "₺9.600,00" },
                      ].map((row, index) => (
                        <tr key={index} style={{ borderBottom: `1px solid ${t.rowBorder}` }}>
                          <td style={{ padding: "12px 8px", fontWeight: "600", color: t.text }}>{row.no}</td>
                          <td style={{ padding: "12px 8px", color: t.textMuted }}>{row.cari}</td>
                          <td style={{ padding: "12px 8px", color: t.textSubtle }}>{row.vade}</td>
                          <td style={{ padding: "12px 8px" }}>
                            <span style={{ backgroundColor: row.durumRenk, color: row.durumYazi, padding: "3px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: "700" }}>
                              {row.durum}
                            </span>
                          </td>
                          <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: "700", color: t.text }}>{row.tutar}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right Info / Action Card */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ backgroundColor: t.cardBg, borderRadius: "12px", border: `1px solid ${t.cardBorder}`, padding: "20px", boxShadow: "0 2px 6px rgba(0,0,0,0.03)" }}>
                  <h3 style={{ fontSize: "15px", fontWeight: "700", margin: "0 0 12px 0" }}>Hızlı İşlemler</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <button style={{ padding: "10px 12px", backgroundColor: t.tableHeaderBg, border: `1px solid ${t.cardBorder}`, borderRadius: "8px", textAlign: "left", fontSize: "13px", fontWeight: "600", cursor: "pointer", color: t.text }}>
                      📄 e-Fatura / e-Arşiv Gönder
                    </button>
                    <button style={{ padding: "10px 12px", backgroundColor: t.tableHeaderBg, border: `1px solid ${t.cardBorder}`, borderRadius: "8px", textAlign: "left", fontSize: "13px", fontWeight: "600", cursor: "pointer", color: t.text }}>
                      💳 Banka Ekstresi İçe Aktar (Excel)
                    </button>
                    <button style={{ padding: "10px 12px", backgroundColor: t.tableHeaderBg, border: `1px solid ${t.cardBorder}`, borderRadius: "8px", textAlign: "left", fontSize: "13px", fontWeight: "600", cursor: "pointer", color: t.text }}>
                      👥 Yeni Cari Müşteri Ekle
                    </button>
                  </div>
                </div>

                <div style={{ backgroundColor: t.aiBg, borderRadius: "12px", border: `1px solid ${t.aiBorder}`, padding: "20px" }}>
                  <div style={{ fontSize: "12px", color: t.accent, fontWeight: "700", textTransform: "uppercase", marginBottom: "4px" }}>AI İpucu</div>
                  <h4 style={{ fontSize: "14px", fontWeight: "700", color: t.aiText, margin: "0 0 6px 0" }}>Tahsilat Gecikme Uyarısı</h4>
                  <p style={{ fontSize: "12px", color: t.textMuted, margin: 0, lineHeight: 1.5 }}>
                    Kutup Gıda Tedarik firmasına ait ₺128.450,00 tutarındaki faturanın vadesi 5 gün geçti. Otomatik hatırlatma e-postası gönderebilirsiniz.
                  </p>
                </div>
              </div>

            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
