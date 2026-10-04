"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Stat, StatGrid } from "@/components/ui";

type SetK = { id: string; ad: string; surum: number; durum: string };
type Senaryo = { id: string; ad: string; tolerans: number | string; basarili: boolean | null; sonCalismaTarihi: string | null; mevzuatSeti: { ad: string; surum: number } };

const ilk = { mevzuatSetiId: "", ad: "", brutUcret: "", ucretDisiOdeme: "0", devredenSgkMatrahi: "0", devrinKalanAyi: "2", primGunu: "30", primeEsasKazanc: "", sahisSigortaPrimi: "0", hayatSigortaPrimi: "0", sendikaAidati: "0", oncekiKumulatifMatrah: "0", oncekiAsgariKumulatifMatrah: "0", netUcret: "", sgkIsci: "", issizlikIsci: "", gelirVergisi: "", damgaVergisi: "", beklenenPrimeEsasKazanc: "", beklenenSgkDevredenUygulanan: "", beklenenSgkCariAyDevreden: "", beklenenSahisSigortaPrimi: "", beklenenHayatSigortaPrimi: "", beklenenSendikaAidati: "", tolerans: "0.01" };
type Form = typeof ilk;

const GIRDILER = [["Brüt ücret", "brutUcret"], ["Prim günü", "primGunu"], ["Prime esas kazanç (isteğe bağlı)", "primeEsasKazanc"], ["Önceki kümülatif matrah", "oncekiKumulatifMatrah"], ["Önceki asgari matrah", "oncekiAsgariKumulatifMatrah"]] as const;
const BEKLENEN = [["Net ücret", "netUcret"], ["SGK işçi", "sgkIsci"], ["İşsizlik işçi", "issizlikIsci"], ["Gelir vergisi", "gelirVergisi"], ["Damga vergisi", "damgaVergisi"]] as const;

