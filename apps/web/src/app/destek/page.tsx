"use client";

import { useEffect, useRef, useState } from "react";
import { destekSekmesiYaz, tokenYaz } from "@/lib/api";
import { Alert } from "@/components/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

/**
 * PLT-10: platform panelinden açılan destek sekmesi. Token adres çubuğunun #
 * kısmında gelir (sunucuya ve erişim kayıtlarına gitmez), sekmeye yazılır,
 * rota koruması işareti alınır ve firmanın paneli salt okunur açılır.
 */
export default function DestekOturumuSayfasi() {
  const [durum, setDurum] = useState<"aciliyor" | "bitti" | "hata">("aciliyor");
  const [hata, setHata] = useState("");
  const basladi = useRef(false);

  useEffect(() => {
    if (basladi.current) return;
    basladi.current = true;
    if (new URLSearchParams(window.location.search).get("bitti") === "1") { setDurum("bitti"); return; }
    const token = new URLSearchParams(window.location.hash.slice(1)).get("t") ?? "";
    window.history.replaceState(null, "", "/destek");
    if (!token) { setDurum("hata"); setHata("Destek bağlantısı eksik; platform panelinden yeniden açın."); return; }
    void fetch(`${API_URL}/auth/destek/baslat`, { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${token}` } })
      .then(async (y) => {
        if (!y.ok) throw new Error(((await y.json().catch(() => ({}))) as { message?: string }).message ?? "Destek oturumu açılamadı");
        destekSekmesiYaz(true);
        tokenYaz(token);
        window.location.replace("/panel");
      })
      .catch((h: unknown) => { setDurum("hata"); setHata(h instanceof Error ? h.message : "Destek oturumu açılamadı"); });
  }, []);

  return (
    <main className="auth-page-container">
      <div className="auth-form-side" style={{ width: "100%" }}>
        <div className="auth-card-modern">
          <div className="auth-header">
            <h1>TekirExtra destek oturumu</h1>
            <p>Firma paneli salt okunur açılır; her istek firmanın denetim izine yazılır.</p>
          </div>
          {durum === "aciliyor" && <p className="muted">Oturum açılıyor…</p>}
          {durum === "bitti" && <Alert tone="warning">Destek oturumu sona erdi (süre doldu, kapatıldı ya da firma izni geri aldı). Bu sekmeyi kapatabilirsiniz.</Alert>}
          {durum === "hata" && <Alert tone="error">{hata}</Alert>}
        </div>
      </div>
    </main>
  );
}
