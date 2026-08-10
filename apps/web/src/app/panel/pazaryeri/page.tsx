"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, PageHeader, Select, TableWrap } from "@/components/ui";

interface Siparis { id: string; siparisNo: string; durum: string; siparisTarihi: string; musteriUnvani: string; toplam: string; dovizCinsi: string; hataMesaji: string | null; baglanti: { saglayici: string }; cari: { kod: string; unvan: string } | null; fatura: { id: string; no: string | null } | null; satirlar: { id: string; urunAdi: string; sku: string; stokId: string | null }[]; }
interface Cari { id: string; kod: string; unvan: string; }

export default function PazaryeriSiparisleri() {
  const [siparisler, setSiparisler] = useState<Siparis[]>([]); const [cariler, setCariler] = useState<Cari[]>([]);
  const [secimler, setSecimler] = useState<Record<string, boolean>>({}); const [cariEsleme, setCariEsleme] = useState<Record<string, string>>({});
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState(""); const [islemde, setIslemde] = useState(false);
  const yukle = useCallback(async () => { try { const [s, c] = await Promise.all([api<Siparis[]>("/pazaryeri/siparisler"), api<{ kayitlar: Cari[] }>("/cari?adet=100")]); setSiparisler(s); setCariler(c.kayitlar); } catch (e) { setHata(e instanceof Error ? e.message : "Siparişler yüklenemedi"); } }, []);
  useEffect(() => { void yukle(); }, [yukle]);
  async function faturalastir() {
    const secili = siparisler.filter((s) => secimler[s.id] && !s.fatura);
    const eksik = secili.find((s) => !cariEsleme[s.id] || s.satirlar.some((x) => !x.stokId));
    if (!secili.length) return setHata("Faturalaştırılacak sipariş seçin.");
    if (eksik) return setHata(`${eksik.siparisNo} için cari veya ürün eşlemesi eksik.`);
    setIslemde(true); setHata("");
    try { const sonuc = await api<{ basarili: number; hatali: number }>("/pazaryeri/siparisler/faturalastir", { method: "POST", body: JSON.stringify({ siparisler: secili.map((s) => ({ siparisId: s.id, cariId: cariEsleme[s.id] })) }) }); setBasari(`${sonuc.basarili} satış faturası taslağı oluşturuldu${sonuc.hatali ? `, ${sonuc.hatali} sipariş hatalı` : ""}.`); setSecimler({}); await yukle(); } catch (e) { setHata(e instanceof Error ? e.message : "Faturalaştırma başarısız"); } finally { setIslemde(false); }
  }
  async function senkronize() {
    setIslemde(true); setHata(""); setBasari("");
    try {
      const sonuc = await api<{ sonuclar: { alinan: number; eklenen: number; hata?: string }[] }>("/pazaryeri/senkronize", { method: "POST", body: "{}" });
      const alinan = sonuc.sonuclar.reduce((toplam, s) => toplam + s.alinan, 0); const eklenen = sonuc.sonuclar.reduce((toplam, s) => toplam + s.eklenen, 0);
      const hatalar = sonuc.sonuclar.filter((s) => s.hata).map((s) => s.hata).join("; ");
      if (hatalar) setHata(hatalar); else setBasari(`${alinan} sipariş alındı, ${eklenen} yeni sipariş eklendi.`);
      await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Senkronizasyon başarısız"); } finally { setIslemde(false); }
  }
  return <div><PageHeader title="Pazaryeri Siparişleri" subtitle="Bağlı mağazalardan gelen siparişleri eşleyin ve ayrı satış faturası taslaklarına dönüştürün." actions={<div className="row-tight"><Button onClick={() => void senkronize()} disabled={islemde}>Şimdi senkronize et</Button><Button variant="primary" onClick={() => void faturalastir()} disabled={islemde}>{islemde ? "İşleniyor…" : "Seçilenleri faturalaştır"}</Button></div>} /><Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert><Card pad={false}><TableWrap><thead><tr><th className="center">Seç</th><th>Kaynak / Sipariş</th><th>Müşteri</th><th>Ürün eşleme</th><th>Cari</th><th>Durum</th><th className="num">Toplam</th></tr></thead><tbody>{siparisler.map((s) => { const eslesmeyen = s.satirlar.filter((x) => !x.stokId).length; return <tr key={s.id}><td className="center"><input aria-label={`${s.siparisNo} siparişini seç`} type="checkbox" disabled={Boolean(s.fatura) || eslesmeyen > 0} checked={Boolean(secimler[s.id])} onChange={(e) => setSecimler((x) => ({ ...x, [s.id]: e.target.checked }))} /></td><td><strong>{s.siparisNo}</strong><br/><small>{s.baglanti.saglayici} · {new Date(s.siparisTarihi).toLocaleDateString("tr-TR")}</small></td><td>{s.musteriUnvani}</td><td>{eslesmeyen ? <Badge variant="danger">{eslesmeyen} eşleşmedi</Badge> : <Badge variant="success">{s.satirlar.length} eşleşti</Badge>}</td><td>{s.fatura ? s.cari?.unvan ?? "—" : <Field label=""><Select aria-label={`${s.siparisNo} cari hesabı`} value={cariEsleme[s.id] ?? ""} onChange={(e) => setCariEsleme((x) => ({ ...x, [s.id]: e.target.value }))}><option value="">Cari seçin</option>{cariler.map((c) => <option key={c.id} value={c.id}>{c.kod} · {c.unvan}</option>)}</Select></Field>}</td><td>{s.fatura ? <a className="btn-link" href={`/panel/fatura?faturaId=${s.fatura.id}`}>Fatura {s.fatura.no ?? "taslak"}</a> : <Badge variant={s.durum === "hata" ? "danger" : "neutral"}>{s.durum}</Badge>}{s.hataMesaji && <div className="muted">{s.hataMesaji}</div>}</td><td className="num">{Number(s.toplam).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {s.dovizCinsi}</td></tr>; })}{!siparisler.length && <tr><td colSpan={7}>Henüz pazaryeri siparişi yok.</td></tr>}</tbody></TableWrap></Card></div>;
}
