"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiHata, tokenYaz } from "@/lib/api";
import { stil } from "@/lib/stil";

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
    <main style={stil.sayfa}>
      <div style={stil.kart}>
        <h1>🐈 TekirExtra — Giriş</h1>
        <form onSubmit={gonder}>
          <label>
            E-posta
            <input name="eposta" type="email" required style={stil.girdi} />
          </label>
          <label>
            Parola
            <input name="parola" type="password" required style={stil.girdi} />
          </label>
          {totpGerekli && (
            <label>
              TOTP kodu
              <input name="totpKodu" inputMode="numeric" pattern="\d{6}" style={stil.girdi} />
            </label>
          )}
          {hata && <p style={stil.hata}>{hata}</p>}
          <button style={stil.dugme}>Giriş yap</button>
        </form>
        <p style={{ marginTop: "1rem", fontSize: ".9rem" }}>
          Hesabınız yok mu? <a href="/kayit">Firma kaydı oluşturun</a>
        </p>
      </div>
    </main>
  );
}
