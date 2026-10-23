"use client";

/**
 * DMR-05/07/12: yıl sonu amortismanı. Önizleme (kart başına tutar, KKEG,
 * birikmiş), kesinleştirme ve geri alma (yalnız yönetici), geçici vergi
 * dönemleri için bilgi raporu ve defter türü ayarı.
 */
import { useCallback, useEffect, useState } from "react";
import { bugunTR } from "@tekirextra/shared";
import { api, apiDosyaIndir, ApiHata, tokenAl } from "@/lib/api";
import { Alert, Badge, Button, ButtonLabel, Card, Field, Input, PageHeader, Para, Select, Stat, StatGrid, TableWrap, Tarih } from "@/components/ui";
import { SINIFLAR, type Sinif } from "../ortak";

interface Satir { demirbasId: string; kod: string; ad: string; sinif: Sinif; bedel: string; tutar: string; kkeg: string; birikmisOnce: string; birikmisSonra: string; netDeger: string }
interface Onizleme {
  yil: number; kesin: { id: string; kesinlesmeAt: string; toplam: string; toplamKkeg: string } | null; sonrakiKesinYil: number | null;
  satirlar: Satir[]; eksikler: Array<{ kod: string; ad: string; yillar: number[] }>; toplam: string; toplamKkeg: string;
}
interface Donem { id: string; yil: number; durum: "kesin" | "geri_alindi"; toplam: string; toplamKkeg: string; kesinlesmeAt: string; geriAlmaAt: string | null; geriAlmaGerekcesi: string | null; _count: { satirlar: number } }
interface AraDonem { yil: number; ceyrek: number; satirlar: Array<Satir & { donem: string; donemKkeg: string }>; toplam: string; toplamKkeg: string }

