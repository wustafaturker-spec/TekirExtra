"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Stat, StatGrid, TableWrap } from "@/components/ui";
import { api, tokenAl, tumSayfalariAl } from "@/lib/api";

interface Kategori { id: string; ad: string }
interface Cari { id: string; unvan: string }
interface Sozlesme { id: string; baslik: string; tasinmazAdresi: string | null; kirayaVeren: string | null; baslangicTarihi: string; bitisTarihi: string | null; odemeGunu: number; matrah: string; kdvOrani: string; stopajOrani: string; dovizCinsi: string; aktif: boolean; cari: Cari | null; kategori: Kategori; _count: { masraflar: number } }
const bugun = new Date().toISOString().slice(0, 10);
const buAy = new Date().toISOString().slice(0, 7);
const para = (n: string | number, d: string) => Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " " + d;

export default function KiraSozlesmeleriSayfasi() {
  const [sozlesmeler, setSozlesmeler] = useState<Sozlesme[]>([]); const [kategoriler, setKategoriler] = useState<Kategori[]>([]); const [cariler, setCariler] = useState<Cari[]>([]);
  const [formAcik, setFormAcik] = useState(false); const [hata, setHata] = useState(""); const [basari, setBasari] = useState("");
  const [kategoriId, setKategoriId] = useState(""); const [cariId, setCariId] = useState(""); const [baslik, setBaslik] = useState(""); const [kirayaVeren, setKirayaVeren] = useState("");
  const [adres, setAdres] = useState(""); const [vknTckn, setVknTckn] = useState(""); const [iban, setIban] = useState(""); const [baslangic, setBaslangic] = useState(bugun); const [bitis, setBitis] = useState("");
  const [odemeGunu, setOdemeGunu] = useState("1"); const [matrah, setMatrah] = useState(""); const [kdv, setKdv] = useState("0"); const [stopaj, setStopaj] = useState("0"); const [dosya, setDosya] = useState<File | null>(null);
  const [donemler, setDonemler] = useState<Record<string, string>>({});
  const yukle = useCallback(async () => { const [s, k, c] = await Promise.all([api<Sozlesme[]>("/masraflar/kiralar"), api<Kategori[]>("/masraflar/kategoriler"), tumSayfalariAl<Cari>("/cari")]); setSozlesmeler(s); setKategoriler(k); setCariler(c); setKategoriId((x) => x || k.find((a) => a.ad === "Kira")?.id || k[0]?.id || ""); }, []);
  useEffect(() => { if (tokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Sözleşmeler yüklenemedi")); }, [yukle]);
  const aylikToplam = useMemo(() => sozlesmeler.filter((s) => s.aktif).reduce((t, s) => t + Number(s.matrah) * (1 + Number(s.kdvOrani) / 100), 0), [sozlesmeler]);

  async function kaydet(e: React.FormEvent) { e.preventDefault(); setHata(""); try { const s = await api<Sozlesme>("/masraflar/kiralar", { method: "POST", body: JSON.stringify({ kategoriId, cariId: cariId || null, baslik, tasinmazAdresi: adres || null, kirayaVeren: cariId ? null : kirayaVeren, vknTckn: vknTckn || null, iban: iban || null, baslangicTarihi: baslangic, bitisTarihi: bitis || null, odemeGunu, matrah, kdvOrani: kdv, stopajOrani: stopaj, dovizCinsi: "TRY" }) }); if (dosya) { const f = new FormData(); f.append("dosya", dosya); await api(`/ekler?sahipTur=kira_sozlesme&sahipId=${s.id}`, { method: "POST", body: f }); } setBasari("Kira sözleşmesi oluşturuldu."); setFormAcik(false); setBaslik(""); setMatrah(""); setDosya(null); await yukle(); } catch (e) { setHata(e instanceof Error ? e.message : "Sözleşme oluşturulamadı"); } }
  async function donemOlustur(s: Sozlesme) { setHata(""); try { await api(`/masraflar/kiralar/${s.id}/donem`, { method: "POST", body: JSON.stringify({ donem: donemler[s.id] || buAy }) }); setBasari(`${s.baslik} için kira masrafı oluşturuldu.`); await yukle(); } catch (e) { setHata(e instanceof Error ? e.message : "Dönem oluşturulamadı"); } }
  async function aktiflik(s: Sozlesme) { try { await api(`/masraflar/kiralar/${s.id}/aktiflik`, { method: "POST", body: JSON.stringify({ aktif: !s.aktif }) }); await yukle(); } catch (e) { setHata(e instanceof Error ? e.message : "Durum değiştirilemedi"); } }

  return <><PageHeader title="Kira Sözleşmeleri" subtitle="Aylık kira giderlerini cari hesap zorunluluğu olmadan üretin." actions={<Button variant="primary" onClick={() => setFormAcik((x) => !x)}>{formAcik ? "Formu kapat" : "Yeni sözleşme"}</Button>} />
    {hata && <Alert tone="error">{hata}</Alert>}{basari && <Alert tone="success">{basari}</Alert>}
    <StatGrid><Stat label="Aktif sözleşme" value={sozlesmeler.filter((s) => s.aktif).length} /><Stat label="Aylık kira toplamı" value={para(aylikToplam, "TRY")} tone="accent" /><Stat label="Üretilen dönem" value={sozlesmeler.reduce((t, s) => t + s._count.masraflar, 0)} tone="info" /></StatGrid>
    {formAcik && <Card title="Yeni kira sözleşmesi" style={{ marginTop: "1rem" }}><form onSubmit={kaydet}><div className="form-grid">
      <Field label="Sözleşme başlığı"><Input required value={baslik} onChange={(e) => setBaslik(e.target.value)} placeholder="Merkez ofis kirası" /></Field><Field label="Masraf kategorisi"><Select required value={kategoriId} onChange={(e) => setKategoriId(e.target.value)}>{kategoriler.map((k) => <option key={k.id} value={k.id}>{k.ad}</option>)}</Select></Field>
      <Field label="Cari (isteğe bağlı)"><Select value={cariId} onChange={(e) => setCariId(e.target.value)}><option value="">Cari kullanma</option>{cariler.map((c) => <option key={c.id} value={c.id}>{c.unvan}</option>)}</Select></Field>{!cariId && <Field label="Kiraya veren"><Input required value={kirayaVeren} onChange={(e) => setKirayaVeren(e.target.value)} /></Field>}
      <Field label="Taşınmaz adresi"><Input value={adres} onChange={(e) => setAdres(e.target.value)} /></Field><Field label="VKN / TCKN"><Input value={vknTckn} onChange={(e) => setVknTckn(e.target.value)} /></Field><Field label="IBAN"><Input value={iban} onChange={(e) => setIban(e.target.value)} /></Field>
      <Field label="Başlangıç"><Input required type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} /></Field><Field label="Bitiş (isteğe bağlı)"><Input type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} /></Field><Field label="Aylık ödeme günü"><Input required type="number" min="1" max="31" value={odemeGunu} onChange={(e) => setOdemeGunu(e.target.value)} /></Field>
      <Field label="Aylık matrah"><Input required type="number" min="0.01" step="0.01" value={matrah} onChange={(e) => setMatrah(e.target.value)} /></Field><Field label="KDV oranı"><Input required type="number" min="0" max="100" step="0.01" value={kdv} onChange={(e) => setKdv(e.target.value)} /></Field><Field label="Stopaj oranı"><Input required type="number" min="0" max="100" step="0.01" value={stopaj} onChange={(e) => setStopaj(e.target.value)} /></Field>
      <Field label="Sözleşme belgesi"><Input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setDosya(e.target.files?.[0] ?? null)} /></Field>
    </div><div className="row" style={{ marginTop: "1rem" }}><Button type="submit" variant="primary">Sözleşmeyi kaydet</Button></div></form></Card>}
    <Card title="Sözleşmeler" pad={false} style={{ marginTop: "1rem" }}><TableWrap><thead><tr><th>Sözleşme</th><th>Kiraya veren</th><th>Dönem</th><th>Aylık tutar</th><th>Stopaj</th><th>Durum</th><th>Dönem oluştur</th><th></th></tr></thead><tbody>{sozlesmeler.map((s) => <tr key={s.id}><td><strong>{s.baslik}</strong><br /><small>{s.tasinmazAdresi}</small></td><td>{s.cari?.unvan ?? s.kirayaVeren}</td><td>{new Date(s.baslangicTarihi).toLocaleDateString("tr-TR")} – {s.bitisTarihi ? new Date(s.bitisTarihi).toLocaleDateString("tr-TR") : "Süresiz"}</td><td>{para(Number(s.matrah) * (1 + Number(s.kdvOrani) / 100), s.dovizCinsi)}</td><td>%{s.stopajOrani}</td><td><Badge variant={s.aktif ? "success" : "neutral"}>{s.aktif ? "Aktif" : "Pasif"}</Badge></td><td><div className="row"><Input type="month" value={donemler[s.id] || buAy} onChange={(e) => setDonemler((x) => ({ ...x, [s.id]: e.target.value }))} /><Button size="sm" disabled={!s.aktif} onClick={() => void donemOlustur(s)}>Oluştur</Button></div></td><td><Button size="sm" variant={s.aktif ? "danger" : "ghost"} onClick={() => void aktiflik(s)}>{s.aktif ? "Pasife al" : "Aktifleştir"}</Button></td></tr>)}</tbody></TableWrap></Card>
  </>;
}
