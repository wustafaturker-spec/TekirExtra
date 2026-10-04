"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { BelgeDosyalari } from "@/components/belge-dosyalari";
import { Alert, Badge, Button, Card, Field, Input, Select, Table } from "@/components/ui";

interface PersonelBelgesi {
  id: string; ekId: string; tur: string; aciklama?: string | null; belgeTarihi?: string | null;
  gecerlilikTarihi?: string | null; createdAt: string;
  ek: { dosyaAdi: string; mimeTip: string; boyut: number };
}

const TUR_ADLARI: Record<string, string> = {
  kimlik: "Kimlik", is_sozlesmesi: "İş sözleşmesi", diploma: "Diploma", sertifika: "Sertifika",
  saglik_raporu: "Sağlık raporu", adli_sicil: "Adli sicil", ikametgah: "İkametgâh",
  askerlik: "Askerlik belgesi", sgk_bildirgesi: "SGK bildirgesi", diger: "Diğer",
};
const gun = (v?: string | null) => v ? new Date(v).toLocaleDateString("tr-TR", { timeZone: "UTC" }) : "—";

export function PersonelBelgeleri({ personelId }: { personelId: string }) {
  const [belgeler, setBelgeler] = useState<PersonelBelgesi[]>([]);
  const [dosyalar, setDosyalar] = useState<File[]>([]);
  const [form, setForm] = useState({ tur: "is_sozlesmesi", aciklama: "", belgeTarihi: "", gecerlilikTarihi: "" });
  const [islemde, setIslemde] = useState(false); const [hata, setHata] = useState("");
  const yukle = useCallback(async () => { try { setBelgeler(await api<PersonelBelgesi[]>(`/personel/${personelId}/belgeler`)); } catch (e) { setHata(e instanceof Error ? e.message : "Belgeler alınamadı"); } }, [personelId]);
  useEffect(() => { void yukle(); }, [yukle]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault(); if (!dosyalar[0]) return;
    setIslemde(true); setHata("");
    try {
      const govde = new FormData(); govde.append("dosya", dosyalar[0]);
      Object.entries(form).forEach(([k, v]) => { if (v) govde.append(k, v); });
      await api(`/personel/${personelId}/belgeler`, { method: "POST", body: govde });
      setDosyalar([]); setForm({ ...form, aciklama: "", belgeTarihi: "", gecerlilikTarihi: "" }); await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Belge yüklenemedi"); } finally { setIslemde(false); }
  }
  async function sil(b: PersonelBelgesi) {
    if (!confirm(`${b.ek.dosyaAdi} silinsin mi?`)) return;
    try { await api(`/personel/${personelId}/belgeler/${b.id}`, { method: "DELETE" }); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "Belge silinemedi"); }
  }

  return (
    <Card title="Özlük belgeleri" pad={false}>
      <div className="stack" style={{ padding: "0 1.1rem 1.1rem" }}>
        <p className="muted" style={{ margin: 0 }}>Personel evraklarını sınıflandırın ve süre sonlarını izleyin.</p>
        <Alert tone="error">{hata}</Alert>
        <form className="form-grid" onSubmit={kaydet}>
          <Field label="Belge türü"><Select value={form.tur} onChange={(e) => setForm({ ...form, tur: e.target.value })}>{Object.entries(TUR_ADLARI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Belge tarihi"><Input type="date" value={form.belgeTarihi} onChange={(e) => setForm({ ...form, belgeTarihi: e.target.value })} /></Field>
          <Field label="Geçerlilik sonu"><Input type="date" value={form.gecerlilikTarihi} min={form.belgeTarihi || undefined} onChange={(e) => setForm({ ...form, gecerlilikTarihi: e.target.value })} /></Field>
          <Field label="Açıklama" className="form-grid__tam"><Input maxLength={500} value={form.aciklama} onChange={(e) => setForm({ ...form, aciklama: e.target.value })} /></Field>
          <div className="form-grid__tam stack" style={{ gap: "0.6rem" }}>
            <BelgeDosyalari dosyalar={dosyalar} onChange={(d) => setDosyalar(d.slice(0, 1))} />
            <div><Button type="submit" variant="primary" disabled={!dosyalar.length || islemde}>{islemde ? "Yükleniyor…" : "Belgeyi özlük dosyasına ekle"}</Button></div>
          </div>
        </form>
      </div>
      <Table>
        <thead><tr><th>Belge</th><th>Tarihler</th><th /></tr></thead>
        <tbody>
          {belgeler.map((b) => {
            const kalan = b.gecerlilikTarihi ? Math.ceil((new Date(b.gecerlilikTarihi).getTime() - Date.now()) / 86400000) : null;
            return (
              <tr key={b.id}>
                <td>
                  <div className="row-tight"><strong>{b.ek.dosyaAdi}</strong><Badge variant="accent">{TUR_ADLARI[b.tur]}</Badge>{kalan !== null && kalan <= 30 && <Badge variant={kalan < 0 ? "danger" : "warning"}>{kalan < 0 ? "Süresi doldu" : `${kalan} gün kaldı`}</Badge>}</div>
                  {b.aciklama && <div className="muted" style={{ fontSize: "0.8rem" }}>{b.aciklama}</div>}
                </td>
                <td className="muted" style={{ fontSize: "0.8rem" }}>Belge: {gun(b.belgeTarihi)} · Geçerlilik: {gun(b.gecerlilikTarihi)} · {(b.ek.boyut / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} KB</td>
                <td className="num"><div className="row-tight" style={{ justifyContent: "flex-end" }}><Button size="sm" onClick={() => void apiDosyaIndir(`/ekler/${b.ekId}/indir`, b.ek.dosyaAdi)}>İndir</Button><Button size="sm" variant="danger" onClick={() => void sil(b)}>Sil</Button></div></td>
              </tr>
            );
          })}
          {!belgeler.length && <tr><td className="muted" colSpan={3}>Henüz özlük belgesi eklenmemiş.</td></tr>}
        </tbody>
      </Table>
    </Card>
  );
}
