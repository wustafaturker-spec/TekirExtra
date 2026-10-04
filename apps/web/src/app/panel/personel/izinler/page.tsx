"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { bugunTR } from "@tekirextra/shared";
import { Alert, Badge, Button, Card, Field, Input, Modal, ModalEylem, PageHeader, Select, Stat, StatGrid, Table } from "@/components/ui";

interface Personel { id: string; personelNo: string; ad: string; soyad: string; durum?: string }
interface IzinTuru { id: string; kod: string; ad: string; ucretli: boolean; bakiyeTakibi: boolean }
interface Talep { id: string; baslangicTarihi: string; bitisTarihi: string; gunSayisi: string; aciklama?: string | null; durum: "talep" | "onaylandi" | "reddedildi" | "iptal"; kararNedeni?: string | null; personel: Personel; izinTuru: IzinTuru }
interface Bakiye { izinTuru: IzinTuru; bakiye: string }

const tarih = (v: string) => new Date(v).toLocaleDateString("tr-TR", { timeZone: "UTC" });
const DURUM: Record<Talep["durum"], [string, "warning" | "success" | "danger" | "neutral"]> = { talep: ["Onay bekliyor", "warning"], onaylandi: ["Onaylandı", "success"], reddedildi: ["Reddedildi", "danger"], iptal: ["İptal", "neutral"] };

