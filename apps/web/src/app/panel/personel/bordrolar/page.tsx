"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { Alert, Badge, Button, BulkActionsBar, Card, Field, Input, PageHeader, Para, Select, Stat, StatGrid, Table } from "@/components/ui";

type BordroDurum = "hesaplandi" | "onay_bekliyor" | "onaylandi" | "kismen_odendi" | "reddedildi" | "odendi" | "iptal";
interface Bordro {
  id: string;
  donemYil: number;
  donemAy: number;
  odenecekTutar: string;
  durum: BordroDurum;
  retNedeni?: string | null;
  personel: { id: string; personelNo: string; ad: string; soyad: string };
}

const BORDRO_DURUMU: Record<BordroDurum, [string, "info" | "warning" | "accent" | "success" | "danger" | "neutral"]> = {
  hesaplandi: ["Hesaplandı", "info"],
  onay_bekliyor: ["Onay bekliyor", "warning"],
  onaylandi: ["Onaylandı", "accent"],
  kismen_odendi: ["Kısmen ödendi", "info"],
  reddedildi: ["Reddedildi", "danger"],
  odendi: ["Ödendi", "success"],
  iptal: ["İptal", "neutral"],
};
const AY_ADLARI = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat("tr-TR", { month: "long" }).format(new Date(2026, i, 1)));

