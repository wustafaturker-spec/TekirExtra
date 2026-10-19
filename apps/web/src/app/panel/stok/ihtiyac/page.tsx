"use client";

import { useEffect, useRef, useState } from "react";
import { ihtiyacTalepYolu } from "@/lib/ihtiyac-talep";
import { api } from "@/lib/api";
import { Alert, Button, Card, Field, Input, PageHeader, Select, ButtonLabel } from "@/components/ui";

type Kart = { id: string; kod: string; ad: string; tip: string; anaBirim: string; birimler?: { ad: string }[] };
type Depo = { id: string; kod: string; ad: string };
type Sonuc = { alindigiZaman: string; stok: { anaBirim: string }; hesap: Record<string, string>; uyarilar: string[] };
const miktarYaz = (v: string) => {
  const [tam, kesir = ""] = v.split(".");
  return `${tam.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${kesir.padEnd(3, "0")}`;
};
const bugun = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });

export default function IhtiyacSayfasi() {
  const [arama, setArama] = useState("");
  const [kartlar, setKartlar] = useState<Kart[]>([]);
  const [kart, setKart] = useState<Kart | null>(null);
  const [depolar, setDepolar] = useState<Depo[]>([]);
  const [depoId, setDepoId] = useState("");
  const [miktar, setMiktar] = useState("");
  const [birim, setBirim] = useState("");
  const [tarih, setTarih] = useState(bugun);
  const [sonuc, setSonuc] = useState<Sonuc | null>(null);
  const [hata, setHata] = useState("");
  const [bekliyor, setBekliyor] = useState(false);
  const [yetkili, setYetkili] = useState(false);
  const surum = useRef(0);
  const secim = useRef(0);
  function degisti() { surum.current++; setSonuc(null); setHata(""); }
  useEffect(() => {
    api<{ rol: string }>("/auth/ben").then(async b => {
      if (!["yonetici", "muhasebe", "depo"].includes(b.rol)) throw new Error("Bu ekran için yetkiniz yok.");
      setYetkili(true);
      setDepolar(await api<Depo[]>("/depo?yalnizAktif=true"));
    }).catch(e => setHata(e.message));
  }, []);
  useEffect(() => {
    if (!yetkili) return;
    let aktif = true;
    const timer = setTimeout(() => {
      api<{ kayitlar: Kart[] }>(`/stok?arama=${encodeURIComponent(arama)}&adet=50`).then(v => {
        if (aktif) setKartlar(v.kayitlar.filter(k => k.tip !== "hizmet"));
      }).catch(e => { if (aktif) setHata(e.message); });
    }, 300);
    return () => { aktif = false; clearTimeout(timer); };
  }, [arama, yetkili]);
  async function kartSec(id: string) {
    degisti(); setKart(null); setBirim(""); const s = ++secim.current;
    if (!id) return;
    try { const k = await api<Kart>(`/stok/${id}`); if (s === secim.current) { setKart(k); setBirim(k.anaBirim); } }
    catch (e) { if (s === secim.current) setHata(e instanceof Error ? e.message : "Ürün yüklenemedi"); }
  }
  async function hesapla(e: React.FormEvent) {
    e.preventDefault(); if (!kart || bekliyor) return;
    const s = surum.current; setBekliyor(true); setSonuc(null); setHata("");
    try {
      const sorgu = new URLSearchParams({ stokId: kart.id, depoId, miktar: miktar.replace(",", "."), birim, ihtiyacTarihi: tarih });
      const v = await api<Sonuc>(`/stok/ihtiyac-plani/onizle?${sorgu}`, { cache: "no-store" });
      if (s === surum.current) setSonuc(v);
    } catch (e) { if (s === surum.current) setHata(e instanceof Error ? e.message : "Hesaplanamadı"); }
    finally { setBekliyor(false); }
  }
  return <div>
    <PageHeader title="Stok ihtiyaç önizlemesi" subtitle="Yeni bir ihtiyacın seçili depodaki stokla karşılanma durumunu görün." />
    <Alert tone="error">{hata}</Alert>
    <Card>
      <p>Henüz rezerv edilmemiş yeni bir ihtiyaç girin. Hesaplama stok veya satın alma kaydı oluşturmaz.</p>
      <form onSubmit={hesapla} style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <Field label="Ürün ara"><Input value={arama} onChange={e => setArama(e.target.value)} placeholder="Ürün adı veya kodu" disabled={!yetkili} /></Field>
        <Field label="Ürün"><Select required value={kart?.id ?? ""} disabled={!yetkili} onChange={e => void kartSec(e.target.value)}><option value="">Ürün seçin</option>{kart && !kartlar.some(k => k.id === kart.id) && <option value={kart.id}>{kart.kod} · {kart.ad}</option>}{kartlar.map(k => <option key={k.id} value={k.id}>{k.kod} · {k.ad}</option>)}</Select></Field>
        <Field label="Depo"><Select required value={depoId} onChange={e => { degisti(); setDepoId(e.target.value); }}><option value="">Depo seçin</option>{depolar.map(d => <option key={d.id} value={d.id}>{d.kod} · {d.ad}</option>)}</Select></Field>
        <Field label="İhtiyaç miktarı"><Input required inputMode="decimal" value={miktar} onChange={e => { degisti(); setMiktar(e.target.value); }} placeholder="Örn. 8" /></Field>
        <Field label="Birim"><Select required value={birim} onChange={e => { degisti(); setBirim(e.target.value); }}><option value="">Birim seçin</option>{Array.from(new Set(kart ? [kart.anaBirim, ...(kart.birimler ?? []).map(b => b.ad)] : [])).map(b => <option key={b}>{b}</option>)}</Select></Field>
        <Field label="İhtiyaç günü"><Input required type="date" min={bugun()} value={tarih} onChange={e => { degisti(); setTarih(e.target.value); }} /></Field>
        <div><Button variant="primary" type="submit" disabled={!yetkili || !kart || bekliyor}>{bekliyor ? "Hesaplanıyor…" : "İhtiyacı hesapla"}</Button></div>
      </form>
    </Card>
    {sonuc && <div aria-live="polite" style={{ marginTop: 20 }}>
      <Alert tone={sonuc.hesap.durum === "stok_yeterli" ? "success" : "warning"}>{sonuc.hesap.durum === "stok_yeterli" ? "Mevcut stok bu ihtiyacı karşılıyor." : "Bu ihtiyaç için tedarik gerekiyor."}</Alert>
      <Card><dl style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>{[["mevcut", "Mevcut stok"], ["rezerve", "Rezerve"], ["kullanilabilir", "Kullanılabilir"], ["talep", "İhtiyaç"], ["yoldaki", "Yoldaki (hesaba katılmadı)"], ["eksik", "Tedarik edilmesi gereken"]].map(([key, label]) => <div key={key}><dt>{label}</dt><dd style={{ margin: "8px 0", fontSize: 22, fontWeight: 600 }}>{miktarYaz(sonuc.hesap[key])} {sonuc.stok.anaBirim}</dd></div>)}</dl>
        {sonuc.hesap.durum === "tedarik_gerekli" && kart && <div style={{ margin: "16px 0" }}><ButtonLabel as="a" href={ihtiyacTalepYolu({ stokId: kart.id, depoId, miktar: miktar.replace(",", "."), birim, ihtiyacTarihi: tarih })}>Eksik miktarla satın alma talebi hazırla</ButtonLabel><p>Talep formunda stok yeniden kontrol edilir. Kaydetme ve onaya gönderme adımları satın alma ekranında tamamlanır.</p></div>}
        <p>Stok görünümü: {new Date(sonuc.alindigiZaman).toLocaleString("tr-TR")}</p>
        {sonuc.uyarilar.map(u => <p key={u}>{u}</p>)}
      </Card>
    </div>}
  </div>;
}
