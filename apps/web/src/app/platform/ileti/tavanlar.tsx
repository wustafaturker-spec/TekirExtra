"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Card, Field, Input, Select, TableWrap } from "@/components/ui";
import { platformApi } from "@/lib/platform-api";

/** ILT-14: firma başına gönderim tavanları. Parola ve doğrulama iletileri bu sayıma girmez. */
const ALANLAR = [["epostaGunluk", "Günlük e-posta"], ["epostaAylik", "Aylık e-posta"], ["smsGunluk", "Günlük SMS"], ["smsAylik", "Aylık SMS"]] as const;
type Alan = (typeof ALANLAR)[number][0];
type Tavanlar = Record<Alan, number>;
type Istisna = Record<Alan, number | null> & { tenantId: string; firma: string };
interface Yanit { varsayilan: Tavanlar; istisnalar: Istisna[] }
interface Firma { tenantId: string; unvan: string }
const BOS: Record<Alan, string> = { epostaGunluk: "", epostaAylik: "", smsGunluk: "", smsAylik: "" };

export function GonderimTavanlari() {
  const [veri, setVeri] = useState<Yanit | null>(null);
  const [form, setForm] = useState<Tavanlar | null>(null);
  const [arama, setArama] = useState("");
  const [adaylar, setAdaylar] = useState<Firma[]>([]);
  const [firmaId, setFirmaId] = useState("");
  const [istisna, setIstisna] = useState(BOS);
  const [hata, setHata] = useState(""); const [bilgi, setBilgi] = useState(""); const [islem, setIslem] = useState(false);

  const uygula = (y: Yanit) => { setVeri(y); setForm(y.varsayilan); };
  useEffect(() => { void platformApi<Yanit>("/platform/ileti/tavan").then(uygula).catch((e: unknown) => setHata(e instanceof Error ? e.message : "Tavanlar yüklenemedi.")); }, []);
  useEffect(() => {
    if (arama.trim().length < 2) { setAdaylar([]); return; }
    const z = setTimeout(() => { void platformApi<{ kayitlar: Firma[] }>(`/platform/firmalar/sayfali?${new URLSearchParams({ arama: arama.trim(), sayfaBoyutu: "20" })}`).then((r) => setAdaylar(r.kayitlar)).catch(() => setAdaylar([])); }, 300);
    return () => clearTimeout(z);
  }, [arama]);

  async function calis(is: () => Promise<Yanit>, mesaj: string) {
    setIslem(true); setHata(""); setBilgi("");
    try { uygula(await is()); setBilgi(mesaj); return true; }
    catch (e) { setHata(e instanceof Error ? e.message : "İşlem başarısız."); return false; }
    finally { setIslem(false); }
  }
  const varsayilanKaydet = (e: FormEvent) => {
    e.preventDefault();
    if (form) void calis(() => platformApi<Yanit>("/platform/ileti/tavan", { method: "PUT", body: JSON.stringify(form) }), "Varsayılan tavanlar kaydedildi. Bir dakika içinde geçerli olur.");
  };
  const istisnaKaydet = (e: FormEvent) => {
    e.preventDefault();
    const govde = Object.fromEntries(ALANLAR.map(([k]) => [k, istisna[k] === "" ? null : Number(istisna[k])]));
    void calis(() => platformApi<Yanit>(`/platform/ileti/tavan/firma/${firmaId}`, { method: "PUT", body: JSON.stringify(govde) }), "Firma istisnası kaydedildi.").then((tamam) => { if (tamam) { setFirmaId(""); setArama(""); setIstisna(BOS); } });
  };
  const kaldir = (i: Istisna) => void calis(() => platformApi<Yanit>(`/platform/ileti/tavan/firma/${i.tenantId}`, { method: "DELETE" }), `${i.firma} için istisna kaldırıldı.`);
  const duzenle = (i: Istisna) => { setFirmaId(i.tenantId); setAdaylar([{ tenantId: i.tenantId, unvan: i.firma }]); setIstisna(Object.fromEntries(ALANLAR.map(([k]) => [k, i[k] === null ? "" : String(i[k])])) as Record<Alan, string>); };

  return <Card title="Gönderim tavanları">
    <p className="muted">Firma başına üst sınır. Tavan dolunca iletiler durur ve firma yöneticisine uyarı düşer. Parola ve doğrulama iletileri sayılmaz.</p>
    <Alert tone="error">{hata}</Alert><Alert tone="success">{bilgi}</Alert>
    {form && <form className="form-grid" onSubmit={varsayilanKaydet}>
      {ALANLAR.map(([k, ad]) => <Field key={k} label={ad}><Input required type="number" min={1} max={10000000} value={form[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} /></Field>)}
      <div><Button type="submit" variant="primary" disabled={islem}>Kaydet</Button></div>
    </form>}

    <h3 style={{ marginTop: "1.5rem" }}>Firma istisnaları</h3>
    <form className="form-grid" onSubmit={istisnaKaydet}>
      <Field label="Firma ara"><Input value={arama} placeholder="Unvan ya da VKN" onChange={(e) => setArama(e.target.value)} /></Field>
      <Field label="Firma"><Select required value={firmaId} onChange={(e) => setFirmaId(e.target.value)}><option value="">Seçin</option>{adaylar.map((f) => <option key={f.tenantId} value={f.tenantId}>{f.unvan}</option>)}</Select></Field>
      {ALANLAR.map(([k, ad]) => <Field key={k} label={ad}><Input type="number" min={1} max={10000000} value={istisna[k]} placeholder={veri ? String(veri.varsayilan[k]) : ""} onChange={(e) => setIstisna({ ...istisna, [k]: e.target.value })} /></Field>)}
      <div><Button type="submit" variant="primary" disabled={islem || !firmaId}>İstisnayı kaydet</Button></div>
    </form>
    <p className="platform-field-help">Boş bırakılan alanda varsayılan tavan geçerlidir.</p>
    <TableWrap className="platform-responsive-table"><table className="table">
      <thead><tr><th>Firma</th>{ALANLAR.map(([k, ad]) => <th key={k}>{ad}</th>)}<th /></tr></thead>
      <tbody>
        {veri?.istisnalar.map((i) => <tr key={i.tenantId}>
          <td data-label="Firma">{i.firma}</td>
          {ALANLAR.map(([k, ad]) => <td key={k} data-label={ad}>{i[k] ?? <span className="muted">Varsayılan</span>}</td>)}
          <td data-label="İşlem"><div className="row-tight"><Button size="sm" disabled={islem} onClick={() => duzenle(i)}>Düzenle</Button><Button size="sm" disabled={islem} onClick={() => kaldir(i)}>Kaldır</Button></div></td>
        </tr>)}
        {veri && !veri.istisnalar.length && <tr><td colSpan={6} className="muted">İstisna yok.</td></tr>}
      </tbody>
    </table></TableWrap>
  </Card>;
}
