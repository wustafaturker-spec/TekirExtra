import type { CSSProperties } from "react";

/** Geçici iskelet stilleri — kalıcı tasarım sistemi (shadcn/ui) 3. aşamada. */
export const stil = {
  sayfa: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f5f5f4",
  } as CSSProperties,
  kart: {
    background: "#fff",
    padding: "2rem",
    borderRadius: 12,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
    width: "100%",
    maxWidth: 420,
  } as CSSProperties,
  girdi: {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    padding: ".55rem .7rem",
    margin: ".25rem 0 .9rem",
    border: "1px solid #d6d3d1",
    borderRadius: 8,
    fontSize: "0.95rem",
  } as CSSProperties,
  dugme: {
    width: "100%",
    padding: ".6rem",
    background: "#1c1917",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: "0.95rem",
    cursor: "pointer",
  } as CSSProperties,
  hata: { color: "#b91c1c", fontSize: ".9rem", margin: ".5rem 0" } as CSSProperties,
  basari: { color: "#15803d", fontSize: ".9rem", margin: ".5rem 0" } as CSSProperties,
};
