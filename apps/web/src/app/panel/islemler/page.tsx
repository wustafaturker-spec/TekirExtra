"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Select, TableWrap } from "@/components/ui";
import { api } from "@/lib/api";

type Durum = "acik" | "incelemede" | "beklemede" | "cozuldu" | "yoksayildi";
type Onem = "bilgi" | "uyari" | "kritik";
interface Kayit { id: string; tur: string; onem: Onem; durum: Durum; kaynakTur: string; kaynakRef: string; nedenKodu: string; aciklama: string; onerilenEylem: string | null; createdAt: string; sonTarih: string | null; atanan: { id: string; adSoyad: string } | null }
interface Liste { kayitlar: Kayit[]; toplam: number; sayfa: number; toplamSayfa: number }
interface Ozet { acik: number; kritik: number; banaAtanan: number; slaAsan: number }

const DURUM_ADI: Record<Durum, string> = { acik: "Açık", incelemede: "İncelemede", beklemede: "Beklemede", cozuldu: "Çözüldü", yoksayildi: "Yoksayıldı" };
const TUR_ADI: Record<string, string> = { banka_ekstre: "Banka ekstresi", kredi_karti: "Kredi kartı", masraf: "Masraf", pos: "POS", ebelge: "e-Belge", stok: "Stok", cek_senet: "Çek / senet", fatura_cari: "Fatura / cari" };
const KAYNAK_YOLU: Record<string, string> = { banka_ekstre_satiri: "/panel/kasa-banka/ekstre", kredi_karti_hareketi: "/panel/kasa-banka/kredi-kartlari", masraf: "/panel/masraflar", pos_tahsilat: "/panel/kasa-banka/pos", ebelge: "/panel/ebelge/kuyruk", stok_depo_bakiyesi: "/panel/stok", cek_senet: "/panel/kasa-banka/cek-senet", fatura: "/panel/fatura" };

export default function DuzeltmeMerkeziSayfasi() {
  const [liste, setListe] = useState<Liste>({ kayitlar: [], toplam: 0, sayfa: 1, toplamSayfa: 0 });
  const [ozet, setOzet] = useState<Ozet>({ acik: 0, kritik: 0, banaAtanan: 0, slaAsan: 0 });
  const [durum, setDurum] = useState<Durum | "">("acik");
  const [yukleniyor, setYukleniyor] = useState(true); const [hata, setHata] = useState(""); const [mesaj, setMesaj] = useState("");

  const yukle = useCallback(async () => {
    setYukleniyor(true); setHata("");
    try {
      const parametre = durum ? `?durum=${durum}` : "";
      const [kayitlar, sayilar] = await Promise.all([api<Liste>(`/duzeltmeler${parametre}`), api<Ozet>("/duzeltmeler/ozet")]);
      setListe(kayitlar); setOzet(sayilar);
    } catch (e) { setHata(e instanceof Error ? e.message : "Düzeltme kayıtları alınamadı"); }
    finally { setYukleniyor(false); }
  }, [durum]);

  useEffect(() => { void yukle(); }, [yukle]);

  async function tara() {
    setMesaj(""); setHata("");
    try {
      const sonuc = await api<{ bulunan: number; otomatikCozulen: number }>("/duzeltmeler/tara", { method: "POST" });
      setMesaj(`${sonuc.bulunan} bulgu güncellendi, ${sonuc.otomatikCozulen} kayıt otomatik çözüldü.`); await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Tarama başlatılamadı"); }
  }

  async function durumDegistir(id: string, yeniDurum: Durum) {
    try { await api(`/duzeltmeler/${id}/durum`, { method: "PATCH", body: JSON.stringify({ durum: yeniDurum }) }); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "Durum güncellenemedi"); }
  }

  return <div className="stack">
    <div className="page-header"><div><p className="eyebrow">R1 · MERKEZİ MUTABAKAT</p><h1>Düzeltme Merkezi</h1><p>Finansal istisnaları tek kuyrukta inceleyin, atayın ve çözün.</p></div><Button onClick={() => void tara()}>↻ Yeniden tara</Button></div>
    {hata && <Alert tone="error">{hata}</Alert>}{mesaj && <Alert tone="success">{mesaj}</Alert>}
    <div className="stats-grid"><Card><span className="muted">Açık kayıt</span><h2>{ozet.acik}</h2></Card><Card><span className="muted">Kritik</span><h2>{ozet.kritik}</h2></Card><Card><span className="muted">Bana atanan</span><h2>{ozet.banaAtanan}</h2></Card><Card><span className="muted">SLA aşan</span><h2>{ozet.slaAsan}</h2></Card></div>
    <Card pad={false} title={<div className="page-header"><div><h2>İş kuyruğu</h2><span className="muted">{liste.toplam} kayıt</span></div><Select aria-label="Durum filtresi" value={durum} onChange={(e) => setDurum(e.target.value as Durum | "")}><option value="">Tüm durumlar</option>{Object.entries(DURUM_ADI).map(([kod, ad]) => <option key={kod} value={kod}>{ad}</option>)}</Select></div>}>
      <TableWrap><thead><tr><th>Bulgu</th><th>Önem / durum</th><th>Atanan</th><th>Önerilen eylem</th><th>İşlem</th></tr></thead><tbody>
        {liste.kayitlar.map((kayit) => <tr key={kayit.id}><td><strong>{TUR_ADI[kayit.tur] ?? kayit.tur}</strong><div>{kayit.aciklama}</div><small className="muted">{new Date(kayit.createdAt).toLocaleString("tr-TR")}</small></td><td><Badge variant={kayit.onem === "kritik" ? "danger" : kayit.onem === "uyari" ? "warning" : "info"}>{kayit.onem}</Badge><small>{DURUM_ADI[kayit.durum]}</small></td><td>{kayit.atanan?.adSoyad ?? "Atanmadı"}</td><td>{kayit.onerilenEylem ?? "Kaynağı inceleyin."}{KAYNAK_YOLU[kayit.kaynakTur] && <div><Link href={KAYNAK_YOLU[kayit.kaynakTur]}>Kaynağa git →</Link></div>}</td><td><div className="inline-actions">{kayit.durum === "acik" && <Button size="sm" variant="ghost" onClick={() => void durumDegistir(kayit.id, "incelemede")}>İncele</Button>}{!["cozuldu", "yoksayildi"].includes(kayit.durum) && <Button size="sm" onClick={() => void durumDegistir(kayit.id, "cozuldu")}>Çöz</Button>}</div></td></tr>)}
        {!yukleniyor && !liste.kayitlar.length && <tr><td colSpan={5}>Bu filtrede düzeltme kaydı bulunmuyor.</td></tr>}{yukleniyor && !liste.kayitlar.length && <tr><td colSpan={5}>Yükleniyor…</td></tr>}
      </tbody></TableWrap>
    </Card>
  </div>;
}
