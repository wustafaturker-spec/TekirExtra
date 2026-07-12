"use client";

import { useState, type FormEvent } from "react";
import { api, ApiHata } from "@/lib/api";
import { stil } from "@/lib/stil";

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
    <main style={stil.sayfa}>
      <div style={stil.kart}>
        <h1>🐈 TekirExtra — Firma Kaydı</h1>
        {mesaj ? (
          <p style={stil.basari}>{mesaj}</p>
        ) : (
          <form onSubmit={gonder}>
            <label>
              Firma unvanı
              <input name="unvan" required style={stil.girdi} />
            </label>
            <label>
              VKN / TCKN
              <input name="vkn" required pattern="\d{10,11}" style={stil.girdi} />
            </label>
            <label>
              Vergi dairesi
              <input name="vergiDairesi" style={stil.girdi} />
            </label>
            <label>
              Yönetici ad soyad
              <input name="adSoyad" required style={stil.girdi} />
            </label>
            <label>
              E-posta
              <input name="eposta" type="email" required style={stil.girdi} />
            </label>
            <label>
              Parola (en az 10 karakter, harf + rakam)
              <input name="parola" type="password" required minLength={10} style={stil.girdi} />
            </label>
            {hata && <p style={stil.hata}>{hata}</p>}
            <button disabled={gonderiliyor} style={stil.dugme}>
              {gonderiliyor ? "Gönderiliyor…" : "Kaydol"}
            </button>
          </form>
        )}
        <p style={{ marginTop: "1rem", fontSize: ".9rem" }}>
          Hesabınız var mı? <a href="/giris">Giriş yapın</a>
        </p>
      </div>
    </main>
  );
}
