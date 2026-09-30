"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, TableWrap } from "@/components/ui";
import { bugunTR, DINI_BAYRAM_YILLARI } from "@tekirextra/shared";

interface Tatil { id: string; tarih: string; ad: string; yarimGun: boolean }

const gunAdi = (tarih: string) => new Date(`${tarih.slice(0, 10)}T12:00:00`).toLocaleDateString("tr-TR", { weekday: "long" });

/**
 * Firmanın çalışma takvimi: üretim gününün başlangıç saati ve tatil günleri.
 * Üretim planı, kapasite hesabı ve personel izin günü sayımı bu takvimi kullanır.
 */
export default function CalismaTakvimiSayfasi() {
  const [yil, setYil] = useState(Number(bugunTR().slice(0, 4)));
  const [tatiller, setTatiller] = useState<Tatil[]>([]);
  const [baslangicSaati, setBaslangicSaati] = useState("08:00");
  const [tarih, setTarih] = useState(""); const [ad, setAd] = useState(""); const [yarimGun, setYarimGun] = useState(false);
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState(""); const [islem, setIslem] = useState(false);

  const yukle = useCallback(async () => {
    const [liste, ayar] = await Promise.all([api<Tatil[]>(`/calisma-takvimi/tatiller?yil=${yil}`), api<{ gunBaslangicSaati: string }>("/ayarlar/calisma_takvimi")]);
    setTatiller(liste); setBaslangicSaati(ayar.gunBaslangicSaati);
  }, [yil]);
  useEffect(() => { if (tokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Takvim yüklenemedi")); }, [yukle]);

  async function calis(is: () => Promise<string>) {
    setIslem(true); setHata(""); setBasari("");
    try { setBasari(await is()); await yukle(); } catch (e) { setHata(e instanceof Error ? e.message : "İşlem başarısız"); } finally { setIslem(false); }
  }
  const saatKaydet = (e: React.FormEvent) => { e.preventDefault(); void calis(async () => { await api("/ayarlar/calisma_takvimi", { method: "PUT", body: JSON.stringify({ gunBaslangicSaati: baslangicSaati }) }); return "Günün başlangıç saati kaydedildi. Yeni açılan üretim emirleri bu saatten planlanır."; }); };
  const resmiYukle = () => void calis(async () => { const s = await api<{ eklenen: number; mevcut: number; diniBayramlarVar: boolean }>("/calisma-takvimi/resmi-tatiller", { method: "POST", body: JSON.stringify({ yil }) }); return `${yil} resmî tatilleri: ${s.eklenen} gün eklendi${s.mevcut ? `, ${s.mevcut} gün zaten vardı (dokunulmadı)` : ""}.${s.diniBayramlarVar ? "" : " Bu yılın dinî bayram tarihleri yerleşik değil; elle ekleyin."}`; });
  const tatilEkle = (e: React.FormEvent) => { e.preventDefault(); void calis(async () => { await api("/calisma-takvimi/tatiller", { method: "POST", body: JSON.stringify({ tarih, ad, yarimGun }) }); setTarih(""); setAd(""); setYarimGun(false); return "Tatil günü kaydedildi."; }); };
  const tatilSil = (t: Tatil) => void calis(async () => { await api(`/calisma-takvimi/tatiller/${t.id}`, { method: "DELETE" }); return `${t.ad} kaldırıldı.`; });

  return <div className="production-page">
    <PageHeader title="Çalışma Takvimi" subtitle="Üretim planı, kapasite ve izin günü sayımı bu takvime göre yapılır: cumartesi yarım gün, pazar ve tatiller çalışılmaz." />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>
    <Card title="Günün başlangıç saati"><form className="form-grid" onSubmit={saatKaydet}>
      <Field label="Üretim günü başlar"><Input required type="time" value={baslangicSaati} onChange={(e) => setBaslangicSaati(e.target.value)} /></Field>
      <p className="muted">Operasyonlar bu saatten başlayarak iş merkezinin günlük kapasitesi kadar planlanır. Mevcut emirlerin planı değişmez.</p>
      <div><Button type="submit" variant="primary" disabled={islem}>Kaydet</Button></div>
    </form></Card>
    <Card title={`Tatil günleri — ${yil}`} actions={<div className="row-tight"><Button size="sm" onClick={() => setYil((y) => y - 1)}>‹ {yil - 1}</Button><Button size="sm" onClick={() => setYil((y) => y + 1)}>{yil + 1} ›</Button><Button size="sm" variant="primary" disabled={islem} onClick={resmiYukle}>{yil} resmî tatillerini yükle</Button></div>} pad={false}>
      <TableWrap><thead><tr><th>Tarih</th><th>Gün</th><th>Ad</th><th>Süre</th><th /></tr></thead><tbody>
        {tatiller.map((t) => <tr key={t.id}><td><strong>{new Date(t.tarih).toLocaleDateString("tr-TR")}</strong></td><td>{gunAdi(t.tarih)}</td><td>{t.ad}</td><td><Badge variant={t.yarimGun ? "warning" : "info"}>{t.yarimGun ? "Yarım gün" : "Tam gün"}</Badge></td><td><Button size="sm" variant="danger" disabled={islem} onClick={() => tatilSil(t)}>Sil</Button></td></tr>)}
        {!tatiller.length && <tr><td colSpan={5}>{yil} için tatil günü yok. “Resmî tatillerini yükle” ile başlayabilirsiniz.</td></tr>}
      </tbody></TableWrap>
      {!DINI_BAYRAM_YILLARI.includes(yil) && <p className="muted production-note">{yil} yılının Ramazan ve Kurban Bayramı tarihleri yerleşik değil; Diyanet takvimine göre elle ekleyin.</p>}
    </Card>
    <Card title="Tatil günü ekle"><form className="form-grid" onSubmit={tatilEkle}>
      <Field label="Tarih"><Input required type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} /></Field>
      <Field label="Ad"><Input required minLength={2} maxLength={100} value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Örn. bayram arifesi, fabrika bakımı" /></Field>
      <label className="check"><input type="checkbox" checked={yarimGun} onChange={(e) => setYarimGun(e.target.checked)} /><span>Yarım gün (öğleden sonra tatil)</span></label>
      <div><Button type="submit" variant="primary" disabled={islem}>Ekle</Button></div>
    </form></Card>
  </div>;
}
