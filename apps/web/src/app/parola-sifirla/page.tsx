"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiHata } from "@/lib/api";
import { Alert, Button, Field, Input } from "@/components/ui";

/**
 * KLN-12: "Şifremi unuttum". Bağlantısız açılırsa e-posta sorulur; e-postadaki
 * bağlantıyla açılırsa yeni parola belirlenir. Anahtar adres çubuğundan hemen
 * silinir (geçmişe ve Referer başlığına düşmesin).
 */
export default function ParolaSifirlaSayfasi() {
  const [token, setToken] = useState<string | null>(null);
  // Yönetim P2-3: davet bağlantısı aynı sayfayı açar, yalnız metin farklıdır.
  const [davet, setDavet] = useState(false);
  const [hazir, setHazir] = useState(false);
  const [eposta, setEposta] = useState("");
  const [parola, setParola] = useState("");
  const [parolaTekrar, setParolaTekrar] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [tamamlandi, setTamamlandi] = useState(false);
  const [isleniyor, setIsleniyor] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("token");
    if (t) {
      setToken(t);
      setDavet(p.get("davet") === "1");
      window.history.replaceState(null, "", "/parola-sifirla");
    }
    setHazir(true);
  }, []);

  async function calistir(is: () => Promise<void>) {
    setHata("");
    setBasari("");
    setIsleniyor(true);
    try {
      await is();
    } catch (h) {
      setHata(h instanceof ApiHata ? h.message : "İşlem tamamlanamadı");
    } finally {
      setIsleniyor(false);
    }
  }

  function istekGonder(e: FormEvent) {
    e.preventDefault();
    void calistir(async () => {
      const s = await api<{ mesaj: string }>("/auth/parola/sifirlama-iste", { method: "POST", body: JSON.stringify({ eposta }) });
      setBasari(s.mesaj);
      setTamamlandi(true);
    });
  }

  function parolaBelirle(e: FormEvent) {
    e.preventDefault();
    if (parola !== parolaTekrar) {
      setHata("Parolalar birbirini tutmuyor");
      return;
    }
    void calistir(async () => {
      const s = await api<{ mesaj: string }>("/auth/parola/sifirla", { method: "POST", body: JSON.stringify({ token, parola }) });
      setBasari(s.mesaj);
      setTamamlandi(true);
    });
  }

  return (
    <main className="auth-wrap">
      <div className="auth-card card card--pad">
        <div className="auth-brand"><span className="sidebar__brand-mark">TE</span>Tekir<b>Extra</b></div>
        <p className="auth-title">{token ? (davet ? "Hesabınız için parola belirleyin" : "Yeni parola belirleyin") : "Parolanızı mı unuttunuz?"}</p>
        <Alert tone="error">{hata}</Alert>
        <Alert tone="success">{basari}</Alert>
        {hazir && !tamamlandi && !token && (
          <form className="stack" onSubmit={istekGonder}>
            <p className="muted" style={{ margin: 0 }}>Hesabınızın e-posta adresini girin; parola sıfırlama bağlantısı gönderelim. Bağlantı 1 saat geçerlidir.</p>
            <Field label="E-posta adresi">
              <Input type="email" autoComplete="email" required autoFocus value={eposta} onChange={(e) => setEposta(e.target.value)} placeholder="ornek@sirket.com" />
            </Field>
            <Button variant="primary" block type="submit" disabled={isleniyor}>{isleniyor ? "Gönderiliyor…" : "Sıfırlama bağlantısı gönder"}</Button>
          </form>
        )}
        {hazir && !tamamlandi && token && (
          <form className="stack" onSubmit={parolaBelirle}>
            <Field label="Yeni parola (en az 10 karakter, harf ve rakam)">
              <Input type="password" autoComplete="new-password" required minLength={10} autoFocus value={parola} onChange={(e) => setParola(e.target.value)} />
            </Field>
            <Field label="Yeni parola (tekrar)">
              <Input type="password" autoComplete="new-password" required minLength={10} value={parolaTekrar} onChange={(e) => setParolaTekrar(e.target.value)} />
            </Field>
            <Button variant="primary" block type="submit" disabled={isleniyor}>{isleniyor ? "Kaydediliyor…" : "Parolamı güncelle"}</Button>
          </form>
        )}
        <p className="auth-alt">
          {token && hata ? <Link href="/parola-sifirla" onClick={() => { setToken(null); setHata(""); }}>Yeni bağlantı iste</Link> : <Link href="/giris">Girişe dön</Link>}
        </p>
      </div>
    </main>
  );
}
