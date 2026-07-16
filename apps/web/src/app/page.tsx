import Link from "next/link";

export default function AnaSayfa() {
  return (
    <main className="hero">
      <span className="hero__mark">🐈</span>
      <h1 className="hero__title">TekirExtra</h1>
      <p className="hero__sub">KOBİ&apos;ler için ön muhasebe ve dijital dönüşüm platformu.</p>
      <div className="hero__actions">
        <Link href="/giris" className="btn btn--primary">Giriş Yap</Link>
        <Link href="/kayit" className="btn btn--ghost">Kayıt Ol</Link>
      </div>
      <p className="hero__foot">
        API Sağlık Durumu: <code>http://localhost:3001/health</code>
      </p>
    </main>
  );
}
