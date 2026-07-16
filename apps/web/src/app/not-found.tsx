export default function NotFound() {
  return (
    <div className="hero">
      <span className="hero__mark">🐈</span>
      <h2 className="hero__title" style={{ fontSize: "2rem" }}>Sayfa Bulunamadı</h2>
      <p className="hero__sub">Aradığınız sayfa mevcut değil veya kaldırılmış olabilir.</p>
      <div className="hero__actions">
        <a href="/" className="btn btn--primary">Ana Sayfaya Dön</a>
      </div>
    </div>
  );
}