/** Dönem bordroları: kontrol, onaya gönderme, görev ayrılıklı onay ve toplu ödeme. */
export default function BordroCalismaAlani() {
  const simdi = new Date();
  const [donem, setDonem] = useState({ yil: simdi.getFullYear(), ay: simdi.getMonth() + 1 });
  const [bordrolar, setBordrolar] = useState<Bordro[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [islenen, setIslenen] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);
  /** PRS-16: seçili bordrolara toplu onaya gönder / onayla / öde. */
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [odemeFormu, setOdemeFormu] = useState<{ kaynak: string; tarih: string } | null>(null);
  const [hesaplar, setHesaplar] = useState<{ id: string; ad: string; tur: "kasa" | "banka" }[]>([]);

  const yukle = useCallback(async () => {
    try {
      setYukleniyor(true); setHata(null);
      setBordrolar(await api<Bordro[]>(`/personel/bordrolar?yil=${donem.yil}&ay=${donem.ay}`));
    } catch (e) { setHata(e instanceof Error ? e.message : "Bordrolar alınamadı"); }
    finally { setYukleniyor(false); }
  }, [donem.ay, donem.yil]);
  useEffect(() => { void yukle(); setSecili(new Set()); }, [yukle]);

  const toplu = async (islem: "onaya_gonder" | "onayla" | "ode", ek: Record<string, unknown> = {}) => {
    const adlar = { onaya_gonder: "onaya gönderilecek", onayla: "onaylanacak", ode: "kalan tutarı ödenecek" };
    if (!window.confirm(`${secili.size} bordro ${adlar[islem]}. Devam edilsin mi?`)) return;
    try {
      setIslenen("toplu"); setHata(null); setBilgi(null);
      const r = await api<{ islenen: number; atlananlar: { personel: string; mesaj: string }[] }>("/personel/bordrolar/toplu", { method: "POST", body: JSON.stringify({ islem, bordroIdler: [...secili], ...ek }) });
      setBilgi(`${r.islenen} bordro işlendi.${r.atlananlar.length ? ` İşlenmeyen: ${r.atlananlar.map((a) => `${a.personel} (${a.mesaj})`).join("; ")}` : ""}`);
      setSecili(new Set()); setOdemeFormu(null); await yukle();
    } catch (e) { setHata(e instanceof ApiHata ? e.message : "Toplu işlem yapılamadı"); }
    finally { setIslenen(null); }
  };
  const odemeAc = async () => {
    try {
      const [k, b] = await Promise.all([api<{ id: string; ad: string; aktif: boolean; dovizCinsi: string }[]>("/kasa-banka/kasalar"), api<{ id: string; ad: string; aktif: boolean; dovizCinsi: string }[]>("/kasa-banka/bankalar")]);
      setHesaplar([...k.filter((h) => h.aktif && h.dovizCinsi === "TRY").map((h) => ({ id: h.id, ad: h.ad, tur: "kasa" as const })), ...b.filter((h) => h.aktif && h.dovizCinsi === "TRY").map((h) => ({ id: h.id, ad: h.ad, tur: "banka" as const }))]);
      setOdemeFormu({ kaynak: "", tarih: new Date().toISOString().slice(0, 10) });
    } catch (e) { setHata(e instanceof Error ? e.message : "Hesaplar alınamadı"); }
  };

  const bankaDosyasi = async () => {
    try {
      setHata(null);
      const res = await api<{ dosyaAdi: string; dosyaIcerigi: string }>(`/personel/bordrolar/banka-dosyasi?yil=${donem.yil}&ay=${donem.ay}`);
      const url = URL.createObjectURL(new Blob([res.dosyaIcerigi], { type: "text/csv;charset=utf-8;" }));
      const link = document.createElement("a");
      link.href = url; link.setAttribute("download", res.dosyaAdi);
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
    } catch (err) { setHata(err instanceof Error ? err.message : "Banka maaş dosyası indirilemedi. Onaylanmış bordro bulunduğundan emin olun."); }
  };
  /** PRS-10: dönemin onaylı bordrolarının ücret hesap pusulaları personele e-postayla. */
  const pusulalariGonder = async () => {
    if (!window.confirm(`${donem.ay}/${donem.yil} onaylı bordrolarının pusulaları personelin kart e-postasına gönderilecek. Devam edilsin mi?`)) return;
    try {
      setHata(null); setBilgi(null);
      const res = await api<{ gonderilen: number; atlananlar: { personel: string; mesaj: string }[] }>("/personel/pusulalar/toplu-eposta", { method: "POST", body: JSON.stringify({ yil: donem.yil, ay: donem.ay }) });
      setBilgi(`${res.gonderilen} pusula gönderildi.${res.atlananlar.length ? ` Gönderilmeyen: ${res.atlananlar.map((a) => `${a.personel}: ${a.mesaj}`).join("; ")}` : ""}`);
    } catch (err) { setHata(err instanceof Error ? err.message : "Pusulalar gönderilemedi"); }
  };

  const ozet = useMemo(() => ({
    toplam: bordrolar.reduce((t, b) => t + Number(b.odenecekTutar), 0),
    bekleyen: bordrolar.filter((b) => b.durum === "onay_bekliyor").length,
    onayli: bordrolar.filter((b) => b.durum === "onaylandi").reduce((t, b) => t + Number(b.odenecekTutar), 0),
    odenen: bordrolar.filter((b) => b.durum === "odendi").reduce((t, b) => t + Number(b.odenecekTutar), 0),
  }), [bordrolar]);

  const gecis = async (bordro: Bordro, eylem: "onaya-gonder" | "onayla") => {
    try {
      setIslenen(bordro.id); setHata(null);
      await api(`/personel/bordrolar/${bordro.id}/${eylem}`, { method: "POST" });
      await yukle();
    } catch (e) { setHata(e instanceof ApiHata ? e.message : "Bordro işlemi tamamlanamadı"); }
    finally { setIslenen(null); }
  };

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel">← Personel listesine dön</Link>
      <PageHeader
        title="Bordro çalışma alanı"
        subtitle="Tahakkukları kontrol edin, onaya gönderin ve görev ayrılığıyla yönetin."
        actions={<>
          <Input aria-label="Yıl" type="number" min={2020} max={2100} value={donem.yil} onChange={(e) => setDonem({ ...donem, yil: Number(e.target.value) })} style={{ width: "6rem" }} />
          <Select aria-label="Ay" value={donem.ay} onChange={(e) => setDonem({ ...donem, ay: Number(e.target.value) })} style={{ width: "auto" }}>{AY_ADLARI.map((a, i) => <option key={a} value={i + 1}>{a}</option>)}</Select>
          <Link className="btn btn--ghost" href="/panel/personel/bordrolar/calisma-gunleri">Puantaj</Link>
          <Button onClick={() => void pusulalariGonder()}>Pusulaları e-postala</Button>
          <Button variant="primary" onClick={() => void bankaDosyasi()}>Banka maaş dosyası (CSV)</Button>
        </>}
      />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{bilgi}</Alert>
      <StatGrid>
        <Stat label="Dönem toplamı" value={<Para deger={ozet.toplam} />} />
        <Stat label="Onay bekleyen" value={ozet.bekleyen} tone={ozet.bekleyen ? "accent" : "default"} />
        <Stat label="Ödemeye hazır" value={<Para deger={ozet.onayli} />} />
        <Stat label="Ödenen" value={<Para deger={ozet.odenen} />} tone="success" />
      </StatGrid>
      <BulkActionsBar selectedCount={secili.size} onClear={() => { setSecili(new Set()); setOdemeFormu(null); }}>
        <Button size="sm" disabled={islenen === "toplu"} onClick={() => void toplu("onaya_gonder")}>Onaya gönder</Button>
        <Button size="sm" disabled={islenen === "toplu"} onClick={() => void toplu("onayla")}>Onayla</Button>
        <Button size="sm" variant="primary" disabled={islenen === "toplu"} onClick={() => void odemeAc()}>Öde</Button>
      </BulkActionsBar>
      {secili.size > 0 && odemeFormu && (
        <Card title="Seçili bordroların kalan tutarlarını öde">
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); const [tur, id] = odemeFormu.kaynak.split(":"); void toplu("ode", { [tur === "kasa" ? "kasaId" : "bankaHesapId"]: id, odemeTarihi: odemeFormu.tarih }); }}>
            <Field label="Ödeme hesabı"><Select required value={odemeFormu.kaynak} onChange={(e) => setOdemeFormu({ ...odemeFormu, kaynak: e.target.value })}><option value="">Seçin</option>{hesaplar.map((h) => <option key={h.id} value={`${h.tur}:${h.id}`}>{h.tur === "kasa" ? "Kasa" : "Banka"} · {h.ad}</option>)}</Select></Field>
            <Field label="Ödeme tarihi"><Input required type="date" value={odemeFormu.tarih} onChange={(e) => setOdemeFormu({ ...odemeFormu, tarih: e.target.value })} /></Field>
            <div className="row-tight"><Button type="submit" variant="primary" disabled={islenen === "toplu"}>Kalan tutarları öde</Button><Button type="button" onClick={() => setOdemeFormu(null)}>Vazgeç</Button></div>
          </form>
        </Card>
      )}
      <Card pad={false}>
        <Table>
          <thead>
            <tr>
              <th style={{ width: "2.5rem" }}><input type="checkbox" aria-label="Tümünü seç" checked={bordrolar.length > 0 && bordrolar.every((b) => secili.has(b.id))} onChange={(e) => setSecili(new Set(e.target.checked ? bordrolar.map((b) => b.id) : []))} /></th>
              <th>Personel</th><th>Dönem</th><th className="num">Ödenecek</th><th>Durum</th><th />
            </tr>
          </thead>
          <tbody>
            {bordrolar.map((b) => (
              <tr key={b.id}>
                <td><input type="checkbox" aria-label={`${b.personel.ad} ${b.personel.soyad} seç`} checked={secili.has(b.id)} onChange={(e) => { const y = new Set(secili); if (e.target.checked) y.add(b.id); else y.delete(b.id); setSecili(y); }} /></td>
                <td><Link href={`/panel/personel/${b.personel.id}`}><strong>{b.personel.ad} {b.personel.soyad}</strong></Link><div className="subtle mono">{b.personel.personelNo}</div></td>
                <td>{String(b.donemAy).padStart(2, "0")}/{b.donemYil}</td>
                <td className="num"><strong><Para deger={b.odenecekTutar} /></strong></td>
                <td><Badge variant={BORDRO_DURUMU[b.durum][1]}>{BORDRO_DURUMU[b.durum][0]}</Badge>{b.retNedeni && <div style={{ color: "var(--danger)", fontSize: "0.75rem", marginTop: "0.25rem", maxWidth: "14rem" }}>{b.retNedeni}</div>}</td>
                <td className="num">
                  <div className="row-tight" style={{ justifyContent: "flex-end" }}>
                    <Link className="btn btn--ghost btn--sm" href={`/panel/personel/bordrolar/${b.id}`}>İncele</Link>
                    {b.durum === "hesaplandi" && <Button size="sm" variant="primary" disabled={islenen === b.id} onClick={() => void gecis(b, "onaya-gonder")}>Onaya gönder</Button>}
                    {b.durum === "onay_bekliyor" && <Button size="sm" variant="primary" disabled={islenen === b.id} onClick={() => void gecis(b, "onayla")}>Onayla</Button>}
                  </div>
                </td>
              </tr>
            ))}
            {!bordrolar.length && <tr><td className="muted" colSpan={6}>{yukleniyor ? "Bordrolar yükleniyor…" : "Bu dönem için bordro yok. Personel listesinden aylık tahakkuk oluşturabilirsiniz."}</td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