/** Uzman onaylı referans bordrolar; taslak mevzuat seti en az bir başarılı senaryoyla etkinleşir. */
export default function KabulSayfasi() {
  const [setler, setSetler] = useState<SetK[]>([]);
  const [kayitlar, setKayitlar] = useState<Senaryo[]>([]);
  const [form, setForm] = useState(ilk);
  const [hata, setHata] = useState("");
  const [bildirim, setBildirim] = useState("");
  const [islem, setIslem] = useState("");
  const taslaklar = useMemo(() => setler.filter((x) => x.durum === "taslak"), [setler]);

  const yukle = useCallback(async () => {
    try {
      const [s, k] = await Promise.all([api<SetK[]>("/personel/mevzuat"), api<Senaryo[]>("/personel/mevzuat/kabul-senaryolari")]);
      setSetler(s); setKayitlar(k);
      setForm((f) => ({ ...f, mevzuatSetiId: f.mevzuatSetiId || s.find((x) => x.durum === "taslak")?.id || "" }));
    } catch (e) { setHata(e instanceof Error ? e.message : "Veriler alınamadı"); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault(); setHata(""); setBildirim(""); setIslem("yeni");
    try {
      const istege = (alan: keyof Form, ad: string) => (form[alan] !== "" ? { [ad]: +form[alan] } : {});
      await api("/personel/mevzuat/kabul-senaryolari", {
        method: "POST",
        body: JSON.stringify({
          mevzuatSetiId: form.mevzuatSetiId, ad: form.ad,
          girdiler: {
            brutUcret: +form.brutUcret, ucretDisiOdeme: +form.ucretDisiOdeme,
            sgkMatrahDevirleri: +form.devredenSgkMatrahi > 0 ? [{ tutar: +form.devredenSgkMatrahi, kalanAy: +form.devrinKalanAyi }] : [],
            primGunu: +form.primGunu, ...(form.primeEsasKazanc ? { primeEsasKazanc: +form.primeEsasKazanc } : {}),
            sahisSigortaPrimi: +form.sahisSigortaPrimi, hayatSigortaPrimi: +form.hayatSigortaPrimi, sendikaAidati: +form.sendikaAidati,
            oncekiKumulatifMatrah: +form.oncekiKumulatifMatrah, oncekiAsgariKumulatifMatrah: +form.oncekiAsgariKumulatifMatrah,
          },
          beklenen: {
            netUcret: +form.netUcret, sgkIsci: +form.sgkIsci, issizlikIsci: +form.issizlikIsci, gelirVergisi: +form.gelirVergisi, damgaVergisi: +form.damgaVergisi,
            ...istege("beklenenPrimeEsasKazanc", "primeEsasKazanc"), ...istege("beklenenSgkDevredenUygulanan", "sgkDevredenUygulanan"), ...istege("beklenenSgkCariAyDevreden", "sgkCariAyDevreden"),
            ...istege("beklenenSahisSigortaPrimi", "sahisSigortaPrimi"), ...istege("beklenenHayatSigortaPrimi", "hayatSigortaPrimi"), ...istege("beklenenSendikaAidati", "sendikaAidati"),
          },
          tolerans: +form.tolerans,
        }),
      });
      setForm((f) => ({ ...ilk, mevzuatSetiId: f.mevzuatSetiId }));
      setBildirim("Senaryo kaydedildi. Etkinleştirmeden önce testi çalıştırın.");
      await yukle();
    } catch (err) { setHata(err instanceof Error ? err.message : "Senaryo kaydedilemedi"); }
    finally { setIslem(""); }
  }

  async function calistir(id: string) {
    setHata(""); setBildirim(""); setIslem(id);
    try {
      const r = await api<{ basarili: boolean }>(`/personel/mevzuat/kabul-senaryolari/${id}/calistir`, { method: "POST" });
      setBildirim(r.basarili ? "Senaryo başarıyla geçti." : "Senaryo başarısız; beklenen değerleri kontrol edin.");
      await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Test çalıştırılamadı"); }
    finally { setIslem(""); }
  }

  const sayiAlani = (ad: string, alan: keyof Form, zorunlu = true) => (
    <Field key={alan} label={ad}><Input required={zorunlu} type="number" min="0" step={alan === "primGunu" ? "1" : "0.01"} value={form[alan]} onChange={(e) => setForm({ ...form, [alan]: e.target.value })} /></Field>
  );

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel/mevzuat">← Mevzuat setlerine dön</Link>
      <PageHeader title="Bordro kabul senaryoları" subtitle="Uzman onaylı referans bordroları kaydedin. En az bir başarılı senaryo olmadan mevzuat seti etkinleştirilemez." />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{bildirim}</Alert>
      <div className="split split--even">
        <Card title="Yeni doğrulama örneği">
          <form className="stack" onSubmit={kaydet}>
            <Field label="Taslak mevzuat seti">
              <Select required value={form.mevzuatSetiId} onChange={(e) => setForm({ ...form, mevzuatSetiId: e.target.value })}>
                <option value="">Set seçin</option>
                {taslaklar.map((x) => <option key={x.id} value={x.id}>v{x.surum} · {x.ad}</option>)}
              </Select>
            </Field>
            <Field label="Senaryo adı"><Input required minLength={3} value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} /></Field>
            <fieldset className="form-section"><legend>Hesaplama girdileri</legend><div className="form-grid form-grid--2">{GIRDILER.map(([a, k]) => sayiAlani(a, k, k !== "primeEsasKazanc"))}</div></fieldset>
            <fieldset className="form-section"><legend>Uzman onaylı beklenen sonuç</legend><div className="form-grid form-grid--2">{BEKLENEN.map(([a, k]) => sayiAlani(a, k))}</div></fieldset>
            {sayiAlani("Kabul toleransı (₺)", "tolerans")}
            <Button block type="submit" variant="primary" disabled={islem === "yeni" || !taslaklar.length}>Senaryoyu kaydet</Button>
            {!taslaklar.length && <p className="muted" style={{ margin: 0 }}>Senaryo eklemek için önce taslak bir mevzuat seti oluşturun.</p>}
          </form>
        </Card>
        <div className="stack">
          <StatGrid>
            <Stat label="Toplam" value={kayitlar.length} />
            <Stat label="Başarılı" value={kayitlar.filter((x) => x.basarili === true).length} tone="success" />
            <Stat label="İncelenecek" value={kayitlar.filter((x) => x.basarili === false).length} tone="danger" />
          </StatGrid>
          {!kayitlar.length && <Card><p className="muted" style={{ margin: 0 }}>Henüz kabul senaryosu yok.</p></Card>}
          {kayitlar.map((x) => (
            <Card key={x.id} title={<><small className="muted">v{x.mevzuatSeti.surum} · {x.mevzuatSeti.ad}</small><div>{x.ad}</div></>} actions={<Badge variant={x.basarili === true ? "success" : x.basarili === false ? "danger" : "neutral"}>{x.basarili === true ? "Başarılı" : x.basarili === false ? "Başarısız" : "Bekliyor"}</Badge>}>
              <div className="between">
                <small className="muted">Tolerans ±{Number(x.tolerans).toLocaleString("tr-TR")} ₺ · {x.sonCalismaTarihi ? new Date(x.sonCalismaTarihi).toLocaleString("tr-TR") : "Henüz çalıştırılmadı"}</small>
                <Button size="sm" variant="primary" disabled={islem === x.id} onClick={() => void calistir(x.id)}>{islem === x.id ? "Çalışıyor…" : "Testi çalıştır"}</Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
