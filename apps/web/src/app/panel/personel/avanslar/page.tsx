"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { bugunTR } from "@tekirextra/shared";
import { Alert, Badge, Button, Card, Field, Input, Modal, ModalEylem, PageHeader, Para, Select, Stat, StatGrid, Table } from "@/components/ui";

type AvansDurum = "talep" | "onaylandi" | "odendi" | "kismen_mahsup" | "mahsup_edildi" | "reddedildi" | "iptal";
interface Personel { id: string; personelNo: string; ad: string; soyad: string; durum?: string }
interface Avans { id: string; tutar: string; tarih: string; aciklama?: string | null; durum: AvansDurum; kalanTutar: string; mahsupEdilenTutar: string; retNedeni?: string | null; personel: Personel }
interface Hesap { id: string; ad: string; bankaAdi?: string; aktif: boolean; dovizCinsi: string; bakiye: string }

const DURUM: Record<AvansDurum, [string, "warning" | "info" | "accent" | "neutral" | "success" | "danger"]> = {
  talep: ["Onay bekliyor", "warning"], onaylandi: ["Ödeme bekliyor", "info"], odendi: ["Mahsup bekliyor", "accent"], kismen_mahsup: ["Kısmen mahsup", "accent"],
  mahsup_edildi: ["Mahsup edildi", "success"], reddedildi: ["Reddedildi", "danger"], iptal: ["İptal", "neutral"],
};

