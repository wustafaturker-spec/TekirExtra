import type { CSSProperties } from "react";

/**
 * Premium SaaS Tasarım Sistemi Stilleri (EBLG-01, Stil Güncellemesi).
 * Obsidian dark mode, glassmorphism ve canlı mor/indigo geçişleri barındırır.
 */
export const stil = {
  sayfa: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "row",
    background: "#09090b", // Deep zinc black
    color: "#fafaf9", // Warm white
    fontFamily: "'Inter', sans-serif",
  } as CSSProperties,
  
  // ─── LOBBY / GİRİŞ SAYFALARI İÇİN ──────────────────────────────────────────
  girisKonteyner: {
    minHeight: "100vh",
    width: "100vw",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "radial-gradient(circle at top left, #1e1b4b 0%, #09090b 100%)",
  } as CSSProperties,

  kart: {
    background: "rgba(24, 24, 27, 0.75)", // glassmorphism card
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    padding: "2.5rem",
    borderRadius: 16,
    border: "1px solid rgba(63, 63, 70, 0.4)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
    width: "100%",
    maxWidth: 440,
  } as CSSProperties,

  // ─── PANEL GÖRÜNÜMÜ VE KARTLARI ───────────────────────────────────────────
  genisKart: {
    background: "rgba(24, 24, 27, 0.5)",
    backdropFilter: "blur(8px)",
    padding: "2rem",
    borderRadius: 16,
    border: "1px solid rgba(63, 63, 70, 0.3)",
    width: "100%",
    boxSizing: "border-box",
  } as CSSProperties,

  ozetKart: {
    flex: "1",
    minWidth: "220px",
    background: "linear-gradient(135deg, rgba(39, 39, 42, 0.5) 0%, rgba(24, 24, 27, 0.5) 100%)",
    padding: "1.5rem",
    borderRadius: 12,
    border: "1px solid rgba(63, 63, 70, 0.3)",
    boxSizing: "border-box",
  } as CSSProperties,

  grid: {
    display: "flex",
    flexWrap: "wrap",
    gap: "1.5rem",
    width: "100%",
    boxSizing: "border-box",
  } as CSSProperties,

  // ─── FORM ELEMANLARI ──────────────────────────────────────────────────────
  girdi: {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    padding: "0.7rem 0.9rem",
    margin: "0.4rem 0 1.2rem",
    background: "#18181b",
    color: "#fafaf9",
    border: "1px solid #3f3f46",
    borderRadius: 8,
    fontSize: "0.95rem",
    outline: "none",
    transition: "border-color 0.2s",
  } as CSSProperties,

  dugme: {
    width: "100%",
    padding: "0.75rem",
    background: "linear-gradient(90deg, #7c3aed 0%, #4f46e5 100%)", // violet to indigo gradient
    color: "#ffffff",
    border: "none",
    borderRadius: 8,
    fontSize: "0.95rem",
    fontWeight: "600",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(124, 58, 237, 0.25)",
    transition: "opacity 0.2s",
  } as CSSProperties,

  dugmeMuted: {
    width: "auto",
    padding: "0.5rem 1rem",
    background: "#27272a",
    color: "#a1a1aa",
    border: "1px solid #3f3f46",
    borderRadius: 8,
    fontSize: "0.875rem",
    fontWeight: "500",
    cursor: "pointer",
  } as CSSProperties,

  // ─── YAN MENÜ (SIDEBAR) STİLLERİ ──────────────────────────────────────────
  sidebar: {
    width: "260px",
    background: "#09090b",
    borderRight: "1px solid rgba(63, 63, 70, 0.4)",
    padding: "2rem 1.5rem",
    display: "flex",
    flexDirection: "column",
    gap: "2rem",
    minHeight: "100vh",
    boxSizing: "border-box",
  } as CSSProperties,

  sidebarLink: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    color: "#a1a1aa",
    textDecoration: "none",
    padding: "0.65rem 0.85rem",
    borderRadius: 8,
    fontSize: "0.95rem",
    fontWeight: "500",
    transition: "all 0.2s",
  } as CSSProperties,

  sidebarLinkAktif: {
    color: "#fafaf9",
    background: "rgba(124, 58, 237, 0.15)",
    border: "1px solid rgba(124, 58, 237, 0.3)",
  } as CSSProperties,

  // ─── TABLOLAR VE LİSTELER ─────────────────────────────────────────────────
  tablo: {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: "1rem",
  } as CSSProperties,

  tabloBaslik: {
    background: "#18181b",
    color: "#a1a1aa",
    textAlign: "left",
    padding: "0.85rem 1rem",
    fontWeight: "600",
    fontSize: "0.85rem",
    borderBottom: "1px solid #27272a",
  } as CSSProperties,

  tabloHucre: {
    padding: "1rem",
    borderBottom: "1px solid #27272a",
    fontSize: "0.9rem",
  } as CSSProperties,

  // ─── DURUM & ETİKET RENKLERİ ──────────────────────────────────────────────
  hata: { color: "#ef4444", fontSize: ".9rem", margin: ".5rem 0", fontWeight: "500" } as CSSProperties,
  basari: { color: "#22c55e", fontSize: ".9rem", margin: ".5rem 0", fontWeight: "500" } as CSSProperties,
};
