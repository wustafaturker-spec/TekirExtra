"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Select, TableWrap } from "@/components/ui";

interface Secenek { aySayisi: number; matrah: string; kdv: string; toplam: string }
interface Odeme { id: string; createdAt: string; aySayisi: number; tutar: string; matrah: string | null; kdv: string | null; kaynak: "elle" | "saglayici"; saglayici: string | null; yeniDonemSonu: string }
interface Basarisiz { id: string; createdAt: string; aySayisi: number; toplam: string; hataMesaji: string | null }
interface OdemeDurumu { etkin: boolean; saglayici: string | null; testOrtami: boolean; neden: string | null; donemSonu: string | null; secenekler: Secenek[]; odemeler: Odeme[]; basarisizDenemeler: Basarisiz[] }

const tl = (s: string | number) => Number(s).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tarih = (s: string | null) => (s ? new Date(s).toLocaleDateString("tr-TR") : "—");

/**
 * PLT-13: "Şimdi öde". Ödeme sağlayıcının sayfasında yapılır; dönüşte dönem
 * uzamış olarak bu sayfaya gelinir. Askıdaki firmada da açıktır.
 */
export function OdemeKarti() {
  const [durum, setDurum] = useState<OdemeDurumu | null>(null);
  const [ay, setAy] = useState(1);
  const [hata, setHata] = useState("");
  const [gidiyor, setGidiyor] = useState(false);

  useEffect(() => {
    api<OdemeDurumu>("/abonelik/odeme").then((y) => {
      // Eksik yanıtta (ör. eski API) kart çökmesin.
      const d = { ...y, secenekler: Array.isArray(y?.secenekler) ? y.secenekler : [], odemeler: Array.isArray(y?.odemeler) ? y.odemeler : [], basarisizDenemeler: Array.isArray(y?.basarisizDenemeler) ? y.basarisizDenemeler : [] };
      setDurum(d);
      if (d.secenekler[0]) setAy(d.secenekler[0].aySayisi);
    }).catch((e) => setHata(e instanceof Error ? e.message : "Ödeme bilgileri yüklenemedi"));
  }, []);

  async function ode() {
    setGidiyor(true);
    setHata("");
    try {
      const s = await api<{ odemeSayfasiUrl: string }>("/abonelik/odeme", { method: "POST", body: JSON.stringify({ aySayisi: ay }) });
      window.location.assign(s.odemeSayfasiUrl);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Ödeme başlatılamadı");
      setGidiyor(false);
    }
  }

  if (!durum) return hata ? <Alert tone="error">{hata}</Alert> : null;
  const secili = durum.secenekler.find((s) => s.aySayisi === ay);

  return (
    <Card title="Ödeme">
      <div className="stack">
        <Alert tone="error">{hata}</Alert>
        {durum.etkin && secili ? (
          <>
            <p className="muted" style={{ margin: 0 }}>Dönem sonu {tarih(durum.donemSonu)}. Seçtiğiniz süre bu tarihe eklenir. Kart bilgileriniz {durum.saglayici} sayfasında girilir, TekirExtra'ya gelmez.{durum.testOrtami && <> <Badge variant="warning">Test ortamı</Badge></>}</p>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div style={{ minWidth: 160 }}><Field label="Süre"><Select value={ay} onChange={(e) => setAy(Number(e.target.value))}>{durum.secenekler.map((s) => <option key={s.aySayisi} value={s.aySayisi}>{s.aySayisi} ay</option>)}</Select></Field></div>
              <div className="subtle" style={{ lineHeight: 1.5 }}>Tutar {tl(secili.matrah)} TL + KDV %20 {tl(secili.kdv)} TL<br /><strong style={{ color: "var(--text)" }}>Toplam {tl(secili.toplam)} TL</strong></div>
              <Button variant="primary" disabled={gidiyor} onClick={() => void ode()}>{gidiyor ? "Ödeme sayfası açılıyor…" : "Şimdi öde"}</Button>
            </div>
          </>
        ) : durum.neden ? <p className="muted" style={{ margin: 0 }}>{durum.neden}</p> : null}
        {durum.basarisizDenemeler[0] && new Date(durum.basarisizDenemeler[0].createdAt) > new Date(durum.odemeler[0]?.createdAt ?? 0) && (
          <Alert tone="warning">Son ödeme denemesi tamamlanmadı ({new Date(durum.basarisizDenemeler[0].createdAt).toLocaleString("tr-TR")}). Yeniden deneyebilirsiniz.</Alert>
        )}
        {durum.odemeler.length > 0 && (
          <TableWrap>
            <thead><tr><th>Tarih</th><th>Süre</th><th className="num">Toplam</th><th>Yöntem</th><th>Yeni dönem sonu</th></tr></thead>
            <tbody>{durum.odemeler.map((o) => (
              <tr key={o.id}><td>{new Date(o.createdAt).toLocaleDateString("tr-TR")}</td><td>{o.aySayisi} ay</td><td className="num">{tl(o.tutar)} TL</td><td>{o.kaynak === "saglayici" ? `Kart (${o.saglayici === "paytr" ? "PayTR" : "iyzico"})` : "Havale / elle"}</td><td>{tarih(o.yeniDonemSonu)}</td></tr>
            ))}</tbody>
          </TableWrap>
        )}
      </div>
    </Card>
  );
}