/** Avans talebi, onay, ödeme ve bordro mahsup bakiyeleri. */
export default function AvanslarSayfasi() {
  const [avanslar, setAvanslar] = useState<Avans[]>([]);
  const [personeller, setPersoneller] = useState<Personel[]>([]);
  const [hata, setHata] = useState<string | null>(null);
  const [isleniyor, setIsleniyor] = useState<string | null>(null);
  const [talepAcik, setTalepAcik] = useState(false);
  const [odenecek, setOdenecek] = useState<Avans | null>(null);
  const [reddedilecek, setReddedilecek] = useState<Avans | null>(null);
  /** PRS-04: mahsup edilmemiş avans ödemesini ters kayıtla geri al. */
  const [geriAlinacak, setGeriAlinacak] = useState<Avans | null>(null);
  const [geriAlmaNedeni, setGeriAlmaNedeni] = useState("");
  const [retNedeni, setRetNedeni] = useState("");
  const [hesaplar, setHesaplar] = useState<{ kasalar: Hesap[]; bankalar: Hesap[] }>({ kasalar: [], bankalar: [] });
  const [talep, setTalep] = useState({ personelId: "", tutar: "", tarih: bugunTR(), aciklama: "" });
  const [odeme, setOdeme] = useState({ kaynak: "", tarih: bugunTR() });

  const yukle = useCallback(async () => {
    try {
      setHata(null);
      const [a, p] = await Promise.all([api<Avans[]>("/personel/avanslar"), api<Personel[]>("/personel")]);
      setAvanslar(a); setPersoneller(p.filter((x) => x.durum === "aktif"));
    } catch (e) { setHata(e instanceof Error ? e.message : "Avans kayıtları alınamadı"); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  const ozet = useMemo(() => ({
    talepler: avanslar.filter((a) => a.durum === "talep").length,
    acik: avanslar.filter((a) => ["odendi", "kismen_mahsup"].includes(a.durum)).reduce((t, a) => t + Number(a.kalanTutar), 0),
    toplam: avanslar.reduce((t, a) => t + Number(a.tutar), 0),
  }), [avanslar]);

  const calistir = async (id: string, fn: () => Promise<unknown>) => {
    try { setIsleniyor(id); setHata(null); await fn(); await yukle(); return true; }
    catch (e) { setHata(e instanceof ApiHata ? e.message : "İşlem tamamlanamadı"); return false; }
    finally { setIsleniyor(null); }
  };
  const olustur = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await calistir("yeni", () => api("/personel/avanslar", { method: "POST", body: JSON.stringify(talep) }))) { setTalepAcik(false); setTalep({ personelId: "", tutar: "", tarih: bugunTR(), aciklama: "" }); }
  };
  const odemeAc = async (a: Avans) => {
    try {
      const [kasalar, bankalar] = await Promise.all([api<Hesap[]>("/kasa-banka/kasalar"), api<Hesap[]>("/kasa-banka/bankalar")]);
      setHesaplar({ kasalar: kasalar.filter((h) => h.aktif && h.dovizCinsi === "TRY"), bankalar: bankalar.filter((h) => h.aktif && h.dovizCinsi === "TRY") });
      setOdenecek(a);
    } catch (e) { setHata(e instanceof Error ? e.message : "Hesaplar alınamadı"); }
  };
  const ode = async (e: React.FormEvent) => {
    e.preventDefault(); if (!odenecek) return;
    const [tur, hesapId] = odeme.kaynak.split(":");
    if (await calistir(odenecek.id, () => api(`/personel/avanslar/${odenecek.id}/odemeler`, { method: "POST", body: JSON.stringify({ tarih: odeme.tarih, [tur === "kasa" ? "kasaId" : "bankaHesapId"]: hesapId }) }))) setOdenecek(null);
  };
  const odemeGeriAl = async (e: React.FormEvent) => {
    e.preventDefault(); if (!geriAlinacak) return;
    if (await calistir(geriAlinacak.id, () => api(`/personel/avanslar/${geriAlinacak.id}/odeme-iptal`, { method: "POST", body: JSON.stringify({ neden: geriAlmaNedeni }) }))) { setGeriAlinacak(null); setGeriAlmaNedeni(""); }
  };
  const reddet = async (e: React.FormEvent) => {
    e.preventDefault(); if (!reddedilecek) return;
    if (await calistir(reddedilecek.id, () => api(`/personel/avanslar/${reddedilecek.id}/reddet`, { method: "POST", body: JSON.stringify({ neden: retNedeni }) }))) { setReddedilecek(null); setRetNedeni(""); }
  };

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel">← Personel listesine dön</Link>
      <PageHeader title="Avans yönetimi" subtitle="Talep, onay, ödeme ve bordro mahsup bakiyelerini yönetin." actions={<Button variant="primary" onClick={() => setTalepAcik(true)}>Yeni avans talebi</Button>} />
      <Alert tone="error">{hata}</Alert>
      <StatGrid>
        <Stat label="Bekleyen talep" value={ozet.talepler} tone={ozet.talepler ? "accent" : "default"} />
        <Stat label="Açık avans bakiyesi" value={<Para deger={ozet.acik} />} />
        <Stat label="Toplam talep" value={<Para deger={ozet.toplam} />} />
      </StatGrid>
      <Card pad={false}>
        <Table>
          <thead><tr><th>Personel</th><th className="num">Talep</th><th className="num">Mahsup</th><th className="num">Kalan</th><th>Durum</th><th /></tr></thead>
          <tbody>
            {avanslar.map((a) => (
              <tr key={a.id}>
                <td><Link href={`/panel/personel/${a.personel.id}`}><strong>{a.personel.ad} {a.personel.soyad}</strong></Link><div className="subtle mono">{a.personel.personelNo}</div></td>
                <td className="num"><strong><Para deger={a.tutar} /></strong></td>
                <td className="num"><Para deger={a.mahsupEdilenTutar} /></td>
                <td className="num"><Para deger={a.kalanTutar} /></td>
                <td><Badge variant={DURUM[a.durum][1]}>{DURUM[a.durum][0]}</Badge>{a.retNedeni && <div style={{ color: "var(--danger)", fontSize: "0.75rem", marginTop: "0.25rem" }}>{a.retNedeni}</div>}</td>
                <td className="num">
                  <div className="row-tight" style={{ justifyContent: "flex-end" }}>
                    {a.durum === "talep" && <>
                      <Button size="sm" variant="danger" onClick={() => setReddedilecek(a)}>Reddet</Button>
                      <Button size="sm" variant="primary" disabled={isleniyor === a.id} onClick={() => void calistir(a.id, () => api(`/personel/avanslar/${a.id}/onayla`, { method: "POST" }))}>Onayla</Button>
                    </>}
                    {a.durum === "onaylandi" && <Button size="sm" variant="primary" onClick={() => void odemeAc(a)}>Öde</Button>}
                    {a.durum === "odendi" && Number(a.mahsupEdilenTutar) === 0 && <Button size="sm" variant="danger" onClick={() => setGeriAlinacak(a)}>Ödemeyi geri al</Button>}
                  </div>
                </td>
              </tr>
            ))}
            {!avanslar.length && <tr><td className="muted" colSpan={6}>Henüz avans talebi yok.</td></tr>}
          </tbody>
        </Table>
      </Card>

      {talepAcik && (
        <Modal baslik="Yeni avans talebi" onKapat={() => setTalepAcik(false)}>
          <form className="stack" onSubmit={olustur}>
            <Field label="Personel">
              <Select required value={talep.personelId} onChange={(e) => setTalep({ ...talep, personelId: e.target.value })}>
                <option value="">Personel seçin</option>
                {personeller.map((p) => <option key={p.id} value={p.id}>{p.personelNo} · {p.ad} {p.soyad}</option>)}
              </Select>
            </Field>
            <Field label="Tutar"><Input required type="number" min="0.01" step="0.01" value={talep.tutar} onChange={(e) => setTalep({ ...talep, tutar: e.target.value })} /></Field>
            <Field label="Talep tarihi"><Input required type="date" value={talep.tarih} onChange={(e) => setTalep({ ...talep, tarih: e.target.value })} /></Field>
            <Field label="Açıklama"><textarea className="textarea" maxLength={250} value={talep.aciklama} onChange={(e) => setTalep({ ...talep, aciklama: e.target.value })} /></Field>
            <ModalEylem onVazgec={() => setTalepAcik(false)} isleniyor={isleniyor === "yeni"} metin="Talebi oluştur" />
          </form>
        </Modal>
      )}
      {odenecek && (
        <Modal baslik="Avans ödemesi" aciklama={<>Ödenecek: <strong><Para deger={odenecek.tutar} /></strong> · {odenecek.personel.ad} {odenecek.personel.soyad}</>} onKapat={() => setOdenecek(null)}>
          <form className="stack" onSubmit={ode}>
            <Field label="Kasa / banka">
              <Select required value={odeme.kaynak} onChange={(e) => setOdeme({ ...odeme, kaynak: e.target.value })}>
                <option value="">Hesap seçin</option>
                <optgroup label="Kasalar">{hesaplar.kasalar.map((h) => <option key={h.id} value={`kasa:${h.id}`}>{h.ad} · {Number(h.bakiye).toLocaleString("tr-TR", { style: "currency", currency: "TRY" })}</option>)}</optgroup>
                <optgroup label="Bankalar">{hesaplar.bankalar.map((h) => <option key={h.id} value={`banka:${h.id}`}>{h.bankaAdi} / {h.ad}</option>)}</optgroup>
              </Select>
            </Field>
            <Field label="Ödeme tarihi"><Input required type="date" value={odeme.tarih} onChange={(e) => setOdeme({ ...odeme, tarih: e.target.value })} /></Field>
            <ModalEylem onVazgec={() => setOdenecek(null)} isleniyor={isleniyor === odenecek.id} metin="Ödemeyi kaydet" />
          </form>
        </Modal>
      )}
      {geriAlinacak && (
        <Modal baslik="Avans ödemesini geri al" aciklama="Kasa/banka ve personel carisine ters kayıt yazılır; avans yeniden “Onaylandı” olur ve doğru hesaptan tekrar ödenebilir." onKapat={() => setGeriAlinacak(null)}>
          <form className="stack" onSubmit={odemeGeriAl}>
            <Field label="Gerekçe"><textarea className="textarea" required minLength={3} maxLength={500} rows={3} value={geriAlmaNedeni} onChange={(e) => setGeriAlmaNedeni(e.target.value)} /></Field>
            <ModalEylem onVazgec={() => setGeriAlinacak(null)} isleniyor={isleniyor === geriAlinacak.id} metin="Ödemeyi geri al" tehlikeli />
          </form>
        </Modal>
      )}
      {reddedilecek && (
        <Modal baslik="Avans talebini reddet" onKapat={() => setReddedilecek(null)}>
          <form className="stack" onSubmit={reddet}>
            <Field label="Ret nedeni"><textarea className="textarea" required minLength={3} maxLength={500} rows={4} value={retNedeni} onChange={(e) => setRetNedeni(e.target.value)} /></Field>
            <ModalEylem onVazgec={() => setReddedilecek(null)} isleniyor={isleniyor === reddedilecek.id} metin="Talebi reddet" tehlikeli />
          </form>
        </Modal>
      )}
    </div>
  );
}

