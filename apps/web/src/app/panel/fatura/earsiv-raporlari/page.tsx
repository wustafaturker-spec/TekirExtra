"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader } from "@/components/ui";

interface EarsivRapor {
  uuid: string; donem: string; baslangic: string; bitis: string;
  faturaSayisi: number; toplamTutar: string; gibDurumu: string;
}

export default function EarsivRaporlariSayfasi() {
  const bugun = new Date();
  const ayBasi = new Date(bugun.getFullYear(), bugun.getMonth(), 1);
  const [baslangic, setBaslangic] = useState(ayBasi.toISOString().slice(0, 10));
  const [bitis, setBitis] = useState(bugun.toISOString().slice(0, 10));
  const [raporlar, setRaporlar] = useState<EarsivRapor[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);

  async function yukle() {
    setYukleniyor(true); setHata(""); setBasari("");
    try {
      setRaporlar(await api<EarsivRapor[]>(`/ebelge/earsiv/raporlar?baslangic=${baslangic}&bitis=${bitis}`));
    } catch (h) { setHata(h instanceof Error ? h.message : "e-Arşiv raporları yüklenemedi"); }
    finally { setYukleniyor(false); }
  }

  useEffect(() => { void yukle(); }, []); // İlk açılışta içinde bulunulan ay

  async function durumSorgula(uuid: string) {
    setHata(""); setBasari("");
    try {
      const sonuc = await api<{ basarili: boolean; kod?: string; mesaj?: string }>(`/ebelge/earsiv/raporlar/${uuid}/durum`);
      setBasari(`Rapor durumu${sonuc.kod ? ` (${sonuc.kod})` : ""}: ${sonuc.mesaj || (sonuc.basarili ? "Başarılı" : "Bekliyor")}`);
    } catch (h) { setHata(h instanceof Error ? h.message : "Rapor durumu sorgulanamadı"); }
  }

  return <div className="stack">
    <PageHeader title="e-Arşiv Raporları" subtitle="Sovos tarafından GİB'e iletilen günlük e-Arşiv raporlarını izleyin." />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>
    <Card><div className="row">
      <Field label="Başlangıç"><Input type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} /></Field>
      <Field label="Bitiş"><Input type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} /></Field>
      <Button type="button" variant="primary" disabled={yukleniyor} onClick={() => void yukle()}>{yukleniyor ? "Yükleniyor..." : "Raporları getir"}</Button>
    </div></Card>
    <Card>
      {raporlar.length === 0 ? <p className="muted">Seçilen tarih aralığında e-Arşiv raporu bulunamadı.</p> : <div className="table-wrap"><table><thead><tr><th>Dönem</th><th>Tarih aralığı</th><th>Fatura</th><th>Toplam</th><th>GİB durumu</th><th /></tr></thead><tbody>{raporlar.map((r) => <tr key={r.uuid}><td><strong>{r.donem}</strong><br/><small className="mono">{r.uuid}</small></td><td>{r.baslangic} – {r.bitis}</td><td>{r.faturaSayisi}</td><td>{Number(r.toplamTutar).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL</td><td><Badge variant={r.gibDurumu.startsWith("200") || r.gibDurumu.startsWith("130") ? "success" : "neutral"}>{r.gibDurumu || "Bilinmiyor"}</Badge></td><td><Button size="sm" onClick={() => void durumSorgula(r.uuid)}>Durumu sorgula</Button></td></tr>)}</tbody></table></div>}
    </Card>
  </div>;
}
