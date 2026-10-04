"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, PageHeader, Select, Table, Tarih } from "@/components/ui";

type Durum = "bekliyor" | "onaylandi" | "reddedildi" | "iptal";
interface Alanlar { telefon?: string | null; adres?: string | null; iban?: string | null }
interface Talep {
  id: string; durum: Durum; aciklama: string | null; retNedeni: string | null; createdAt: string; kararTarihi: string | null;
  personel: { id: string; personelNo: string; ad: string; soyad: string };
  istenen: Alanlar; mevcut: Alanlar;
}
const DURUM: Record<Durum, [string, "warning" | "success" | "danger" | "neutral"]> = { bekliyor: ["Onay bekliyor", "warning"], onaylandi: ["Onaylandı", "success"], reddedildi: ["Reddedildi", "danger"], iptal: ["Geri çekildi", "neutral"] };
const ALAN_ADI: Record<keyof Alanlar, string> = { telefon: "Telefon", adres: "Adres", iban: "IBAN" };

/** PRS-22: çalışanların self-servisten ilettiği bilgi güncelleme talepleri; onaylanınca personel kartına yazılır. */
export default function BilgiTalepleri() {
  const [durum, setDurum] = useState<Durum | "hepsi">("bekliyor");
  const [liste, setListe] = useState<Talep[]>([]);
  const [hata, setHata] = useState("");
  const [bilgi, setBilgi] = useState("");
  const [islenen, setIslenen] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    try { setHata(""); setListe(await api<Talep[]>(`/personel/bilgi-talepleri?durum=${durum}`)); }
    catch (e) { setHata(e instanceof Error ? e.message : "Talepler alınamadı"); }
  }, [durum]);
  useEffect(() => { void yukle(); }, [yukle]);

  const karar = async (t: Talep, onay: boolean) => {
    let neden: string | null = null;
    if (!onay) { neden = window.prompt("Ret nedeni (çalışan görecek):"); if (!neden) return; }
    else if (!window.confirm(`${t.personel.ad} ${t.personel.soyad} için istenen bilgiler personel kartına yazılsın mı?`)) return;
    try {
      setIslenen(t.id); setHata(""); setBilgi("");
      await api(`/personel/bilgi-talepleri/${t.id}/${onay ? "onayla" : "reddet"}`, { method: "POST", body: JSON.stringify(onay ? {} : { neden }) });
      setBilgi(onay ? "Bilgiler personel kartına yazıldı." : "Talep reddedildi.");
      await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "İşlem yapılamadı"); }
    finally { setIslenen(null); }
  };

  return (
    <div className="stack">
      <PageHeader title="Bilgi güncelleme talepleri" subtitle="Çalışanların self-servisten istediği telefon, adres ve IBAN değişiklikleri" actions={<Select value={durum} onChange={(e) => setDurum(e.target.value as Durum | "hepsi")} aria-label="Durum"><option value="bekliyor">Onay bekleyenler</option><option value="onaylandi">Onaylananlar</option><option value="reddedildi">Reddedilenler</option><option value="iptal">Geri çekilenler</option><option value="hepsi">Tümü</option></Select>} />
      {hata && <Alert tone="error">{hata}</Alert>}
      {bilgi && <Alert tone="success">{bilgi}</Alert>}
      <Card>
        {liste.length ? (
          <Table><thead><tr><th>Personel</th><th>Değişiklik</th><th>Tarih</th><th>Durum</th><th /></tr></thead>
            <tbody>{liste.map((t) => (
              <tr key={t.id}>
                <td><Link href={`/panel/personel/${t.personel.id}`}>{t.personel.ad} {t.personel.soyad}</Link><div className="subtle">{t.personel.personelNo}</div></td>
                <td>
                  {(Object.keys(t.istenen) as (keyof Alanlar)[]).map((k) => <div key={k}><strong>{ALAN_ADI[k]}:</strong> {t.mevcut[k] || "—"} → <strong>{t.istenen[k] || "—"}</strong></div>)}
                  {t.aciklama && <div className="subtle">Not: {t.aciklama}</div>}
                  {t.retNedeni && <div className="subtle">Ret nedeni: {t.retNedeni}</div>}
                </td>
                <td><Tarih deger={t.createdAt} /></td>
                <td><Badge variant={DURUM[t.durum][1]}>{DURUM[t.durum][0]}</Badge></td>
                <td className="num">{t.durum === "bekliyor" && <div className="row-tight"><Button size="sm" variant="primary" disabled={islenen === t.id} onClick={() => void karar(t, true)}>Onayla</Button><Button size="sm" disabled={islenen === t.id} onClick={() => void karar(t, false)}>Reddet</Button></div>}</td>
              </tr>
            ))}</tbody></Table>
        ) : <p className="muted">Bu durumda talep yok.</p>}
      </Card>
    </div>
  );
}