export default function AmortismanSayfasi() {
  const buYil = Number(bugunTR().slice(0, 4));
  const [yil, setYil] = useState(buYil);
  const [o, setO] = useState<Onizleme | null>(null);
  const [donemler, setDonemler] = useState<Donem[]>([]);
  const [defterTuru, setDefterTuru] = useState<"bilanco" | "isletme" | null>(null);
  const [ceyrek, setCeyrek] = useState<number>(Math.min(4, Math.ceil(Number(bugunTR().slice(5, 7)) / 3)));
  const [ara, setAra] = useState<AraDonem | null>(null);
  const [gerekce, setGerekce] = useState("");
  const [mesaj, setMesaj] = useState<{ tur: "success" | "error"; metin: string } | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);

  const yukle = useCallback(async () => {
    try {
      const [onizleme, d] = await Promise.all([api<Onizleme>(`/demirbas/amortisman/${yil}`), api<Donem[]>("/demirbas/amortisman/donemler")]);
      setO(onizleme); setDonemler(d); setAra(null);
    } catch (e) { setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Yüklenemedi" }); }
  }, [yil]);
  useEffect(() => { if (tokenAl()) void yukle(); }, [yukle]);
  useEffect(() => { if (tokenAl()) void api<{ defterTuru: "bilanco" | "isletme" }>("/ayarlar/demirbas").then((a) => setDefterTuru(a.defterTuru)).catch(() => undefined); }, []);

  async function calis(fn: () => Promise<unknown>, basari: string) {
    setIsleniyor(true); setMesaj(null);
    try { await fn(); setMesaj({ tur: "success", metin: basari }); setGerekce(""); await yukle(); }
    catch (e) { setMesaj({ tur: "error", metin: e instanceof ApiHata ? (e.durum === 403 ? "Bu işlem yalnız yönetici rolüne açıktır." : e.message) : "İşlem yapılamadı" }); }
    finally { setIsleniyor(false); }
  }
  async function defterKaydet(deger: "bilanco" | "isletme") {
    await calis(async () => { await api("/ayarlar/demirbas", { method: "PUT", body: JSON.stringify({ defterTuru: deger }) }); setDefterTuru(deger); }, "Defter türü kaydedildi.");
  }
  async function araDonemGetir() {
    try { setAra(await api<AraDonem>(`/demirbas/amortisman/ara-donem?yil=${yil}&ceyrek=${ceyrek}`)); }
    catch (e) { setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Rapor alınamadı" }); }
  }

  const yillar = Array.from({ length: 8 }, (_, i) => buYil - 6 + i).filter((y) => y <= buYil);
  const kesinlesebilir = o && !o.kesin && !o.sonrakiKesinYil && o.eksikler.length === 0 && o.satirlar.length > 0 && yil <= buYil;
  return (
    <div className="demirbas-page">
      <PageHeader
        title="Amortisman"
        subtitle="Yıl sonunda kart başına amortisman hesaplanır, önizlenir ve yönetici tarafından kesinleştirilir (31.12 tarihli; dönem kilidine uyar). Kesin yıl muhasebe aktarımına fiş olarak girer."
        actions={<ButtonLabel as="a" href="/panel/demirbas">← Demirbaşlar</ButtonLabel>}
      />
      {mesaj && <Alert tone={mesaj.tur}>{mesaj.metin}</Alert>}

      <div className="row-tight demirbas__suzgec">
        <Field label="Yıl"><Select value={yil} onChange={(e) => setYil(Number(e.target.value))}>{yillar.map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
        <Field label="Defter türü">
          <Select value={defterTuru ?? ""} disabled={!defterTuru || isleniyor} onChange={(e) => void defterKaydet(e.target.value as "bilanco" | "isletme")}>
            <option value="bilanco">Bilanço esası</option><option value="isletme">İşletme esası</option>
          </Select>
        </Field>
        <Button size="sm" onClick={() => void apiDosyaIndir(`/demirbas/rapor/excel?tur=amortisman&yil=${yil}`, `amortisman-${yil}.xlsx`).catch((e) => setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "İndirilemedi" }))}>Excel</Button>
      </div>

      {o && <>
        <StatGrid>
          <Stat label={`${yil} amortismanı`} value={<Para deger={o.toplam} />} hint={o.kesin ? "kesin" : "önizleme"} />
          <Stat label="KKEG (binek oto sınırı)" value={<Para deger={o.toplamKkeg} />} />
          <Stat label="Kart" value={String(o.satirlar.length)} />
          <Stat label="Durum" value={o.kesin ? <Badge variant="success">Kesinleşti</Badge> : <Badge variant="neutral">Kesinleşmedi</Badge>} hint={o.kesin ? <Tarih deger={o.kesin.kesinlesmeAt} saatli /> : undefined} />
        </StatGrid>

        {o.eksikler.length > 0 && (
          <Alert tone="error">
            Önceki yılları kesinleşmemiş kartlar var; önce o yılları kesinleştirin:
            <ul>{o.eksikler.slice(0, 20).map((e) => <li key={e.kod}>{e.kod} {e.ad}: {e.yillar.join(", ")}</li>)}</ul>
          </Alert>
        )}
        {!o.kesin && o.sonrakiKesinYil && <Alert tone="error">{o.sonrakiKesinYil} kesinleşmiş; önceki bir yıl sonradan kesinleştirilemez.</Alert>}

        <Card title={o.kesin ? `${yil} kesin amortismanı` : `${yil} önizlemesi`} actions={
          o.kesin
            ? <div className="row-tight"><Input placeholder="Geri alma gerekçesi" value={gerekce} onChange={(e) => setGerekce(e.target.value)} aria-label="Gerekçe" /><Button variant="danger" disabled={isleniyor || gerekce.trim().length < 3} onClick={() => void calis(() => api(`/demirbas/amortisman/${yil}/geri-al`, { method: "POST", body: JSON.stringify({ gerekce }) }), `${yil} amortismanı geri alındı.`)}>Geri al</Button></div>
            : <Button variant="primary" disabled={!kesinlesebilir || isleniyor} onClick={() => { if (confirm(`${yil} amortismanı ${o.satirlar.length} kart için kesinleştirilsin mi?`)) void calis(() => api(`/demirbas/amortisman/${yil}/kesinlestir`, { method: "POST" }), `${yil} amortismanı kesinleşti.`); }}>Kesinleştir</Button>
        }>
          <TableWrap>
            <table className="table">
              <thead><tr><th>Kod</th><th>Ad</th><th>Sınıf</th><th className="num">Bedel</th><th className="num">Önceki birikmiş</th><th className="num">Amortisman</th><th className="num">KKEG</th><th className="num">Birikmiş</th><th className="num">Net değer</th></tr></thead>
              <tbody>
                {o.satirlar.length === 0 && <tr><td colSpan={9} className="muted">{yil} için ayrılacak amortisman yok.</td></tr>}
                {o.satirlar.map((s) => (
                  <tr key={s.demirbasId}>
                    <td><a href={`/panel/demirbas/${s.demirbasId}`}>{s.kod}</a></td><td>{s.ad}</td><td>{SINIFLAR[s.sinif]}</td>
                    <td className="num"><Para deger={s.bedel} /></td><td className="num"><Para deger={s.birikmisOnce} /></td><td className="num"><strong><Para deger={s.tutar} /></strong></td>
                    <td className="num">{Number(s.kkeg) > 0 ? <Para deger={s.kkeg} /> : "—"}</td><td className="num"><Para deger={s.birikmisSonra} /></td><td className="num"><Para deger={s.netDeger} /></td>
                  </tr>
                ))}
              </tbody>
              {o.satirlar.length > 0 && <tfoot><tr><td colSpan={5}>Toplam</td><td className="num"><Para deger={o.toplam} /></td><td className="num"><Para deger={o.toplamKkeg} /></td><td colSpan={2} /></tr></tfoot>}
            </table>
          </TableWrap>
        </Card>
      </>}

      <Card title="Ara dönem (geçici vergi) bilgi raporu">
        <p className="muted">Yıllık tutarın geçen çeyrek oranı; kayıt oluşmaz (DMR-07).</p>
        <div className="row-tight">
          <Field label="Çeyrek"><Select value={ceyrek} onChange={(e) => setCeyrek(Number(e.target.value))}>{[1, 2, 3, 4].map((c) => <option key={c} value={c}>{c}. çeyrek ({c * 3} ay)</option>)}</Select></Field>
          <Button onClick={() => void araDonemGetir()}>Hesapla</Button>
        </div>
        {ara && (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Kod</th><th>Ad</th><th className="num">Yıllık</th><th className="num">{ara.ceyrek}. çeyreğe kadar</th><th className="num">KKEG</th></tr></thead>
              <tbody>{ara.satirlar.map((s) => <tr key={s.demirbasId}><td>{s.kod}</td><td>{s.ad}</td><td className="num"><Para deger={s.tutar} /></td><td className="num"><Para deger={s.donem} /></td><td className="num">{Number(s.donemKkeg) > 0 ? <Para deger={s.donemKkeg} /> : "—"}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={3}>Toplam</td><td className="num"><Para deger={ara.toplam} /></td><td className="num"><Para deger={ara.toplamKkeg} /></td></tr></tfoot>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card title="Çalıştırma geçmişi">
        {donemler.length === 0 ? <p className="muted">Henüz kesinleşmiş amortisman yok.</p> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Yıl</th><th>Durum</th><th className="num">Kart</th><th className="num">Tutar</th><th className="num">KKEG</th><th>Kesinleşme</th><th>Geri alma</th></tr></thead>
              <tbody>{donemler.map((d) => (
                <tr key={d.id}>
                  <td>{d.yil}</td><td>{d.durum === "kesin" ? <Badge variant="success">kesin</Badge> : <Badge variant="neutral">geri alındı</Badge>}</td>
                  <td className="num">{d._count.satirlar}</td><td className="num"><Para deger={d.toplam} /></td><td className="num"><Para deger={d.toplamKkeg} /></td>
                  <td><Tarih deger={d.kesinlesmeAt} saatli /></td><td>{d.geriAlmaAt ? <><Tarih deger={d.geriAlmaAt} saatli /> · {d.geriAlmaGerekcesi}</> : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
