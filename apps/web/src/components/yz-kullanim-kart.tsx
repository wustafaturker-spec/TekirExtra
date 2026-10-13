"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, Field, Input, Stat, StatGrid } from "@/components/ui";

interface Kullanim { gunlukSinir: number; bugunToplam: number; gunler: Array<{ gun: string; ozellik: string; cagri: number }> }

const OZELLIK_ADI: Record<string, string> = { asistan: "Asistan", tarama: "Tarama", ozet: "Özet yorumu", gorev: "Görev", ekstre: "Ekstre önerisi", hatirlatma: "Hatırlatma metni" };

/** AI-15: günlük model çağrısı sınırı ve son 30 günün kullanımı. */
export function YzKullanimKart() {
  const [veri, setVeri] = useState<Kullanim | null>(null);
  const [sinir, setSinir] = useState("");
  const [hata, setHata] = useState<string | null>(null);
  const [basari, setBasari] = useState<string | null>(null);

  const yukle = () => api<Kullanim>("/ai/kullanim").then((v) => { setVeri(v); setSinir(String(v.gunlukSinir)); }).catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi"));
  useEffect(() => { void yukle(); }, []);

  async function kaydet() {
    setHata(null); setBasari(null);
    try {
      await api("/ai/ayarlar", { method: "PUT", body: JSON.stringify({ gunlukCagriSiniri: Number(sinir) }) });
      setBasari("Günlük sınır kaydedildi.");
      await yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Kaydedilemedi");
    }
  }

  const gunler = [...new Set((veri?.gunler ?? []).map((g) => g.gun))];
  const ozellikToplam = Object.entries((veri?.gunler ?? []).reduce<Record<string, number>>((t, g) => ({ ...t, [g.ozellik]: (t[g.ozellik] ?? 0) + g.cagri }), {}));
  return (
    <Card title="Kullanım ve günlük sınır">
      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}
      <StatGrid>
        <Stat label="Bugün" value={`${veri?.bugunToplam ?? 0} / ${veri?.gunlukSinir ?? "—"}`} hint="model çağrısı" tone={veri && veri.bugunToplam >= veri.gunlukSinir ? "danger" : "default"} />
        <Stat label="Son 30 gün" value={(veri?.gunler ?? []).reduce((t, g) => t + g.cagri, 0)} hint={`${gunler.length} gün kullanıldı`} />
        {ozellikToplam.map(([ozellik, cagri]) => <Stat key={ozellik} label={OZELLIK_ADI[ozellik] ?? ozellik} value={cagri} hint="son 30 gün" />)}
      </StatGrid>
      <form className="row-tight yz-kullanim__form" onSubmit={(e) => { e.preventDefault(); void kaydet(); }}>
        <Field label="Günlük çağrı sınırı (kiracı)"><Input max={100000} min={1} onChange={(e) => setSinir(e.target.value)} type="number" value={sinir} /></Field>
        <Button type="submit">Kaydet</Button>
      </form>
    </Card>
  );
}
