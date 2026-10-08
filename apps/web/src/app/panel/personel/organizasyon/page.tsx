"use client";

import { CSGB_IS_KOLLARI } from "@tekirextra/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select } from "@/components/ui";

interface Pozisyon { id: string; kod: string; ad: string; departmanId?: string | null }
interface Departman { id: string; kod: string; ad: string; isyeriId: string; ustDepartmanId?: string | null; pozisyonlar: Pozisyon[]; _count: { personeller: number } }
interface Isyeri { id: string; kod: string; ad: string; adres?: string | null; sgkSicilNo?: string | null; csgbIsKolu?: number | null; departmanlar: Departman[]; _count: { personeller: number } }
interface Personel { id: string; personelNo: string; ad: string; soyad: string; departmanId?: string | null; pozisyonId?: string | null; isyeriId?: string | null; yoneticiId?: string | null; durum: string }
type BirimTuru = "isyeri" | "departman" | "pozisyon";
type Duzen = { tur: BirimTuru; id: string; kod: string; ad: string; adres: string; sgkSicilNo: string; csgbIsKolu: string; ustDepartmanId: string; departmanId: string; isyeriId: string };

const TUR_ADI: Record<BirimTuru, string> = { isyeri: "İşyeri", departman: "Departman", pozisyon: "Pozisyon" };
const YOL: Record<BirimTuru, string> = { isyeri: "isyerleri", departman: "departmanlar", pozisyon: "pozisyonlar" };

