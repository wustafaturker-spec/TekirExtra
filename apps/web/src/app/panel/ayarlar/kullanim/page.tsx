"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Card, PageHeader, Stat, StatGrid } from "@/components/ui";

interface Ozet { donemGun: number; aktifKullanici: number; toplamOlay: number; fatura: { acilan: number; tamamlanan: number; ortancaSureMs: number | null; terkOrani: number; dogrulamaHatasi: number }; gorunum: { kaydedilen: number; kullanilan: number }; }
const sure = (ms: number | null) => ms === null ? "Veri yok" : ms < 60_000 ? Math.round(ms / 1000) + " sn" : (ms / 60_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 }) + " dk";

export default function KullanimMetrikleriSayfasi() {
  const [ozet, setOzet] = useState<Ozet | null>(null); const [hata, setHata] = useState("");
  useEffect(() => { api<Ozet>("/kullanim/ozet").then(setOzet).catch((e) => setHata(e instanceof Error ? e.message : "Metrikler yüklenemedi")); }, []);
  return <div><PageHeader title="Kullanım Metrikleri" subtitle="Son 30 gündeki görev tamamlama, hata ve iş akışı benimsenme göstergeleri." /><Alert tone="error">{hata}</Alert>{ozet && <div className="stack">
    <StatGrid><Stat label="Aktif kullanıcı" value={ozet.aktifKullanici} hint="Ölçülen iş akışlarını kullanan" /><Stat label="Ortanca fatura süresi" value={sure(ozet.fatura.ortancaSureMs)} tone="info" /><Stat label="Form terk oranı" value={"%" + (ozet.fatura.terkOrani * 100).toFixed(1)} tone={ozet.fatura.terkOrani > 0.15 ? "danger" : "success"} /><Stat label="Doğrulama hatası" value={ozet.fatura.dogrulamaHatasi} tone={ozet.fatura.dogrulamaHatasi ? "danger" : "success"} /></StatGrid>
    <div className="metric-bands"><Card title="Fatura akışı"><dl><div><dt>Açılan form</dt><dd>{ozet.fatura.acilan}</dd></div><div><dt>Tamamlanan taslak</dt><dd>{ozet.fatura.tamamlanan}</dd></div><div><dt>Tamamlama oranı</dt><dd>%{ozet.fatura.acilan ? ((ozet.fatura.tamamlanan / ozet.fatura.acilan) * 100).toFixed(1) : "0.0"}</dd></div></dl></Card><Card title="Kaydedilmiş görünümler"><dl><div><dt>Oluşturulan</dt><dd>{ozet.gorunum.kaydedilen}</dd></div><div><dt>Uygulanan</dt><dd>{ozet.gorunum.kullanilan}</dd></div><div><dt>Toplam ölçülen olay</dt><dd>{ozet.toplamOlay}</dd></div></dl></Card></div>
  </div>}</div>;
}
