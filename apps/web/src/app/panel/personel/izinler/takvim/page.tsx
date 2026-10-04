"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table } from "@/components/ui";

interface Tatil { id: string; tarih: string; ad: string; yarimGun: boolean }

const tarihYazi = (v: string) => new Date(v).toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** İzin gün sayımından düşülen tam ve yarım tatil günleri (çalışma takvimiyle ortak). */
export default function CalismaTakvimi() {
  const buYil = new Date().getFullYear();
  const [yil, setYil] = useState(buYil);
  const [tatiller, setTatiller] = useState<Tatil[]>([]);
  const [hata, setHata] = useState("");
  const [islemde, setIslemde] = useState(false);
  const [form, setForm] = useState({ tarih: `${buYil}-01-01`, ad: "", yarimGun: false });

  const yukle = useCallback(async () => {
    try { setHata(""); setTatiller(await api<Tatil[]>(`/personel/izinler/tatiller?yil=${yil}`)); }
    catch (e) { setHata(e instanceof Error ? e.message : "Takvim alınamadı"); }
  }, [yil]);
  useEffect(() => { void yukle(); }, [yukle]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault(); setIslemde(true);
    try { await api("/personel/izinler/tatiller", { method: "POST", body: JSON.stringify(form) }); setForm({ ...form, ad: "", yarimGun: false }); await yukle(); }
    catch (err) { setHata(err instanceof Error ? err.message : "Tatil kaydedilemedi"); }
    finally { setIslemde(false); }
  }
  async function sil(t: Tatil) {
    if (!confirm(`${t.ad} takvimden silinsin mi?`)) return;
    try { await api(`/personel/izinler/tatiller/${t.id}`, { method: "DELETE" }); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "Tatil silinemedi"); }
  }

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel/izinler">← İzin yönetimine dön</Link>
      <PageHeader title="Çalışma ve resmî tatil takvimi" subtitle="İzin hesabından düşülecek tam ve yarım tatil günlerini yönetin." />
      <Alert tone="error">{hata}</Alert>
      <div className="split">
        <Card title="Takvime gün ekle">
          <form className="stack" onSubmit={kaydet}>
            <Field label="Tarih"><Input required type="date" value={form.tarih} onChange={(e) => setForm({ ...form, tarih: e.target.value })} /></Field>
            <Field label="Açıklama"><Input required minLength={2} maxLength={100} value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} placeholder="Örn. Cumhuriyet Bayramı" /></Field>
            <label className="check"><input type="checkbox" checked={form.yarimGun} onChange={(e) => setForm({ ...form, yarimGun: e.target.checked })} /><span>Yarım gün çalışma dışı</span></label>
            <Button block type="submit" variant="primary" disabled={islemde}>{islemde ? "Kaydediliyor…" : "Takvime kaydet"}</Button>
            <p className="muted" style={{ margin: 0, fontSize: "0.78rem" }}>Aynı tarih yeniden kaydedilirse mevcut tanım güncellenir.</p>
          </form>
        </Card>
        <Card pad={false}>
          <div className="between" style={{ padding: "1rem 1.25rem" }}>
            <div><div className="card__title" style={{ margin: 0 }}>{yil} takvimi</div><small className="muted">{tatiller.length} özel gün</small></div>
            <Select aria-label="Yıl" value={yil} onChange={(e) => setYil(Number(e.target.value))} style={{ width: "auto" }}>
              {Array.from({ length: 5 }, (_, i) => buYil - 1 + i).map((y) => <option key={y}>{y}</option>)}
            </Select>
          </div>
          <Table>
            <thead><tr><th>Gün</th><th>Süre</th><th /></tr></thead>
            <tbody>
              {tatiller.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.ad}</strong><div className="subtle" style={{ textTransform: "capitalize" }}>{tarihYazi(t.tarih)}</div></td>
                  <td><Badge variant={t.yarimGun ? "warning" : "danger"}>{t.yarimGun ? "Yarım gün" : "Tam gün"}</Badge></td>
                  <td className="num"><Button size="sm" variant="danger" onClick={() => void sil(t)}>Sil</Button></td>
                </tr>
              ))}
              {!tatiller.length && <tr><td className="muted" colSpan={3}>Bu yıl için tatil günü tanımlanmamış.</td></tr>}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
