"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Para, Segmented, Select, Table, Tarih } from "@/components/ui";

type KaynakTur = "masraf" | "fatura_satiri";
type Yontem = "tutar" | "miktar";
interface Aday { id: string; tarih: string; etiket: string; tutarTl: string; faturaId?: string }
interface HedefFatura { id: string; no: string | null; tarih: string; cari: string; genelToplam: string; dovizCinsi: string }
interface Adaylar { acikBaslangic: string | null; masraflar: Aday[]; hizmetSatirlari: Aday[]; faturalar: HedefFatura[] }
interface OnizlemeSatiri { faturaNo: string | null; kod: string; ad: string; anaBirim: string; anaMiktar: string; matrahTl: string; pay: string; birimArtis: string }
interface Onizleme { kaynak: { etiket: string; tarih: string; tutar: string }; satirlar: OnizlemeSatiri[] }
interface Dagitim {
  id: string; kaynakTur: KaynakTur; tarih: string; tutar: string; yontem: Yontem; durum: "aktif" | "iptal"; aciklama: string | null; createdAt: string;
  masraf: { belgeNo: string | null; saticiUnvan: string | null; kategori: { ad: string } } | null;
  faturaSatir: { fatura: { no: string | null }; stok: { ad: string } } | null;
  paylar: { tutar: string; fatura: { id: string; no: string | null }; stok: { kod: string; ad: string } }[];
}

const miktar = (v: string) => Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 3 });
const kaynakEtiketi = (d: Dagitim) => d.masraf
  ? `Masraf ${d.masraf.belgeNo ?? d.masraf.saticiUnvan ?? d.masraf.kategori.ad}`
  : d.faturaSatir ? `${d.faturaSatir.fatura.no ?? "Alış faturası"} · ${d.faturaSatir.stok.ad}` : "—";

