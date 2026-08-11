"use client";

import { useState, type FormEvent } from "react";
import { api, ApiHata } from "@/lib/api";
import { Alert, Button, Field, Input } from "@/components/ui";

export default function KayitSayfasi() {
  const [hata, setHata] = useState("");
  const [mesaj, setMesaj] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);

  async function gonder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setHata("");
    setGonderiliyor(true);
    const v = new FormData(e.currentTarget);
    try {
      const sonuc = await api<{ mesaj: string }>("/tenant/kayit", {
        method: "POST",
        body: JSON.stringify({
          unvan: v.get("unvan"),
          vkn: v.get("vkn"),
          vergiDairesi: v.get("vergiDairesi") || undefined,
          yoneticiAdSoyad: v.get("adSoyad"),
          yoneticiEposta: v.get("eposta"),
          parola: v.get("parola"),
        }),
      });
      setMesaj(sonuc.mesaj);
    } catch (h) {
      setHata(h instanceof ApiHata ? h.message : "Kayıt başarısız");
    } finally {
      setGonderiliyor(false);
    }
  }

  return (
    <main className="auth-wrap">
      <div className="auth-card card card--pad">
        <div className="auth-brand"><span className="sidebar__brand-mark">TE</span>Tekir<b>Extra</b></div>
        <p className="auth-title">Firma kaydı oluşturun</p>
        {mesaj ? (
          <Alert tone="success">{mesaj}</Alert>
        ) : (
          <form onSubmit={gonder} className="stack">
            <Field label="Firma unvanı"><Input name="unvan" required /></Field>
            <Field label="VKN / TCKN"><Input name="vkn" required pattern="\d{10,11}" /></Field>
            <Field label="Vergi dairesi"><Input name="vergiDairesi" /></Field>
            <Field label="Yönetici ad soyad"><Input name="adSoyad" required /></Field>
            <Field label="E-posta"><Input name="eposta" type="email" required /></Field>
            <Field label="Parola (en az 10 karakter, harf + rakam)">
              <Input name="parola" type="password" required minLength={10} />
            </Field>
            <Alert tone="error">{hata}</Alert>
            <Button variant="primary" block type="submit" disabled={gonderiliyor}>
              {gonderiliyor ? "Gönderiliyor…" : "Kaydol"}
            </Button>
          </form>
        )}
        <p className="auth-alt">Hesabınız var mı? <a href="/giris">Giriş yapın</a></p>
      </div>
    </main>
  );
}
