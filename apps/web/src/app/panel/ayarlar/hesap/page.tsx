"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, Field, Input, PageHeader } from "@/components/ui";

interface KurBilgi {
  otpauthUrl: string;
  secret: string;
}

export default function HesapGuvenligiSayfasi() {
  const [kurBilgi, setKurBilgi] = useState<KurBilgi | null>(null);
  const [kod, setKod] = useState("");
  const [etkin, setEtkin] = useState(false);
  const [zatenEtkin, setZatenEtkin] = useState(false);
  const [hata, setHata] = useState("");
  const [mevcutParola, setMevcutParola] = useState("");
  const [yeniParola, setYeniParola] = useState("");
  const [yeniParolaTekrar, setYeniParolaTekrar] = useState("");
  const [parolaHata, setParolaHata] = useState("");
  const [parolaBasari, setParolaBasari] = useState("");
  const [parolaIsleniyor, setParolaIsleniyor] = useState(false);

  // KLN-11: bu oturum açık kalır, diğer cihazlardaki oturumlar kapanır.
  async function parolaDegistir(e: React.FormEvent) {
    e.preventDefault();
    setParolaHata("");
    setParolaBasari("");
    if (yeniParola !== yeniParolaTekrar) {
      setParolaHata("Yeni parolalar birbirini tutmuyor");
      return;
    }
    setParolaIsleniyor(true);
    try {
      const s = await api<{ mesaj: string }>("/auth/parola/degistir", { method: "POST", body: JSON.stringify({ mevcutParola, yeniParola }) });
      setParolaBasari(s.mesaj);
      setMevcutParola("");
      setYeniParola("");
      setYeniParolaTekrar("");
    } catch (h) {
      setParolaHata(h instanceof Error ? h.message : "Parola değiştirilemedi");
    } finally {
      setParolaIsleniyor(false);
    }
  }

  async function kur() {
    setHata("");
    setEtkin(false);
    setZatenEtkin(false);
    try {
      const b = await api<KurBilgi>("/auth/totp/kur", { method: "POST" });
      setKurBilgi(b);
    } catch (h) {
      const m = h instanceof Error ? h.message : "TOTP kurulamadı";
      if (m.toLocaleLowerCase("tr").includes("zaten")) {
        setZatenEtkin(true);
      } else {
        setHata(m);
      }
    }
  }

  async function etkinlestir(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    try {
      await api("/auth/totp/etkinlestir", { method: "POST", body: JSON.stringify({ kod }) });
      setEtkin(true);
      setKurBilgi(null);
      setKod("");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kod doğrulanamadı");
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <PageHeader
        title="Hesap Güvenliği"
        subtitle="Parolanızı değiştirin ve iki adımlı doğrulama (2FA / TOTP) kurun — KLN-05, KLN-11."
      />

      <Card className="stack" style={{ marginBottom: "1.5rem" }}>
        <div>
          <h3 className="card__title" style={{ fontSize: "1.05rem" }}>🔑 Parolamı Değiştir</h3>
          <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
            Yeni parola en az 10 karakter olmalı, harf ve rakam içermelidir. Değişiklikten sonra bu cihaz
            dışındaki oturumlarınız kapanır.
          </p>
        </div>
        <Alert tone="error">{parolaHata}</Alert>
        <Alert tone="success">{parolaBasari}</Alert>
        <form onSubmit={parolaDegistir} className="stack">
          <Field label="Mevcut parola">
            <Input type="password" autoComplete="current-password" required value={mevcutParola} onChange={(e) => setMevcutParola(e.target.value)} />
          </Field>
          <Field label="Yeni parola">
            <Input type="password" autoComplete="new-password" required minLength={10} value={yeniParola} onChange={(e) => setYeniParola(e.target.value)} />
          </Field>
          <Field label="Yeni parola (tekrar)">
            <Input type="password" autoComplete="new-password" required minLength={10} value={yeniParolaTekrar} onChange={(e) => setYeniParolaTekrar(e.target.value)} />
          </Field>
          <div><Button variant="primary" type="submit" disabled={parolaIsleniyor}>{parolaIsleniyor ? "Kaydediliyor…" : "Parolayı değiştir"}</Button></div>
        </form>
      </Card>

      <Alert tone="error">{hata}</Alert>
      {etkin && <Alert tone="success">İki adımlı doğrulama etkinleştirildi. Bir sonraki girişte doğrulama kodu istenecek.</Alert>}

      <Card className="stack">
        <div>
          <h3 className="card__title" style={{ fontSize: "1.05rem" }}>🔐 İki Adımlı Doğrulama (TOTP)</h3>
          <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
            Google Authenticator, Authy, Microsoft Authenticator gibi bir uygulama ile
            hesabınıza ek güvenlik katmanı ekleyin. Kurulumda gösterilen gizli anahtarı
            uygulamanıza girin, ardından ürettiği 6 haneli kod ile etkinleştirin.
          </p>
        </div>

        {zatenEtkin && (
          <Alert tone="success">Hesabınızda iki adımlı doğrulama zaten etkin.</Alert>
        )}

        {!kurBilgi && !etkin && (
          <div><Button variant="primary" onClick={kur}>İki Adımlı Doğrulamayı Kur</Button></div>
        )}

        {kurBilgi && (
          <div className="stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "1.25rem" }}>
            <Field label="1) Gizli anahtar (authenticator uygulamanıza girin)">
              <Input readOnly value={kurBilgi.secret} className="mono" onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <p className="subtle" style={{ fontSize: "0.8rem", margin: 0, wordBreak: "break-all" }}>
              otpauth URL: <span className="mono">{kurBilgi.otpauthUrl}</span>
            </p>
            <form onSubmit={etkinlestir} className="row-tight" style={{ alignItems: "flex-end", flexWrap: "nowrap" }}>
              <div className="grow" style={{ maxWidth: 200 }}>
                <Field label="2) Uygulamadaki 6 haneli kod">
                  <Input value={kod} onChange={(e) => setKod(e.target.value)} inputMode="numeric" pattern="\d{6}" maxLength={6} required placeholder="123456" />
                </Field>
              </div>
              <Button variant="primary" type="submit">Etkinleştir</Button>
            </form>
          </div>
        )}
      </Card>
    </div>
  );
}
