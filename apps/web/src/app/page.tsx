import Link from "next/link";

export default function AnaSayfa() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0c0a09",
        color: "#fafaf9",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "3rem", marginBottom: "0.5rem", fontWeight: "bold" }}>
          🐈 TekirExtra
        </h1>
        <p style={{ color: "#a8a29e", marginBottom: "2rem" }}>
          KOBİ&apos;ler için ön muhasebe ve dijital dönüşüm platformu.
        </p>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", marginBottom: "2rem" }}>
          <Link
            href="/giris"
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: "#7c3aed",
              color: "#ffffff",
              borderRadius: "0.5rem",
              textDecoration: "none",
              fontWeight: "600",
            }}
          >
            Giriş Yap
          </Link>
          <Link
            href="/kayit"
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: "#292524",
              color: "#fafaf9",
              borderRadius: "0.5rem",
              textDecoration: "none",
              border: "1px solid #44403c",
              fontWeight: "600",
            }}
          >
            Kayıt Ol
          </Link>
        </div>
        <p style={{ color: "#78716c", fontSize: "0.9rem" }}>
          API Sağlık Durumu: <code style={{ color: "#a78bfa" }}>http://localhost:3001/health</code>
        </p>
      </div>
    </main>
  );
}
