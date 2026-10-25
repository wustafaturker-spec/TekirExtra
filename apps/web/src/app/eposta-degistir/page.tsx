"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { Alert, Button } from "@/components/ui";

/**
 * KLN-23: yeni giriş e-postasının onayı. Değişiklik sayfa açılınca değil
 * düğmeyle yapılır; e-posta güvenlik taramaları bağlantıyı açtığında adres
 * kendiliğinden değişmesin.
 */
function EpostaDegistirIcerik() {
  const token = useSearchParams().get("token");
  const [durum, setDurum] = useState<"bekliyor" | "isleniyor" | "tamam" | "hata">(token ? "bekliyor" : "hata");
  const [mesaj, setMesaj] = useState(token ? "" : "Doğrulama bağlantısı eksik; e-postadaki bağlantıyı yeniden açın.");

  async function onayla() {
    setDurum("isleniyor");
    try {
      const s = await api<{ mesaj: string }>("/auth/eposta/onayla", { method: "POST", body: JSON.stringify({ token }) });
      setDurum("tamam");
      setMesaj(s.mesaj);
    } catch (h) {
      setDurum("hata");
      setMesaj(h instanceof ApiHata ? h.message : "Doğrulama başarısız");
    }
  }

  return (
    <div className="auth-card card card--pad">
      <div className="auth-brand"><span className="sidebar__brand-mark">TE</span>Tekir<b>Extra</b></div>
      <p className="auth-title">Yeni giriş e-postası</p>
      {(durum === "bekliyor" || durum === "isleniyor") && (
        <>
          <p className="muted">Onaylayınca TekirExtra&apos;ya bu adresle giriş yaparsınız; eski adres artık geçmez.</p>
          <Button variant="primary" onClick={onayla} disabled={durum === "isleniyor"}>{durum === "isleniyor" ? "Onaylanıyor…" : "Yeni adresimi onayla"}</Button>
        </>
      )}
      {durum === "tamam" && (
        <>
          <Alert tone="success">{mesaj}</Alert>
          <p className="auth-alt"><a href="/giris">Girişe git</a></p>
        </>
      )}
      {durum === "hata" && <Alert tone="error">{mesaj}</Alert>}
    </div>
  );
}

export default function EpostaDegistirSayfasi() {
  return (
    <main className="auth-wrap">
      <Suspense fallback={<p className="muted">Yükleniyor…</p>}>
        <EpostaDegistirIcerik />
      </Suspense>
    </main>
  );
}
