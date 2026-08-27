import Link from "next/link";

export default function AnaSayfa() {
  return (
    <div className="landing-container">
      {/* Üst Navigasyon Çubuğu */}
      <header className="landing-header">
        <div className="landing-header__inner">
          <Link href="/" className="landing-logo">
            <span className="landing-logo__mark">TE</span>
            <span className="landing-logo__text">Tekir<b>Extra</b></span>
          </Link>

          <nav className="landing-nav">
            <a href="#ozellikler">Özellikler</a>
            <a href="#moduller">Modüller</a>
            <a href="#entegrasyonlar">Entegrasyonlar</a>
            <a href="http://localhost:3001/health" target="_blank" rel="noreferrer" className="api-status-badge">
              <span className="status-dot"></span> API Canlı
            </a>
          </nav>

          <div className="landing-header__actions">
            <Link href="/giris" className="btn btn--ghost">Giriş Yap</Link>
            <Link href="/giris" className="btn btn--primary">Hemen Başlayın →</Link>
          </div>
        </div>
      </header>

      {/* Hero Bölümü */}
      <section className="landing-hero">
        <div className="hero-badge">
          <span className="badge-sparkle">✨</span> KOBİ'ler İçin Yeni Nesil Ön Muhasebe & ERP
        </div>
        <h1 className="hero-title">
          Finans, Stok ve E-Fatura Süreçlerinizi <br className="hero-br" />
          <span className="hero-highlight">Tek Ekrandan Yönetin</span>
        </h1>
        <p className="hero-subtitle">
          Karmaşık ve hantal yazılımları unutun. TekirExtra ile faturalama, cari hesaplar, kur farkı, banka hareketleri ve personel bordroları saniyeler içinde parmaklarınızın ucunda.
        </p>
        <div className="hero-cta-group">
          <Link href="/giris" className="btn btn--primary btn--hero">
            ⚡ Giriş Ekranına Git
          </Link>
          <Link href="#ozellikler" className="btn btn--ghost btn--hero">
            🔍 Özellikleri Keşfet
          </Link>
        </div>

        <div className="hero-trust-tags">
          <span>✔ E-Fatura & E-Arşiv Uyumlu</span>
          <span>✔ Otomatik TCMB Kur Entegrasyonu</span>
          <span>✔ 7/24 Güvenli Bulut Erişim</span>
        </div>

        {/* Görsel Dashboard Önizleme Card */}
        <div className="landing-mockup">
          <div className="mockup-header">
            <div className="mockup-dots">
              <span className="dot dot--red"></span>
              <span className="dot dot--yellow"></span>
              <span className="dot dot--green"></span>
            </div>
            <div className="mockup-url">app.tekirextra.com/panel</div>
          </div>
          <div className="mockup-body">
            <div className="mockup-grid">
              <div className="mockup-stat-card">
                <span className="stat-label">Bu Ayki Satışlar</span>
                <strong className="stat-val">₺ 428.500,00</strong>
                <span className="stat-change positive">↑ %18.4 bu ay</span>
              </div>
              <div className="mockup-stat-card">
                <span className="stat-label">Bekleyen Tahsilatlar</span>
                <strong className="stat-val">₺ 94.200,00</strong>
                <span className="stat-change warning">6 Cari Hesap</span>
              </div>
              <div className="mockup-stat-card">
                <span className="stat-label">Gelen E-Faturalar</span>
                <strong className="stat-val">14 Adet</strong>
                <span className="stat-change info">Onay Bekliyor</span>
              </div>
              <div className="mockup-stat-card">
                <span className="stat-label">TCMB Dolar Kuru</span>
                <strong className="stat-val">₺ 36,45</strong>
                <span className="stat-change">Otomatik Güncel</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Özellikler ve Modüller Grid */}
      <section id="ozellikler" className="landing-features">
        <div className="section-header">
          <h2>İhtiyacınız Olan Tüm Ön Muhasebe Modülleri</h2>
          <p>KOBİ'lerin günlük operasyonlarını hızlandıran modüler çözüm yapısı</p>
        </div>

        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">🧾</div>
            <h3>E-Fatura & E-Belge</h3>
            <p>Gelen ve giden tüm e-faturalarınızı GİB entegrasyonu ile otomatik işleyin, PDF indirin ve arşivleyin.</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">📦</div>
            <h3>Stok & SMM Yönetimi</h3>
            <p>Satılan Malın Maliyeti (SMM) anlık hesaplaması, kritik stok seviyesi uyarıları ve depo transferleri.</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">💱</div>
            <h3>Dövizli Cari & Kur Farkı</h3>
            <p>TCMB kurları üzerinden carilerde otomatik kur farkı fişleri ve faturaları oluşturun, mutabakat sağlayın.</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">👥</div>
            <h3>Personel & Bordro</h3>
            <p>Maaş, avans, izin takibi ve SGK simülasyon süreçlerini eksiksiz ve yasal mevzuata uygun şekilde yönetin.</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">📊</div>
            <h3>Pivot & Gelir-Gider Analizleri</h3>
            <p>Finansal durumunuzu gelişmiş pivot grafikler ve karşılaştırmalı gelir-gider raporları ile izleyin.</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">🏦</div>
            <h3>Kasa & Banka Hareketleri</h3>
            <p>Çek, senet ve banka nakit akışını gün saat fark etmeksizin detaylı olarak takip edin ve raporlayın.</p>
          </div>
        </div>
      </section>

      {/* Alt Altlık / Footer */}
      <footer className="landing-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <span className="landing-logo__mark">TE</span>
            <span>Tekir<b>Extra</b> KOBİ Platformu</span>
          </div>
          <div className="footer-links">
            <Link href="/giris">Giriş Yap</Link>
            <Link href="/kayit">Firma Kaydı</Link>
            <a href="http://localhost:3001/health" target="_blank" rel="noreferrer">API Sağlık</a>
          </div>
          <div className="footer-copy">
            © {new Date().getFullYear()} TekirExtra. Tüm hakları saklıdır.
          </div>
        </div>
      </footer>
    </div>
  );
}
