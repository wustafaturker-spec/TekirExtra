"use client";

import { guvenliDonus } from "@/lib/oturum-isareti";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, ApiHata, tokenYaz } from "@/lib/api";
import { Alert, Button, Field, Input } from "@/components/ui";

export default function GirisSayfasi() {
  const yonlendir = useRouter();
  const pathname = usePathname();
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);
  const [totpGerekli, setTotpGerekli] = useState(false);
  const [parolaGoster, setParolaGoster] = useState(false);
  const [eposta, setEposta] = useState("");
  const [parola, setParola] = useState("");

  useEffect(() => {
    // Rota koruması panelden buraya yönlendirdiyse ve yenileme çerezi geçerliyse oturum
    // sessizce tazelenir (işaret çerezi yeniden konur) ve kullanıcı istediği sayfaya döner.
    const params = new URLSearchParams(window.location.search);
    if (params.get("oturum") !== "gerekli") return;
    let iptal = false;
    void api<{ accessToken: string }>("/auth/yenile", { method: "POST" })
      .then((s) => { if (!iptal) { tokenYaz(s.accessToken); yonlendir.replace(guvenliDonus(params.get("donus"))); } })
      .catch(() => undefined);
    return () => { iptal = true; };
  }, [yonlendir]);

  useEffect(() => {
    // Güvenlik: URL querystring içerisinde hassas veri (parola vb.) sızmasını engeller
    if (typeof window !== "undefined" && window.location.search) {
      const params = new URLSearchParams(window.location.search);
      if (params.has("parola") || params.has("eposta")) {
        window.history.replaceState(null, "", pathname);
      }
    }
  }, [pathname]);

  async function girisYap(epostaVal: string, parolaVal: string, totpVal?: string) {
    setHata("");
    setYukleniyor(true);
    try {
      const sonuc = await api<{ accessToken: string }>("/auth/giris", {
        method: "POST",
        body: JSON.stringify({
          eposta: epostaVal,
          parola: parolaVal,
          totpKodu: totpVal || undefined,
        }),
      });
      tokenYaz(sonuc.accessToken);
      // Rota koruması giriş sayfasına yönlendirdiyse kullanıcı istediği panel sayfasına döner.
      yonlendir.push(guvenliDonus(new URLSearchParams(window.location.search).get("donus")));
    } catch (h) {
      const mesaj = h instanceof ApiHata ? h.message : "Giriş başarısız. Lütfen bilgilerinizi kontrol edin.";
      if (mesaj.includes("TOTP")) setTotpGerekli(true);
      setHata(mesaj);
    } finally {
      setYukleniyor(false);
    }
  }

  async function gonder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = new FormData(e.currentTarget);
    const epostaVal = String(v.get("eposta") || "");
    const parolaVal = String(v.get("parola") || "");
    const totpVal = String(v.get("totpKodu") || "");
    await girisYap(epostaVal, parolaVal, totpVal);
  }

  const demoGirisYap = (demoEposta: string, demoParola: string) => {
    setEposta(demoEposta);
    setParola(demoParola);
    girisYap(demoEposta, demoParola);
  };

  return (
    <main className="auth-page-container">
      <div className="auth-split-layout">
        {/* Sol Taraf: Marka & Görsel Tanıtım */}
        <div className="auth-banner">
          <div className="auth-banner__content">
            <Link href="/" className="auth-brand-logo">
              <span className="auth-brand-mark">TE</span>
              <span className="auth-brand-name">Tekir<b>Extra</b></span>
            </Link>

            <div className="auth-banner__hero">
              <h2>KOBİ'ler İçin Akıllı Ön Muhasebe & ERP</h2>
              <p>
                E-Fatura, Stok & SMM takibi, Kur Farkı hesaplamaları ve Gelişmiş Personel Bordro modülü ile işinizi tek ekrandan yönetin.
              </p>
            </div>

            <div className="auth-banner__features">
              <div className="auth-feature-pill">
                <span className="pill-icon">⚡</span>
                <div>
                  <strong>Hızlı E-Dönüşüm</strong>
                  <span>Gelen/Giden E-Faturalar anında sistemde</span>
                </div>
              </div>
              <div className="auth-feature-pill">
                <span className="pill-icon">📊</span>
                <div>
                  <strong>Otomatik Kur Farkı</strong>
                  <span>Dövizli carilerde anlık hesaplama</span>
                </div>
              </div>
              <div className="auth-feature-pill">
                <span className="pill-icon">🔒</span>
                <div>
                  <strong>Güvenli Altyapı</strong>
                  <span>2FA TOTP ve rol bazlı erişim yetkileri</span>
                </div>
              </div>
            </div>

            <div className="auth-banner__footer">
              © {new Date().getFullYear()} TekirExtra. Tüm hakları saklıdır.
            </div>
          </div>
        </div>

        {/* Sağ Taraf: Giriş Formu */}
        <div className="auth-form-side">
          <div className="auth-card-modern">
            <div className="auth-header">
              <h1>Hoş Geldiniz 👋</h1>
              <p>Devam etmek için hesabınıza giriş yapın</p>
            </div>

            {/* Hızlı Demo Giriş Butonları */}
            <div className="demo-users-box">
              <span className="demo-title">🚀 Hızlı Demo Giriş:</span>
              <div className="demo-buttons">
                <button
                  type="button"
                  onClick={() => demoGirisYap("admin@tekirextra.com", "123456")}
                  className="demo-btn"
                  disabled={yukleniyor}
                >
                  👨‍💼 Yönetici
                </button>
                <button
                  type="button"
                  onClick={() => demoGirisYap("muhasebe@tekirextra.com", "123456")}
                  className="demo-btn"
                  disabled={yukleniyor}
                >
                  📊 Muhasebe
                </button>
              </div>
            </div>

            <div className="auth-divider">
              <span>veya e-posta ile</span>
            </div>

            {hata && <Alert tone="error">{hata}</Alert>}

            <form onSubmit={gonder} className="auth-form">
              <Field label="E-posta Adresi">
                <Input
                  name="eposta"
                  type="email"
                  placeholder="ornek@sirket.com"
                  value={eposta}
                  onChange={(e) => setEposta(e.target.value)}
                  required
                  autoFocus
                />
              </Field>

              <Field label="Parola" htmlFor="giris-parola">
                <div className="password-input-wrap">
                  <Input
                    id="giris-parola"
                    name="parola"
                    type={parolaGoster ? "text" : "password"}
                    placeholder="••••••••"
                    value={parola}
                    onChange={(e) => setParola(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setParolaGoster(!parolaGoster)}
                    title={parolaGoster ? "Parolayı Gizle" : "Parolayı Göster"}
                    aria-label={parolaGoster ? "Parolayı gizle" : "Parolayı göster"}
                    aria-pressed={parolaGoster}
                  >
                    {parolaGoster ? "🙈" : "👁️"}
                  </button>
                </div>
              </Field>

              {totpGerekli && (
                <Field label="2FA Kodu (TOTP)">
                  <Input
                    name="totpKodu"
                    inputMode="numeric"
                    pattern="\d{6}"
                    placeholder="6 haneli doğrulama kodu"
                    autoFocus
                    required
                  />
                </Field>
              )}

              <div className="form-options">
                <label className="remember-me">
                  <input type="checkbox" checked readOnly />
                  <span>Bu sekmede oturumu açık tut</span>
                </label>
                <Link href="/parola-sifirla" className="forgot-password">
                  Şifremi Unuttum?
                </Link>
              </div>

              <Button variant="primary" block type="submit" disabled={yukleniyor}>
                {yukleniyor ? "Giriş Yapılıyor..." : "Giriş Yap"}
              </Button>
            </form>

            <div className="auth-footer-links">
              <span>Hesabınız yok mu?</span>{" "}
              <Link href="/kayit" className="register-link">
                Firma Kaydı Oluşturun →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
