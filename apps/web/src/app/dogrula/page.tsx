"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { stil } from "@/lib/stil";

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
    <div style={stil.kart}>
      <h1>🐈 TekirExtra — E-posta Doğrulama</h1>
      {durum === "bekliyor" && <p>Doğrulanıyor…</p>}
      {durum === "tamam" && (
        <>
          <p style={stil.basari}>{mesaj}</p>
          <a href="/giris">Girişe git</a>
        </>
      )}
      {durum === "hata" && <p style={stil.hata}>{mesaj}</p>}
    </div>
  );
}

export default function DogrulaSayfasi() {
  return (
    <main style={stil.sayfa}>
      <Suspense fallback={<p>Yükleniyor…</p>}>
        <DogrulaIcerik />
      </Suspense>
    </main>
  );
}
