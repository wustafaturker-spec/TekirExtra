"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiHata, tokenYaz } from "@/lib/api";
import { Alert, Button, Field, Input } from "@/components/ui";

export default function GirisSayfasi() {
  const yonlendir = useRouter();
  const [hata, setHata] = useState("");
  const [totpGerekli, setTotpGerekli] = useState(false);

  async function gonder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setHata("");
    const v = new FormData(e.currentTarget);
    try {
      const sonuc = await api<{ accessToken: string }>("/auth/giris", {
        method: "POST",
        body: JSON.stringify({
          eposta: v.get("eposta"),
          parola: v.get("parola"),
          totpKodu: v.get("totpKodu") || undefined,
        }),
      });
      tokenYaz(sonuc.accessToken);
      yonlendir.push("/panel");
    } catch (h) {
      const mesaj = h instanceof ApiHata ? h.message : "Giriş başarısız";
      if (mesaj.includes("TOTP")) setTotpGerekli(true);
      setHata(mesaj);
    }
  }

  return (
    <main className="auth-wrap">
      <div className="auth-card card card--pad">
        <div className="auth-brand"><span className="sidebar__brand-mark">🐈</span>Tekir<b>Extra</b></div>
        <p className="auth-title">Hesabınıza giriş yapın</p>
        <form onSubmit={gonder} className="stack">
          <Field label="E-posta"><Input name="eposta" type="email" required /></Field>
          <Field label="Parola"><Input name="parola" type="password" required /></Field>
          {totpGerekli && (
            <Field label="TOTP kodu"><Input name="totpKodu" inputMode="numeric" pattern="\d{6}" /></Field>
          )}
          <Alert tone="error">{hata}</Alert>
          <Button variant="primary" block type="submit">Giriş yap</Button>
        </form>
        <p className="auth-alt">Hesabınız yok mu? <a href="/kayit">Firma kaydı oluşturun</a></p>
      </div>
    </main>
  );
}
