"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { Alert, Card, PageHeader, Segmented } from "@/components/ui";
import { AsistanSohbet, TalepKarti, type OnayTalebi } from "@/components/asistan-sohbet";

/**
 * AI-04/AI-05: asistan sohbeti ve kullanıcının onay talepleri. MCP'den gelen
 * talepler yalnız buradan onaylanır; bildirim bağlantısı `?talep=<id>` taşır.
 */
function AsistanGorunumu() {
  const odak = useSearchParams().get("talep");
  const [gorunum, setGorunum] = useState<"bekleyen" | "tum">("bekleyen");
  const [talepler, setTalepler] = useState<OnayTalebi[] | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  const yukle = useCallback(() => {
    setHata(null);
    api<OnayTalebi[]>(`/ai/onay-talepleri${gorunum === "bekleyen" ? "?durum=bekliyor" : ""}`)
      .then(setTalepler)
      .catch((e) => setHata(e instanceof Error ? e.message : "Talepler yüklenemedi"));
  }, [gorunum]);

  useEffect(yukle, [yukle]);

  const guncelle = (t: OnayTalebi) => setTalepler((liste) => (liste ?? []).map((x) => (x.id === t.id ? t : x)));
  const sirali = [...(talepler ?? [])].sort((a, b) => (a.id === odak ? -1 : b.id === odak ? 1 : 0));

  return (
    <div>
      <PageHeader title="Asistan ve Onaylar" subtitle="Asistan taslak açar ve sorgular; onaylama, gönderim, ödeme ve kart değişikliği sizin onayınızla yapılır." />
      <div className="form-grid form-grid--2">
        <Card title="Asistan">
          <AsistanSohbet onTalepDegisti={yukle} />
        </Card>
        <Card
          title="Onay talepleri"
          actions={<Segmented ariaLabel="Talep görünümü" items={[{ deger: "bekleyen", baslik: "Bekleyen" }, { deger: "tum", baslik: "Tümü" }]} onChange={setGorunum} value={gorunum} />}
        >
          {hata && <Alert tone="error">{hata}</Alert>}
          {talepler && !talepler.length && <p className="muted">{gorunum === "bekleyen" ? "Onayınızı bekleyen işlem yok." : "Henüz talep yok."}</p>}
          <div className="stack">
            {sirali.map((t) => (
              <div key={t.id}>
                <small className="muted">{new Date(t.createdAt).toLocaleString("tr-TR")} · {t.arac}</small>
                <TalepKarti talep={t} onDegisti={guncelle} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function AsistanSayfasi() {
  return <Suspense fallback={<p className="muted">Yükleniyor…</p>}><AsistanGorunumu /></Suspense>;
}