/** İşyerleri, departmanlar, pozisyonlar ve raporlama ilişkileri. */
export default function OrganizasyonSayfasi() {
  const [isyerleri, setIsyerleri] = useState<Isyeri[]>([]);
  const [personeller, setPersoneller] = useState<Personel[]>([]);
  const [hata, setHata] = useState<string | null>(null);
  const [bekle, setBekle] = useState(false);
  const [ata, setAta] = useState({ personelId: "", isyeriId: "", departmanId: "", pozisyonId: "", yoneticiId: "" });
  /** PRS-13: birim düzenleme / pasife alma (kod değişmez). */
  const [duzen, setDuzen] = useState<Duzen | null>(null);
  const [yeni, setYeni] = useState({ tur: "departman", kod: "", ad: "", isyeriId: "", departmanId: "", ustDepartmanId: "", adres: "" });

  const yukle = useCallback(async () => {
    try {
      setHata(null);
      const [i, p] = await Promise.all([api<Isyeri[]>("/personel/organizasyon"), api<Personel[]>("/personel")]);
      setIsyerleri(i); setPersoneller(p);
      setAta((a) => ({ ...a, isyeriId: a.isyeriId || i[0]?.id || "" }));
      setYeni((y) => ({ ...y, isyeriId: y.isyeriId || i[0]?.id || "" }));
    } catch (e) { setHata(e instanceof Error ? e.message : "Organizasyon alınamadı"); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  const departmanlar = useMemo(() => isyerleri.find((i) => i.id === ata.isyeriId)?.departmanlar ?? [], [ata.isyeriId, isyerleri]);
  const pozisyonlar = useMemo(() => departmanlar.find((d) => d.id === ata.departmanId)?.pozisyonlar ?? [], [ata.departmanId, departmanlar]);
  const isyeriDepartmanlari = (isyeriId: string) => isyerleri.find((x) => x.id === isyeriId)?.departmanlar ?? [];

  const kaydet = async (fn: () => Promise<unknown>) => {
    try { setBekle(true); setHata(null); await fn(); await yukle(); return true; }
    catch (e) { setHata(e instanceof ApiHata ? e.message : "İşlem tamamlanamadı"); return false; }
    finally { setBekle(false); }
  };
  const ataKaydet = async (e: React.FormEvent) => {
    e.preventDefault();
    await kaydet(() => api(`/personel/organizasyon/personeller/${ata.personelId}`, { method: "PUT", body: JSON.stringify({ isyeriId: ata.isyeriId, departmanId: ata.departmanId || null, pozisyonId: ata.pozisyonId || null, yoneticiId: ata.yoneticiId || null }) }));
  };
  const duzenYol = (d: Duzen) => `/personel/organizasyon/${YOL[d.tur]}/${d.id}`;
  const duzenKaydet = async (e: React.FormEvent) => {
    e.preventDefault(); if (!duzen) return;
    const govde = duzen.tur === "isyeri" ? { ad: duzen.ad, adres: duzen.adres || null, sgkSicilNo: duzen.sgkSicilNo || null, csgbIsKolu: duzen.csgbIsKolu ? Number(duzen.csgbIsKolu) : null } : duzen.tur === "departman" ? { ad: duzen.ad, ustDepartmanId: duzen.ustDepartmanId || null } : { ad: duzen.ad, departmanId: duzen.departmanId || null };
    if (await kaydet(() => api(duzenYol(duzen), { method: "PATCH", body: JSON.stringify(govde) }))) setDuzen(null);
  };
  const pasifeAl = async () => {
    if (!duzen || !window.confirm(`${duzen.ad} pasife alınacak; organizasyon ağacında ve seçimlerde görünmez. Devam edilsin mi?`)) return;
    if (await kaydet(() => api(duzenYol(duzen), { method: "PATCH", body: JSON.stringify({ aktif: false }) }))) setDuzen(null);
  };
  const duzenAc = (tur: BirimTuru, x: { id: string; kod: string; ad: string; adres?: string | null; sgkSicilNo?: string | null; csgbIsKolu?: number | null; ustDepartmanId?: string | null; departmanId?: string | null }, isyeriId: string) =>
    setDuzen({ tur, id: x.id, kod: x.kod, ad: x.ad, adres: x.adres ?? "", sgkSicilNo: x.sgkSicilNo ?? "", csgbIsKolu: x.csgbIsKolu ? String(x.csgbIsKolu) : "", ustDepartmanId: x.ustDepartmanId ?? "", departmanId: x.departmanId ?? "", isyeriId });
  const yeniKaydet = async (e: React.FormEvent) => {
    e.preventDefault();
    const govde = yeni.tur === "isyeri" ? { kod: yeni.kod, ad: yeni.ad, adres: yeni.adres } : yeni.tur === "departman" ? { kod: yeni.kod, ad: yeni.ad, isyeriId: yeni.isyeriId, ustDepartmanId: yeni.ustDepartmanId || null } : { kod: yeni.kod, ad: yeni.ad, departmanId: yeni.departmanId || null };
    if (await kaydet(() => api(`/personel/organizasyon/${YOL[yeni.tur as BirimTuru]}`, { method: "POST", body: JSON.stringify(govde) }))) setYeni({ ...yeni, kod: "", ad: "", adres: "" });
  };

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel">← Personel listesine dön</Link>
      <PageHeader title="Organizasyon yapısı" subtitle="İşyerleri, departmanlar, pozisyonlar ve raporlama ilişkileri." />
      <Alert tone="error">{hata}</Alert>
      <div className="split split--wide-left">
        <div className="stack">
          {isyerleri.map((i) => (
            <Card key={i.id} title={<><small className="subtle mono">{i.kod}{i.sgkSicilNo ? ` · SGK ${i.sgkSicilNo}` : ""}</small><div>{i.ad}</div></>} actions={<div className="row-tight"><Badge variant="accent">{i._count.personeller} personel</Badge><Button size="sm" onClick={() => duzenAc("isyeri", i, i.id)}>Düzenle</Button></div>}>
              {!i.departmanlar.length ? <p className="muted" style={{ margin: 0 }}>Departman tanımlanmamış.</p> : (
                <div className="split split--even">
                  {i.departmanlar.map((d) => (
                    <div key={d.id} className="card card--pad" style={{ background: "var(--surface-2)" }}>
                      <div className="between">
                        <strong>{d.ad}</strong>
                        <span className="row-tight"><small className="muted">{d._count.personeller} kişi</small><Button size="sm" onClick={() => duzenAc("departman", d, i.id)}>Düzenle</Button></span>
                      </div>
                      {d.pozisyonlar.length > 0 && <div className="row-tight" style={{ marginTop: "0.6rem" }}>{d.pozisyonlar.map((p) => <Button key={p.id} size="sm" title="Pozisyonu düzenle" onClick={() => duzenAc("pozisyon", p, i.id)}>{p.ad}</Button>)}</div>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
        <div className="stack">
          <Card title="Personel organizasyon ataması">
            <form className="stack" onSubmit={ataKaydet}>
              <Field label="Personel">
                <Select required value={ata.personelId} onChange={(e) => { const p = personeller.find((x) => x.id === e.target.value); setAta({ personelId: e.target.value, isyeriId: p?.isyeriId || isyerleri[0]?.id || "", departmanId: p?.departmanId || "", pozisyonId: p?.pozisyonId || "", yoneticiId: p?.yoneticiId || "" }); }}>
                  <option value="">Seçin</option>
                  {personeller.map((p) => <option key={p.id} value={p.id}>{p.personelNo} · {p.ad} {p.soyad}</option>)}
                </Select>
              </Field>
              <Field label="İşyeri"><Select required value={ata.isyeriId} onChange={(e) => setAta({ ...ata, isyeriId: e.target.value, departmanId: "", pozisyonId: "" })}>{isyerleri.map((i) => <option key={i.id} value={i.id}>{i.ad}</option>)}</Select></Field>
              <Field label="Departman"><Select value={ata.departmanId} onChange={(e) => setAta({ ...ata, departmanId: e.target.value, pozisyonId: "" })}><option value="">Atanmamış</option>{departmanlar.map((d) => <option key={d.id} value={d.id}>{d.ad}</option>)}</Select></Field>
              <Field label="Pozisyon"><Select value={ata.pozisyonId} onChange={(e) => setAta({ ...ata, pozisyonId: e.target.value })}><option value="">Atanmamış</option>{pozisyonlar.map((p) => <option key={p.id} value={p.id}>{p.ad}</option>)}</Select></Field>
              <Field label="Yönetici"><Select value={ata.yoneticiId} onChange={(e) => setAta({ ...ata, yoneticiId: e.target.value })}><option value="">Yönetici yok</option>{personeller.filter((p) => p.id !== ata.personelId && p.durum === "aktif").map((p) => <option key={p.id} value={p.id}>{p.ad} {p.soyad}</option>)}</Select></Field>
              <Button block type="submit" variant="primary" disabled={bekle}>Atamayı kaydet</Button>
            </form>
          </Card>
          <Card title="Yeni organizasyon kaydı">
            <form className="stack" onSubmit={yeniKaydet}>
              <Field label="Kayıt türü"><Select value={yeni.tur} onChange={(e) => setYeni({ ...yeni, tur: e.target.value })}><option value="isyeri">İşyeri</option><option value="departman">Departman</option><option value="pozisyon">Pozisyon</option></Select></Field>
              {yeni.tur !== "isyeri" && <Field label="İşyeri"><Select value={yeni.isyeriId} onChange={(e) => setYeni({ ...yeni, isyeriId: e.target.value, departmanId: "" })}>{isyerleri.map((i) => <option key={i.id} value={i.id}>{i.ad}</option>)}</Select></Field>}
              {yeni.tur === "pozisyon" && <Field label="Departman"><Select value={yeni.departmanId} onChange={(e) => setYeni({ ...yeni, departmanId: e.target.value })}><option value="">Genel pozisyon</option>{isyeriDepartmanlari(yeni.isyeriId).map((d) => <option key={d.id} value={d.id}>{d.ad}</option>)}</Select></Field>}
              <div className="form-grid form-grid--2">
                <Field label="Kod"><Input required pattern="[a-z0-9_]+" title="Küçük harf, rakam ve alt çizgi" value={yeni.kod} onChange={(e) => setYeni({ ...yeni, kod: e.target.value })} /></Field>
                <Field label="Ad"><Input required value={yeni.ad} onChange={(e) => setYeni({ ...yeni, ad: e.target.value })} /></Field>
              </div>
              <Button block type="submit" disabled={bekle}>Kaydı oluştur</Button>
            </form>
          </Card>
        </div>
      </div>

      {duzen && (
        <Modal baslik={`${TUR_ADI[duzen.tur]} düzenle`} aciklama={`Kod: ${duzen.kod} (değişmez)`} onKapat={() => setDuzen(null)}>
          <form className="stack" onSubmit={duzenKaydet}>
            <Field label="Ad"><Input required minLength={2} maxLength={100} value={duzen.ad} onChange={(e) => setDuzen({ ...duzen, ad: e.target.value })} /></Field>
            {duzen.tur === "isyeri" && <>
              <Field label="Adres"><Input maxLength={500} value={duzen.adres} onChange={(e) => setDuzen({ ...duzen, adres: e.target.value })} /></Field>
              <Field label="SGK işyeri sicil no"><Input maxLength={40} value={duzen.sgkSicilNo} onChange={(e) => setDuzen({ ...duzen, sgkSicilNo: e.target.value })} placeholder="26 haneli sicil numarası" /><small className="muted">SGK XML dosyaları için 26 hane gerekir.</small></Field>
              <Field label="ÇSGB işkolu"><Select value={duzen.csgbIsKolu} onChange={(e) => setDuzen({ ...duzen, csgbIsKolu: e.target.value })}><option value="">Seçilmedi</option>{CSGB_IS_KOLLARI.map((ad, i) => <option key={ad} value={i + 1}>{String(i + 1).padStart(2, "0")} — {ad}</option>)}</Select></Field>
            </>}
            {duzen.tur === "departman" && <Field label="Üst departman"><Select value={duzen.ustDepartmanId} onChange={(e) => setDuzen({ ...duzen, ustDepartmanId: e.target.value })}><option value="">Yok (en üst)</option>{isyeriDepartmanlari(duzen.isyeriId).filter((x) => x.id !== duzen.id).map((x) => <option key={x.id} value={x.id}>{x.ad}</option>)}</Select></Field>}
            {duzen.tur === "pozisyon" && <Field label="Departman"><Select value={duzen.departmanId} onChange={(e) => setDuzen({ ...duzen, departmanId: e.target.value })}><option value="">Genel pozisyon</option>{isyeriDepartmanlari(duzen.isyeriId).map((x) => <option key={x.id} value={x.id}>{x.ad}</option>)}</Select></Field>}
            <div className="between">
              <Button type="button" variant="danger" disabled={bekle} onClick={() => void pasifeAl()}>Pasife al</Button>
              <div className="row-tight"><Button type="button" onClick={() => setDuzen(null)}>Vazgeç</Button><Button type="submit" variant="primary" disabled={bekle}>Kaydet</Button></div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
