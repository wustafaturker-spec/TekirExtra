"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { Alert } from "@/components/ui";

function DogrulaIcerik() {
  const parametreler = useSearchParams();
  const [durum, setDurum] = useState<"bekliyor" | "tamam" | "hata">("bekliyor");
  const [mesaj, setMesaj] = useState("");

  useEffect(() => {
    const token = parametreler.get("token");
    if (!token) {
      setDurum("hata");
      setMesaj("Doğrulama token'ı eksik");
      return;
    }
    api<{ mesaj: string }>(`/auth/eposta-dogrula?token=${token}`)
      .then((s) => {
        setDurum("tamam");
        setMesaj(s.mesaj);
      })
      .catch((h: unknown) => {
        setDurum("hata");
        setMesaj(h instanceof ApiHata ? h.message : "Doğrulama başarısız");
      });
  }, [parametreler]);

  return (
    <div className="auth-card card card--pad">
      <div className="auth-brand"><span className="sidebar__brand-mark">🐈</span>Tekir<b>Extra</b></div>
      <p className="auth-title">E-posta doğrulama</p>
      {durum === "bekliyor" && <p className="muted">Doğrulanıyor…</p>}
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

export default function DogrulaSayfasi() {
  return (
    <main className="auth-wrap">
      <Suspense fallback={<p className="muted">Yükleniyor…</p>}>
        <DogrulaIcerik />
      </Suspense>
    </main>
  );
}
