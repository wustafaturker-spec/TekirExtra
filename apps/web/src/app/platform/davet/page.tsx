"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { platformApi } from "@/lib/platform-api";

interface DavetBilgisi {
  eposta: string;
  adSoyad: string;
  tur: "hesap" | "iki_adim";
  secret: string;
  karekod: string;
}

/**
 * PLT-07: platform kullanıcısının davet ya da 2FA yeniden kurulum sayfası.
 * Oturum gerektirmez; bağlantıdaki anahtar tek kullanımlıktır.
 */
export default function PlatformDavetSayfasi() {
  const [anahtar, setAnahtar] = useState("");
  const [bilgi, setBilgi] = useState<DavetBilgisi | null>(null);
  const [hata, setHata] = useState("");
  const [tamam, setTamam] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(false);
  // Her açılış yeni bir 2FA anahtarı üretir; geliştirmedeki çift effect iki karekod üretmesin.
  const istendi = useRef(false);

  useEffect(() => {
    if (istendi.current) return;
    istendi.current = true;
    const a = new URLSearchParams(window.location.search).get("anahtar") ?? "";
    // Anahtar adres çubuğunda ve geçmişte kalmasın.
    window.history.replaceState(null, "", "/platform/davet");
    setAnahtar(a);
    if (!a) { setHata("Bağlantı eksik; e-postadaki bağlantıyı açın."); return; }
    void platformApi<DavetBilgisi>("/platform/auth/davet/bilgi", { method: "POST", body: JSON.stringify({ anahtar: a }) })
      .then(setBilgi)
      .catch((h) => setHata(h instanceof Error ? h.message : "Bağlantı açılamadı"));
  }, []);

  async function gonder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!bilgi) return;
    const v = new FormData(e.currentTarget);
    const parola = String(v.get("parola") ?? "");
    if (bilgi.tur === "hesap" && parola !== String(v.get("parolaTekrar") ?? "")) { setHata("Parolalar birbirini tutmuyor"); return; }
    setHata(""); setYukleniyor(true);
    try {
      await platformApi("/platform/auth/davet/tamamla", { method: "POST", body: JSON.stringify({ anahtar, parola, kod: String(v.get("kod") ?? "") }) });
      setTamam(true);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kurulum tamamlanamadı");
    } finally {
      setYukleniyor(false);
    }
  }

  const hesap = bilgi?.tur === "hesap";
  return (
    <main className="auth-page-container">
      <div className="auth-form-side" style={{ width: "100%" }}>
        <div className="auth-card-modern">
          <div className="auth-header">
            <h1>{hesap ? "Platform hesabınızı kurun" : "İki adımlı doğrulamayı yeniden kurun"}</h1>
            {bilgi && <p>{bilgi.adSoyad} · {bilgi.eposta}</p>}
          </div>
          <Alert tone="error">{hata}</Alert>
          {tamam ? (
            <div className="stack">
              <Alert tone="success">Kurulum tamamlandı. Parolanız ve doğrulayıcı uygulamadaki kodla giriş yapabilirsiniz.</Alert>
              <Link href="/platform/giris"><Button variant="primary">Platform girişine git</Button></Link>
            </div>
          ) : bilgi && (
            <form className="auth-form" onSubmit={(e) => void gonder(e)}>
              {hesap ? (
                <>
                  <Field label="Parola (en az 10 karakter, harf ve rakam)"><Input name="parola" type="password" autoComplete="new-password" minLength={10} required /></Field>
                  <Field label="Parola (tekrar)"><Input name="parolaTekrar" type="password" autoComplete="new-password" minLength={10} required /></Field>
                </>
              ) : (
                <Field label="Mevcut parolanız"><Input name="parola" type="password" autoComplete="current-password" required /></Field>
              )}
              <div className="stack" style={{ alignItems: "center" }}>
                <p className="muted" style={{ margin: 0 }}>Doğrulayıcı uygulamayla (Google Authenticator, Microsoft Authenticator…) karekodu okutun:</p>
                <img src={bilgi.karekod} alt="İki adımlı doğrulama karekodu" width={180} height={180} style={{ background: "#fff", padding: 8, borderRadius: 8, border: "1px solid var(--border)" }} />
                <p className="subtle" style={{ margin: 0, wordBreak: "break-all" }}>Elle giriş anahtarı: <code>{bilgi.secret}</code></p>
              </div>
              <Field label="Uygulamadaki doğrulama kodu"><Input name="kod" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required placeholder="6 haneli kod" /></Field>
              <Button type="submit" variant="primary" disabled={yukleniyor}>{yukleniyor ? "Kaydediliyor..." : "Kurulumu tamamla"}</Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
