"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { platformApi, platformTokenYaz } from "@/lib/platform-api";

/** MVZ-04: platform ekibi girişi — parola ve doğrulama kodu birlikte zorunlu. */
export default function PlatformGirisSayfasi() {
  const yonlendir = useRouter();
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);

  async function gonder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = new FormData(e.currentTarget);
    setHata(""); setYukleniyor(true);
    try {
      const s = await platformApi<{ accessToken: string }>("/platform/auth/giris", {
        method: "POST",
        body: JSON.stringify({ eposta: String(v.get("eposta") ?? ""), parola: String(v.get("parola") ?? ""), totpKodu: String(v.get("totpKodu") ?? "") }),
      });
      platformTokenYaz(s.accessToken);
      yonlendir.replace("/platform");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Giriş başarısız");
    } finally {
      setYukleniyor(false);
    }
  }

  return (
    <main className="auth-page-container">
      <div className="auth-form-side" style={{ width: "100%" }}>
        <div className="auth-card-modern">
          <div className="auth-header">
            <h1>Mevzuat Merkezi</h1>
            <p>Platform ekibi girişi. Kiracı hesapları burada geçmez.</p>
          </div>
          <Alert tone="error">{hata}</Alert>
          <form className="auth-form" onSubmit={(e) => void gonder(e)}>
            <Field label="E-posta"><Input name="eposta" type="email" autoComplete="username" required /></Field>
            <Field label="Parola"><Input name="parola" type="password" autoComplete="current-password" required /></Field>
            <Field label="Doğrulama kodu"><Input name="totpKodu" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required placeholder="6 haneli kod" /></Field>
            <Button type="submit" variant="primary" disabled={yukleniyor}>{yukleniyor ? "Giriş yapılıyor..." : "Giriş yap"}</Button>
          </form>
        </div>
      </div>
    </main>
  );
}
