export default function AnaSayfa() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>
          🐈 TekirExtra
        </h1>
        <p style={{ color: "#555" }}>
          KOBİ&apos;ler için ön muhasebe — iskelet çalışıyor.
        </p>
        <p style={{ color: "#999", fontSize: "0.9rem" }}>
          API sağlık durumu: <code>http://localhost:3001/health</code>
        </p>
      </div>
    </main>
  );
}