/** İzin talepleri, onaylar ve hareket bazlı bakiyeler. */
export default function IzinlerSayfasi() {
  const [talepler, setTalepler] = useState<Talep[]>([]);
  const [turler, setTurler] = useState<IzinTuru[]>([]);
  const [personeller, setPersoneller] = useState<Personel[]>([]);
  const [bakiyeler, setBakiyeler] = useState<Bakiye[]>([]);
  const [seciliPersonel, setSeciliPersonel] = useState("");
  const [hata, setHata] = useState<string | null>(null);
  const [isleniyor, setIsleniyor] = useState<string | null>(null);
  const [talepAcik, setTalepAcik] = useState(false);
  const [bakiyeAcik, setBakiyeAcik] = useState(false);
  const [karar, setKarar] = useState<{ talep: Talep; islem: "reddet" | "iptal" } | null>(null);
  const [neden, setNeden] = useState("");
  const bugun = bugunTR();
  const [form, setForm] = useState({ personelId: "", izinTuruId: "", baslangicTarihi: bugun, bitisTarihi: bugun, aciklama: "" });
  const [bakiyeForm, setBakiyeForm] = useState({ personelId: "", izinTuruId: "", tip: "hak_edis", gun: "14", aciklama: "Yıllık izin hak edişi" });

  const yukle = useCallback(async () => {
    try {
      setHata(null);
      const [t, tur, p] = await Promise.all([api<Talep[]>("/personel/izinler"), api<IzinTuru[]>("/personel/izinler/turler"), api<Personel[]>("/personel")]);
      setTalepler(t); setTurler(tur); setPersoneller(p.filter((x) => x.durum === "aktif"));
    } catch (e) { setHata(e instanceof Error ? e.message : "İzin verileri alınamadı"); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);
  useEffect(() => {
    if (!seciliPersonel) { setBakiyeler([]); return; }
    void api<Bakiye[]>(`/personel/izinler/bakiyeler/${seciliPersonel}`).then(setBakiyeler).catch((e) => setHata(e instanceof Error ? e.message : "Bakiye alınamadı"));
  }, [seciliPersonel]);

  const ozet = useMemo(() => ({
    bekleyen: talepler.filter((t) => t.durum === "talep").length,
    onayli: talepler.filter((t) => t.durum === "onaylandi").length,
    gun: talepler.filter((t) => t.durum === "onaylandi").reduce((s, t) => s + Number(t.gunSayisi), 0),
  }), [talepler]);

  const calistir = async (id: string, fn: () => Promise<unknown>) => {
    try { setIsleniyor(id); setHata(null); await fn(); await yukle(); return true; }
    catch (e) { setHata(e instanceof ApiHata ? e.message : "İşlem tamamlanamadı"); return false; }
    finally { setIsleniyor(null); }
  };
  const talepOlustur = async (e: React.FormEvent) => { e.preventDefault(); if (await calistir("yeni", () => api("/personel/izinler", { method: "POST", body: JSON.stringify(form) }))) setTalepAcik(false); };
  const kararVer = async (e: React.FormEvent) => {
    e.preventDefault(); if (!karar) return;
    if (await calistir(karar.talep.id, () => api(`/personel/izinler/${karar.talep.id}/${karar.islem}`, { method: "POST", body: JSON.stringify({ neden }) }))) { setKarar(null); setNeden(""); }
  };
  const bakiyeKaydet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await calistir("bakiye", () => api("/personel/izinler/bakiye-hareketleri", { method: "POST", body: JSON.stringify(bakiyeForm) }))) { setBakiyeAcik(false); if (seciliPersonel === bakiyeForm.personelId) setSeciliPersonel(""); }
  };

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel">← Personel listesine dön</Link>
      <PageHeader
        title="İzin yönetimi"
        subtitle="Bakiyeleri, talepleri ve onay süreçlerini hareket bazlı yönetin."
        actions={<>
          <Link className="btn btn--ghost" href="/panel/personel/izinler/takvim">Tatil takvimi</Link>
          <Button onClick={() => setBakiyeAcik(true)}>Hak ediş / devir</Button>
          <Button variant="primary" onClick={() => setTalepAcik(true)}>Yeni izin talebi</Button>
        </>}
      />
      <Alert tone="error">{hata}</Alert>
      <StatGrid>
        <Stat label="Onay bekleyen" value={ozet.bekleyen} tone={ozet.bekleyen ? "accent" : "default"} />
        <Stat label="Onaylı izin" value={ozet.onayli} />
        <Stat label="Onaylı iş günü" value={`${ozet.gun} gün`} />
      </StatGrid>
      <Card title="Personel izin bakiyesi">
        <Select aria-label="Personel" value={seciliPersonel} onChange={(e) => setSeciliPersonel(e.target.value)} style={{ maxWidth: "28rem" }}>
          <option value="">Personel seçin</option>
          {personeller.map((p) => <option key={p.id} value={p.id}>{p.personelNo} · {p.ad} {p.soyad}</option>)}
        </Select>
        {bakiyeler.length > 0 && (
          <div className="row-tight" style={{ marginTop: "1rem" }}>
            {bakiyeler.map((b) => <Badge key={b.izinTuru.id} variant="success">{b.izinTuru.ad}: {b.bakiye} gün</Badge>)}
          </div>
        )}
      </Card>
      <Card pad={false}>
        <Table>
          <thead><tr><th>Personel</th><th>İzin</th><th>Tarih</th><th className="num">Gün</th><th>Durum</th><th /></tr></thead>
          <tbody>
            {talepler.map((t) => (
              <tr key={t.id}>
                <td><Link href={`/panel/personel/${t.personel.id}`}><strong>{t.personel.ad} {t.personel.soyad}</strong></Link><div className="subtle mono">{t.personel.personelNo}</div></td>
                <td>{t.izinTuru.ad}</td>
                <td>{tarih(t.baslangicTarihi)} – {tarih(t.bitisTarihi)}</td>
                <td className="num"><strong>{t.gunSayisi}</strong></td>
                <td><Badge variant={DURUM[t.durum][1]}>{DURUM[t.durum][0]}</Badge>{t.kararNedeni && <div style={{ color: "var(--danger)", fontSize: "0.75rem", marginTop: "0.25rem" }}>{t.kararNedeni}</div>}</td>
                <td className="num">
                  <div className="row-tight" style={{ justifyContent: "flex-end" }}>
                    {t.durum === "talep" && <>
                      <Button size="sm" variant="danger" onClick={() => setKarar({ talep: t, islem: "reddet" })}>Reddet</Button>
                      <Button size="sm" variant="primary" disabled={isleniyor === t.id} onClick={() => void calistir(t.id, () => api(`/personel/izinler/${t.id}/onayla`, { method: "POST" }))}>Onayla</Button>
                    </>}
                    {t.durum === "onaylandi" && <Button size="sm" variant="danger" onClick={() => setKarar({ talep: t, islem: "iptal" })}>İptal et</Button>}
                  </div>
                </td>
              </tr>
            ))}
            {!talepler.length && <tr><td className="muted" colSpan={6}>Henüz izin talebi yok.</td></tr>}
          </tbody>
        </Table>
      </Card>

      {talepAcik && (
        <Modal baslik="Yeni izin talebi" onKapat={() => setTalepAcik(false)}>
          <form className="stack" onSubmit={talepOlustur}>
            <Field label="Personel"><Select required value={form.personelId} onChange={(e) => setForm({ ...form, personelId: e.target.value })}><option value="">Seçin</option>{personeller.map((p) => <option key={p.id} value={p.id}>{p.personelNo} · {p.ad} {p.soyad}</option>)}</Select></Field>
            <Field label="İzin türü"><Select required value={form.izinTuruId} onChange={(e) => setForm({ ...form, izinTuruId: e.target.value })}><option value="">Seçin</option>{turler.map((t) => <option key={t.id} value={t.id}>{t.ad}</option>)}</Select></Field>
            <div className="form-grid form-grid--2">
              <Field label="Başlangıç"><Input required type="date" value={form.baslangicTarihi} onChange={(e) => setForm({ ...form, baslangicTarihi: e.target.value })} /></Field>
              <Field label="Bitiş"><Input required type="date" value={form.bitisTarihi} onChange={(e) => setForm({ ...form, bitisTarihi: e.target.value })} /></Field>
            </div>
            <Field label="Açıklama"><textarea className="textarea" maxLength={500} value={form.aciklama} onChange={(e) => setForm({ ...form, aciklama: e.target.value })} /></Field>
            <ModalEylem onVazgec={() => setTalepAcik(false)} isleniyor={isleniyor === "yeni"} metin="Talebi oluştur" />
          </form>
        </Modal>
      )}
      {bakiyeAcik && (
        <Modal baslik="İzin bakiyesi hareketi" onKapat={() => setBakiyeAcik(false)}>
          <form className="stack" onSubmit={bakiyeKaydet}>
            <Field label="Personel"><Select required value={bakiyeForm.personelId} onChange={(e) => setBakiyeForm({ ...bakiyeForm, personelId: e.target.value })}><option value="">Seçin</option>{personeller.map((p) => <option key={p.id} value={p.id}>{p.ad} {p.soyad}</option>)}</Select></Field>
            <Field label="İzin türü"><Select required value={bakiyeForm.izinTuruId} onChange={(e) => setBakiyeForm({ ...bakiyeForm, izinTuruId: e.target.value })}><option value="">Seçin</option>{turler.filter((t) => t.bakiyeTakibi).map((t) => <option key={t.id} value={t.id}>{t.ad}</option>)}</Select></Field>
            <div className="form-grid form-grid--2">
              <Field label="Hareket"><Select value={bakiyeForm.tip} onChange={(e) => setBakiyeForm({ ...bakiyeForm, tip: e.target.value })}><option value="hak_edis">Hak ediş</option><option value="devir">Devir</option><option value="duzeltme_artis">Düzeltme artışı</option><option value="duzeltme_azalis">Düzeltme azalışı</option></Select></Field>
              <Field label="Gün"><Input required type="number" min="0.5" step="0.5" value={bakiyeForm.gun} onChange={(e) => setBakiyeForm({ ...bakiyeForm, gun: e.target.value })} /></Field>
            </div>
            <Field label="Açıklama"><Input required value={bakiyeForm.aciklama} onChange={(e) => setBakiyeForm({ ...bakiyeForm, aciklama: e.target.value })} /></Field>
            <ModalEylem onVazgec={() => setBakiyeAcik(false)} isleniyor={isleniyor === "bakiye"} metin="Hareketi kaydet" />
          </form>
        </Modal>
      )}
      {karar && (
        <Modal baslik={karar.islem === "reddet" ? "İzin talebini reddet" : "Onaylı izni iptal et"} aciklama={`${karar.talep.personel.ad} ${karar.talep.personel.soyad} · ${karar.talep.izinTuru.ad} · ${tarih(karar.talep.baslangicTarihi)} – ${tarih(karar.talep.bitisTarihi)}`} onKapat={() => setKarar(null)}>
          <form className="stack" onSubmit={kararVer}>
            <Field label="Gerekçe"><textarea className="textarea" required minLength={3} maxLength={500} rows={4} value={neden} onChange={(e) => setNeden(e.target.value)} /></Field>
            <ModalEylem onVazgec={() => setKarar(null)} isleniyor={isleniyor === karar.talep.id} metin={karar.islem === "reddet" ? "Reddet" : "İptal et"} tehlikeli />
          </form>
        </Modal>
      )}
    </div>
  );
}
