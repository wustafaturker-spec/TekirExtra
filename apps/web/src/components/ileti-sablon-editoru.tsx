"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, Select } from "@/components/ui";

/** ILT-09: firma ve platform ekranının ortak şablon düzenleyicisi; hangi türlerin geldiğine sunucu karar verir. */
interface Sablon {
  tur: string; ad: string; kanal: "eposta" | "sms"; degiskenler: string[]; zorunlu: string[];
  varsayilan: { konu: string | null; metin: string }; ozel: { konu: string | null; metin: string } | null;
}
interface Onizleme { konu: string; metin: string; karakter: number; parca: number | null }
type Istek = <T>(yol: string, secenekler?: RequestInit) => Promise<T>;

export function IletiSablonEditoru({ baslik, istek, taban }: { baslik: string; istek: Istek; taban: string }) {
  const [liste, setListe] = useState<Sablon[] | null>(null);
  const [tur, setTur] = useState("");
  const [konu, setKonu] = useState(""); const [metin, setMetin] = useState("");
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null);
  const [hata, setHata] = useState(""); const [bilgi, setBilgi] = useState(""); const [islem, setIslem] = useState(false);

  const secili = liste?.find((s) => s.tur === tur) ?? null;
  const doldur = (s: Sablon | undefined) => { setKonu(s ? (s.ozel?.konu ?? s.varsayilan.konu ?? "") : ""); setMetin(s ? (s.ozel?.metin ?? s.varsayilan.metin) : ""); setOnizleme(null); };
  useEffect(() => {
    void istek<Sablon[]>(taban).then((l) => { setListe(l); setTur(l[0]?.tur ?? ""); doldur(l[0]); }).catch((e: unknown) => setHata(e instanceof Error ? e.message : "Şablonlar yüklenemedi."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taban]);

  const sec = (t: string) => { setTur(t); setHata(""); setBilgi(""); doldur(liste?.find((s) => s.tur === t)); };
  const govde = () => JSON.stringify({ konu: secili?.kanal === "eposta" ? konu : null, metin });
  async function calis(is: () => Promise<void>) {
    setIslem(true); setHata(""); setBilgi("");
    try { await is(); } catch (e) { setHata(e instanceof Error ? e.message : "İşlem başarısız."); } finally { setIslem(false); }
  }
  const onizle = () => void calis(async () => { setOnizleme(await istek<Onizleme>(`${taban}/${tur}/onizle`, { method: "POST", body: govde() })); });
  const uygula = (l: Sablon[], mesaj: string) => { setListe(l); doldur(l.find((s) => s.tur === tur)); setBilgi(mesaj); };
  const kaydet = () => void calis(async () => uygula(await istek<Sablon[]>(`${taban}/${tur}`, { method: "PUT", body: govde() }), "Şablon kaydedildi."));
  const sifirla = () => void calis(async () => uygula(await istek<Sablon[]>(`${taban}/${tur}`, { method: "DELETE" }), "Varsayılan metne dönüldü."));

  return <Card title={baslik}>
    <Alert tone="error">{hata}</Alert><Alert tone="success">{bilgi}</Alert>
    {!liste ? <p className="muted" role="status">Yükleniyor…</p> : <div style={{ display: "grid", gap: "1rem" }}>
      <Field label="İleti"><Select value={tur} onChange={(e) => sec(e.target.value)}>{liste.map((s) => <option key={s.tur} value={s.tur}>{s.ad}{s.ozel ? " (düzenlendi)" : ""}</option>)}</Select></Field>
      {secili && <>
        {secili.kanal === "sms" && <Alert tone="warning">SMS şablonu tanıtım, kampanya veya reklam içeremez. Bu ileti türü yalnız bilgilendirme ve borç hatırlatması içindir.</Alert>}
        {secili.kanal === "eposta" && <Field label="Konu"><Input value={konu} maxLength={200} onChange={(e) => { setKonu(e.target.value); setOnizleme(null); }} /></Field>}
        <Field label="Metin"><textarea className="textarea" rows={secili.kanal === "sms" ? 4 : 10} value={metin} onChange={(e) => { setMetin(e.target.value); setOnizleme(null); }} /></Field>
        <p className="muted" style={{ overflowWrap: "anywhere" }}>Kullanılabilir değişkenler: {secili.degiskenler.map((d) => <code key={d} style={{ marginRight: "0.5rem" }}>{`{{${d}}}`}{secili.zorunlu.includes(d) ? " (zorunlu)" : ""}</code>)}</p>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          <Button disabled={islem} onClick={onizle}>Önizle</Button>
          <Button variant="primary" disabled={islem} onClick={kaydet}>Kaydet</Button>
          {secili.ozel && <Button disabled={islem} onClick={sifirla}>Varsayılana dön</Button>}
          {secili.ozel && <Badge variant="info">Düzenlendi</Badge>}
        </div>
        {secili.ozel && secili.kanal === "eposta" && <p className="muted">Düzenlenmiş şablon düz metin olarak gönderilir.</p>}
        {onizleme && <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1rem" }}>
          <p className="muted">Örnek değerlerle önizleme{onizleme.parca !== null ? ` · ${onizleme.karakter} karakter · yaklaşık ${onizleme.parca} SMS` : ""}</p>
          {onizleme.konu && <p><strong>{onizleme.konu}</strong></p>}
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{onizleme.metin}</p>
        </div>}
      </>}
    </div>}
  </Card>;
}
