"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tumSayfalariAl } from "@/lib/api";
import { Alert, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";

interface Fatura { id: string; no: string | null; tip: string; cari: { unvan: string }; genelToplam: string }
interface Plan {
  id: string; ad: string; siklik: "haftalik" | "aylik" | "yillik"; aralik: number;
  sonrakiTarih: string; bitisTarihi: string | null; aktif: boolean; sonUretimTarihi: string | null;
  sablonFatura: Fatura; _count: { uretilenler: number };
}

const tarih = (deger: string) => deger.slice(0, 10).split("-").reverse().join(".");
const para = (deger: string) => Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";

export default function TekrarlayanFaturalarPage() {
  const [planlar, setPlanlar] = useState<Plan[]>([]);
  const [faturalar, setFaturalar] = useState<Fatura[]>([]);
  const [hata, setHata] = useState("");
  const [mesaj, setMesaj] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [form, setForm] = useState({ ad: "", sablonFaturaId: "", siklik: "aylik", aralik: 1, sonrakiTarih: new Date().toISOString().slice(0, 10), bitisTarihi: "" });

  const yukle = useCallback(async () => {
    setYukleniyor(true); setHata("");
    try {
      const [p, f] = await Promise.all([api<Plan[]>("/fatura/tekrarlayanlar"), tumSayfalariAl<Fatura>("/fatura")]);
      setPlanlar(p); setFaturalar(f);
    } catch (e) { setHata(e instanceof Error ? e.message : "Kayıtlar yüklenemedi"); }
    finally { setYukleniyor(false); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  async function olustur(e: React.FormEvent) {
    e.preventDefault(); setHata(""); setMesaj("");
    try {
      await api("/fatura/tekrarlayanlar", { method: "POST", body: JSON.stringify({ ...form, bitisTarihi: form.bitisTarihi || null }) });
      setMesaj("Tekrarlayan fatura planı oluşturuldu."); setForm((x) => ({ ...x, ad: "", sablonFaturaId: "" })); await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Plan oluşturulamadı"); }
  }

  async function durumDegistir(plan: Plan) {
    await api(`/fatura/tekrarlayanlar/${plan.id}`, { method: "PATCH", body: JSON.stringify({ aktif: !plan.aktif }) });
    await yukle();
  }

  async function vadesiGelenleriUret() {
    setHata(""); setMesaj("");
    try {
      const sonuc = await api<{ uretilenAdet: number }>("/fatura/tekrarlayanlar/uret", { method: "POST" });
      setMesaj(`${sonuc.uretilenAdet} taslak fatura üretildi.`); await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Taslaklar üretilemedi"); }
  }

  return <div className="page-stack">
    <PageHeader title="Tekrarlayan Faturalar" subtitle="Düzenli işlemleri şablondan taslak faturaya dönüştürün." actions={<Button onClick={() => void vadesiGelenleriUret()}>Vadesi gelenleri üret</Button>} />
    {hata && <Alert tone="error">{hata}</Alert>}{mesaj && <Alert tone="success">{mesaj}</Alert>}
    <Card title="Yeni plan">
      <p className="muted">Şablon faturanın cari, kalem, fiyat ve vergi bilgileri korunur.</p>
      <form className="form-grid" onSubmit={olustur}>
        <Field label="Plan adı"><Input required value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} /></Field>
        <Field label="Şablon fatura"><Select required value={form.sablonFaturaId} onChange={(e) => setForm({ ...form, sablonFaturaId: e.target.value })}><option value="">Seçin</option>{faturalar.map((f) => <option key={f.id} value={f.id}>{f.no ?? "Taslak"} — {f.cari.unvan} — {para(f.genelToplam)}</option>)}</Select></Field>
        <Field label="Sıklık"><Select value={form.siklik} onChange={(e) => setForm({ ...form, siklik: e.target.value })}><option value="haftalik">Haftalık</option><option value="aylik">Aylık</option><option value="yillik">Yıllık</option></Select></Field>
        <Field label="Her"><Input type="number" min={1} max={36} value={form.aralik} onChange={(e) => setForm({ ...form, aralik: Number(e.target.value) })} /></Field>
        <Field label="İlk üretim"><Input type="date" required value={form.sonrakiTarih} onChange={(e) => setForm({ ...form, sonrakiTarih: e.target.value })} /></Field>
        <Field label="Bitiş (isteğe bağlı)"><Input type="date" value={form.bitisTarihi} onChange={(e) => setForm({ ...form, bitisTarihi: e.target.value })} /></Field>
        <div><Button type="submit">Planı oluştur</Button></div>
      </form>
    </Card>
    <Card title="Planlar">
      <p className="muted">{yukleniyor ? "Yükleniyor…" : `${planlar.length} plan`}</p>
      <TableWrap><thead><tr><th>Plan</th><th>Şablon / Cari</th><th>Tekrar</th><th>Sıradaki</th><th>Üretilen</th><th>Durum</th><th></th></tr></thead><tbody>
        {planlar.map((p) => <tr key={p.id}><td><strong>{p.ad}</strong></td><td>{p.sablonFatura.no ?? "Taslak"}<br /><small>{p.sablonFatura.cari.unvan}</small></td><td>Her {p.aralik} {p.siklik}</td><td>{tarih(p.sonrakiTarih)}</td><td>{p._count.uretilenler}</td><td>{p.aktif ? "Aktif" : "Duraklatıldı"}</td><td><Button variant="ghost" onClick={() => void durumDegistir(p)}>{p.aktif ? "Duraklat" : "Etkinleştir"}</Button></td></tr>)}
        {!yukleniyor && !planlar.length && <tr><td colSpan={7}>Henüz tekrarlayan fatura planı yok.</td></tr>}
      </tbody></TableWrap>
    </Card>
  </div>;
}
