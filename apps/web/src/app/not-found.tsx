export default function NotFound() {
  return (
    <div style={{
      textAlign: "center",
      padding: "8rem 2rem",
      backgroundColor: "#0c0a09",
      color: "#fafaf9",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "sans-serif"
    }}>
      <h2 style={{ fontSize: "2rem", marginBottom: "1rem" }}>🐈 Sayfa Bulunamadı</h2>
      <p style={{ color: "#a8a29e", marginBottom: "2rem" }}>
        Aradığınız sayfa mevcut değil veya kaldırılmış olabilir.
      </p>
      <a href="/" style={{
        padding: "0.75rem 1.5rem",
        backgroundColor: "#7c3aed",
        color: "#ffffff",
        borderRadius: "0.5rem",
        textDecoration: "none",
        fontWeight: "600"
      }}>
        Ana Sayfaya Dön
      </a>
    </div>
  );
}