/** STK-40: nakliye, gümrük, sigorta gibi giderin alış faturalarının stok maliyetine dağıtılması. */
export default function MaliyetDagitimiSayfasi() {
  const [adaylar, setAdaylar] = useState<Adaylar | null>(null);
  const [liste, setListe] = useState<Dagitim[]>([]);
  const [kaynakTur, setKaynakTur] = useState<KaynakTur>("masraf");
  const [kaynakId, setKaynakId] = useState("");
  const [hedefler, setHedefler] = useState<string[]>([]);
  const [yontem, setYontem] = useState<Yontem>("tutar");
  const [aciklama, setAciklama] = useState("");
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);

  const yukle = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([api<Adaylar>("/stok/maliyet-dagitimi/adaylar"), api<Dagitim[]>("/stok/maliyet-dagitimi")]);
      setAdaylar(a); setListe(l);
    } catch (e) { setHata(e instanceof Error ? e.message : "Dağıtımlar yüklenemedi"); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  // Seçim değişince eski önizleme geçersizdir.
  useEffect(() => { setOnizleme(null); }, [kaynakTur, kaynakId, hedefler, yontem]);

  const kaynaklar = kaynakTur === "masraf" ? adaylar?.masraflar ?? [] : adaylar?.hizmetSatirlari ?? [];
  const govde = () => JSON.stringify({ kaynakTur, kaynakId, hedefFaturaIdler: hedefler, yontem, aciklama: aciklama.trim() || null });
  const hedefDegistir = (id: string, secili: boolean) => setHedefler((eski) => (secili ? [...eski, id] : eski.filter((x) => x !== id)));

  const onizle = async () => {
    try { setIsleniyor(true); setHata(null); setOnizleme(await api<Onizleme>("/stok/maliyet-dagitimi/onizle", { method: "POST", body: govde() })); }
    catch (e) { setHata(e instanceof Error ? e.message : "Önizleme alınamadı"); }
    finally { setIsleniyor(false); }
  };

  const kaydet = async () => {
    if (!onizleme) return;
    if (!window.confirm(`${onizleme.kaynak.etiket} (${Number(onizleme.kaynak.tutar).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL) ${onizleme.satirlar.length} satıra dağıtılacak; etkilenen kartların maliyeti yeniden hesaplanır. Devam edilsin mi?`)) return;
    try {
      setIsleniyor(true); setHata(null);
      const r = await api<{ kartlar: { kod: string; eskiOrtalama: string; yeniOrtalama: string }[] }>("/stok/maliyet-dagitimi", { method: "POST", body: govde() });
      setBilgi(`Dağıtım kaydedildi. ${r.kartlar.map((k) => `${k.kod}: ${Number(k.eskiOrtalama).toLocaleString("tr-TR")} → ${Number(k.yeniOrtalama).toLocaleString("tr-TR")} TL`).join(" · ") || "Ortalama maliyet değişmedi."}`);
      setKaynakId(""); setHedefler([]); setAciklama(""); setOnizleme(null);
      await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Dağıtım kaydedilemedi"); }
    finally { setIsleniyor(false); }
  };

  const geriAl = async (d: Dagitim) => {
    if (!window.confirm(`${kaynakEtiketi(d)} dağıtımı geri alınacak; ilgili kartların maliyeti yeniden hesaplanır. Devam edilsin mi?`)) return;
    try { setHata(null); await api(`/stok/maliyet-dagitimi/${d.id}/geri-al`, { method: "POST", body: "{}" }); setBilgi("Dağıtım geri alındı."); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "Geri alınamadı"); }
  };

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/stok">← Stok kartları</Link>
      <PageHeader
        title="Maliyet dağıtımı"
        subtitle="Nakliye, gümrük, sigorta gibi giderler seçilen alış faturalarının ürün satırlarına dağıtılır; pay alış maliyetine eklenir ve ortalama maliyet yeniden hesaplanır. Muhasebe aktarımında dağıtılan gider 153'e yazılır."
      />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{bilgi}</Alert>
      {adaylar?.acikBaslangic && <Alert tone="warning">Kapalı dönem nedeniyle yalnız {adaylar.acikBaslangic.split("-").reverse().join(".")} ve sonrasındaki gider ve faturalar listelenir.</Alert>}

      <Card title="Yeni dağıtım">
        <div className="stack">
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div style={{ minWidth: 220 }}>
              <Field label="Gider kaynağı">
                <Segmented<KaynakTur> ariaLabel="Gider kaynağı" value={kaynakTur} onChange={(v) => { setKaynakTur(v); setKaynakId(""); }} items={[{ deger: "masraf", baslik: "Masraf" }, { deger: "fatura_satiri", baslik: "Alış faturası hizmet satırı" }]} />
              </Field>
            </div>
            <div style={{ flex: 2, minWidth: 280 }}>
              <Field label="Gider">
                <Select value={kaynakId} onChange={(e) => setKaynakId(e.target.value)}>
                  <option value="">{kaynaklar.length ? "Seçin" : "Dağıtılmamış gider yok"}</option>
                  {kaynaklar.map((k) => <option key={k.id} value={k.id}>{k.tarih.slice(0, 10).split("-").reverse().join(".")} · {k.etiket} · {Number(k.tutarTl).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL</option>)}
                </Select>
              </Field>
            </div>
            <div style={{ minWidth: 200 }}>
              <Field label="Dağıtım ölçüsü">
                <Segmented<Yontem> ariaLabel="Dağıtım ölçüsü" value={yontem} onChange={setYontem} items={[{ deger: "tutar", baslik: "Tutara göre" }, { deger: "miktar", baslik: "Miktara göre" }]} />
              </Field>
            </div>
          </div>
          <Field label="Açıklama"><Input value={aciklama} maxLength={500} onChange={(e) => setAciklama(e.target.value)} placeholder="Örn. Eylül ithalatı gümrük ve navlun" /></Field>
        </div>
      </Card>

      <Card title={`Alış faturaları (${hedefler.length} seçili)`} pad={false}>
        <Table>
          <thead><tr><th /><th>Tarih</th><th>No</th><th>Tedarikçi</th><th className="num">Genel toplam</th></tr></thead>
          <tbody>
            {(adaylar?.faturalar ?? []).map((f) => (
              <tr key={f.id}>
                <td><input type="checkbox" aria-label={`${f.no ?? "Fatura"} seç`} checked={hedefler.includes(f.id)} onChange={(e) => hedefDegistir(f.id, e.target.checked)} /></td>
                <td><Tarih deger={f.tarih} /></td>
                <td className="mono">{f.no ?? "—"}</td>
                <td>{f.cari}</td>
                <td className="num"><Para deger={f.genelToplam} dovizCinsi={f.dovizCinsi} /></td>
              </tr>
            ))}
            {!adaylar?.faturalar.length && <tr><td colSpan={5} className="muted">Açık dönemde ürün satırlı kesin alış faturası yok.</td></tr>}
          </tbody>
        </Table>
      </Card>

      <div className="row">
        <Button disabled={isleniyor || !kaynakId || !hedefler.length} onClick={() => void onizle()}>Önizle</Button>
        <Button variant="primary" disabled={isleniyor || !onizleme} onClick={() => void kaydet()}>{isleniyor ? "Çalışıyor…" : "Dağıt"}</Button>
      </div>

      {onizleme && (
        <Card title={`Önizleme · ${onizleme.kaynak.etiket}`} pad={false}>
          <Table>
            <thead><tr><th>Fatura</th><th>Ürün</th><th className="num">Miktar</th><th className="num">Satır tutarı (TL)</th><th className="num">Pay</th><th className="num">Birim maliyete ek</th></tr></thead>
            <tbody>
              {onizleme.satirlar.map((s, i) => (
                <tr key={i}>
                  <td className="mono">{s.faturaNo ?? "—"}</td>
                  <td><strong>{s.kod}</strong> <span className="muted">{s.ad}</span></td>
                  <td className="num">{miktar(s.anaMiktar)} {s.anaBirim}</td>
                  <td className="num"><Para deger={s.matrahTl} /></td>
                  <td className="num"><strong><Para deger={s.pay} /></strong></td>
                  <td className="num"><Para deger={s.birimArtis} basamak={4} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card title="Dağıtımlar" pad={false}>
        <Table>
          <thead><tr><th>Tarih</th><th>Gider</th><th>Ölçü</th><th>Dağıtılan faturalar</th><th className="num">Tutar</th><th>Durum</th><th /></tr></thead>
          <tbody>
            {liste.map((d) => (
              <tr key={d.id} style={d.durum === "iptal" ? { opacity: 0.6 } : undefined}>
                <td><Tarih deger={d.tarih} /></td>
                <td>{kaynakEtiketi(d)}{d.aciklama && <><br /><small className="muted">{d.aciklama}</small></>}</td>
                <td>{d.yontem === "tutar" ? "Tutar" : "Miktar"}</td>
                <td>{[...new Set(d.paylar.map((p) => p.fatura.no ?? "—"))].join(", ")}<br /><small className="muted">{d.paylar.length} satır</small></td>
                <td className="num"><Para deger={d.tutar} /></td>
                <td><Badge variant={d.durum === "aktif" ? "success" : "neutral"}>{d.durum === "aktif" ? "Aktif" : "Geri alındı"}</Badge></td>
                <td>{d.durum === "aktif" && <Button size="sm" variant="danger" onClick={() => void geriAl(d)}>Geri al</Button>}</td>
              </tr>
            ))}
            {!liste.length && <tr><td colSpan={7} className="muted">Henüz maliyet dağıtımı yok.</td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
