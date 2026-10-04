"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { Alert, Button, ButtonLabel, Card, Field, Input, PageHeader, Select, Stat, StatGrid } from "@/components/ui";
import { MutabakatTablosu, type Mutabakat, type MutabakatDurumu } from "../mutabakat-tablosu";

const DURUMLAR: [MutabakatDurumu | "", string][] = [["", "Tümü"], ["gonderildi", "Gönderildi"], ["goruldu", "Görüldü"], ["mutabik", "Mutabık"], ["itiraz", "İtiraz"], ["suresi_doldu", "Süresi doldu"], ["iptal", "İptal"]];

/**
 * CARI-42: bütün mutabakat talepleri; durum ve dönem süzgeci, özet sayılar,
 * Excel. Talep cari kartından ya da cari listesinde toplu işlemle açılır.
 */
export default function MutabakatlarSayfasi() {
  const [durum, setDurum] = useState("");
  const [ay, setAy] = useState("");
  const [veri, setVeri] = useState<{ kayitlar: Mutabakat[]; ozet: Record<string, number> } | null>(null);
  const [mesaj, setMesaj] = useState<{ hata?: string; basari?: string }>({});

  const sorgu = new URLSearchParams({ ...(durum ? { durum } : {}), ...(ay ? { ay } : {}) }).toString();
  const yukle = useCallback(async () => {
    try { setVeri(await api(`/cari/mutabakatlar${sorgu ? `?${sorgu}` : ""}`)); }
    catch (h) { setMesaj({ hata: h instanceof Error ? h.message : "Mutabakatlar yüklenemedi" }); }
  }, [sorgu]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("durum")) setDurum(p.get("durum")!);
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  const o = veri?.ozet ?? {};
  return (
    <div>
      <PageHeader
        title="🤝 Mutabakatlar"
        subtitle="Cari bakiye mutabakatı talepleri ve karşı tarafın portaldan verdiği yanıtlar. Yanıtsız talebe son tarihten 3 gün önce bir kez hatırlatma gider."
        actions={<ButtonLabel as="a" href="/panel/cari">← Cari Hesaplar</ButtonLabel>}
      />
      <Alert tone="error">{mesaj.hata}</Alert>
      <Alert tone="success">{mesaj.basari}</Alert>
      <StatGrid>
        <Stat label="Yanıt bekleyen" value={(o.gonderildi ?? 0) + (o.goruldu ?? 0)} />
        <Stat label="Mutabık" value={o.mutabik ?? 0} tone="accent" />
        <Stat label="İtiraz" value={o.itiraz ?? 0} tone={o.itiraz ? "danger" : "default"} />
        <Stat label="Süresi doldu" value={o.suresi_doldu ?? 0} />
      </StatGrid>
      <Card>
        <div className="cari-toplu__form" style={{ background: "none", border: 0, padding: 0 }}>
          <Field label="Durum"><Select value={durum} onChange={(e) => setDurum(e.target.value)}>{DURUMLAR.map(([d, ad]) => <option key={d || "tumu"} value={d}>{ad}</option>)}</Select></Field>
          <Field label="Mutabakat ayı"><Input type="month" value={ay} onChange={(e) => setAy(e.target.value)} /></Field>
          <Button size="sm" disabled={!veri?.kayitlar.length} onClick={() => void apiDosyaIndir(`/cari/mutabakatlar/excel${sorgu ? `?${sorgu}` : ""}`, "mutabakatlar.xlsx")}>📊 Excel</Button>
        </div>
      </Card>
      <Card pad={false}>
        {veri === null ? <p className="subtle" style={{ padding: "1rem" }}>Yükleniyor…</p> : <MutabakatTablosu kayitlar={veri.kayitlar} cariSutunu onDegisti={() => void yukle()} onMesaj={setMesaj} />}
      </Card>
    </div>
  );
}
