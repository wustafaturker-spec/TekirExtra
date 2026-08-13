"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, ButtonLabel, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { api, tokenAl } from "@/lib/api";

interface Kategori {
  id: string; ad: string; ustId: string | null;
  varsayilanKdvOrani: string | null; muhasebeKodu: string | null;
  ust: { id: string; ad: string } | null;
  _count: { altlar: number; masraflar: number };
}

export default function MasrafKategorileriSayfasi() {
  const [kategoriler, setKategoriler] = useState<Kategori[]>([]);
  const [ad, setAd] = useState(""); const [ustId, setUstId] = useState(""); const [kdv, setKdv] = useState(""); const [muhasebeKodu, setMuhasebeKodu] = useState("");
  const [ustSecimleri, setUstSecimleri] = useState<Record<string, string>>({});
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState(""); const [kaydediliyor, setKaydediliyor] = useState(false);
  const yukle = useCallback(async () => setKategoriler(await api<Kategori[]>("/masraflar/kategoriler")), []);
  useEffect(() => { if (tokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Kategoriler yüklenemedi")); }, [yukle]);

  async function ekle(e: React.FormEvent) {
    e.preventDefault(); setHata(""); setKaydediliyor(true);
    try { await api("/masraflar/kategoriler", { method: "POST", body: JSON.stringify({ ad, ustId: ustId || null, varsayilanKdvOrani: kdv === "" ? null : kdv, muhasebeKodu: muhasebeKodu || null }) }); setAd(""); setUstId(""); setKdv(""); setMuhasebeKodu(""); setBasari("Kategori oluşturuldu."); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "Kategori oluşturulamadı"); }
    finally { setKaydediliyor(false); }
  }

  async function tasi(kategori: Kategori) {
    setHata("");
    try { await api(`/masraflar/kategoriler/${kategori.id}`, { method: "PATCH", body: JSON.stringify({ ustId: ustSecimleri[kategori.id] ?? kategori.ustId ?? null }) }); setBasari("Kategori grubu güncellendi."); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "Kategori taşınamadı"); }
  }

  return <>
    <PageHeader title="Masraf Kategorileri" subtitle="Ana gider gruplarını ve bunlara bağlı alt kategorileri yönetin." actions={<ButtonLabel as="a" href="/panel/masraflar">Masraflara dön</ButtonLabel>} />
    {hata && <Alert tone="error">{hata}</Alert>}{basari && <Alert tone="success">{basari}</Alert>}
    <Card title="Yeni kategori"><form onSubmit={ekle}><div className="form-grid">
      <Field label="Kategori adı"><Input required minLength={2} value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Örn. Yakıt" /></Field>
      <Field label="Üst grup"><Select value={ustId} onChange={(e) => setUstId(e.target.value)}><option value="">Ana grup olarak oluştur</option>{kategoriler.filter((k) => !k.ustId).map((k) => <option key={k.id} value={k.id}>{k.ad}</option>)}</Select></Field>
      <Field label="Varsayılan KDV"><Input type="number" min="0" max="100" step="0.01" value={kdv} onChange={(e) => setKdv(e.target.value)} placeholder="İsteğe bağlı" /></Field>
      <Field label="Muhasebe kodu"><Input value={muhasebeKodu} onChange={(e) => setMuhasebeKodu(e.target.value)} placeholder="İsteğe bağlı" /></Field>
    </div><div className="row" style={{ marginTop: "1rem" }}><Button variant="primary" disabled={kaydediliyor} type="submit">{kaydediliyor ? "Kaydediliyor…" : "Kategori oluştur"}</Button></div></form></Card>
    <Card title="Kategori yapısı" pad={false} style={{ marginTop: "1rem" }}><TableWrap><table><thead><tr><th>Kategori</th><th>Üst grup</th><th>Varsayılan KDV</th><th>Kullanım</th><th></th></tr></thead><tbody>{kategoriler.map((k) => <tr key={k.id}><td>{k.ust ? `↳ ${k.ad}` : <strong>{k.ad}</strong>}</td><td><Select disabled={k._count.altlar > 0} value={ustSecimleri[k.id] ?? k.ustId ?? ""} onChange={(e) => setUstSecimleri((x) => ({ ...x, [k.id]: e.target.value }))}><option value="">Ana grup</option>{kategoriler.filter((u) => !u.ustId && u.id !== k.id).map((u) => <option key={u.id} value={u.id}>{u.ad}</option>)}</Select></td><td>{k.varsayilanKdvOrani == null ? "—" : `%${k.varsayilanKdvOrani}`}</td><td>{k._count.masraflar} masraf{k._count.altlar ? ` · ${k._count.altlar} alt kategori` : ""}</td><td><Button size="sm" disabled={k._count.altlar > 0 || (ustSecimleri[k.id] ?? k.ustId ?? "") === (k.ustId ?? "")} onClick={() => void tasi(k)}>Kaydet</Button></td></tr>)}</tbody></table></TableWrap></Card>
  </>;
}
