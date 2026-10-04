"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Para, Select, Table, Tabs, Tarih } from "@/components/ui";

interface Ben {
  personelNo: string; ad: string; soyad: string; eposta: string | null; telefon: string | null; adres: string | null;
  departman: string | null; unvan: string | null; girisTarihi: string; ibanKayitli: boolean;
  izinTurleri: { id: string; ad: string; kod: string; bakiyeTakibi: boolean }[];
  izinBakiyeleri: { izinTuru: { id: string; ad: string }; bakiye: string }[];
}
interface Pusula { id: string; donem: string; durum: string; netMaas: string; odenecekTutar: string; odenenTutar: string; donemYil: number; donemAy: number }
interface IzinTalebi { id: string; baslangicTarihi: string; bitisTarihi: string; gunSayisi: string; durum: "talep" | "onaylandi" | "reddedildi" | "iptal"; aciklama: string | null; retNedeni?: string | null; izinTuru: { ad: string } }

type Sekme = "ozet" | "pusulalar" | "izinler";
const IZIN_DURUMU: Record<IzinTalebi["durum"], [string, "warning" | "success" | "danger" | "neutral"]> = { talep: ["Onay bekliyor", "warning"], onaylandi: ["Onaylandı", "success"], reddedildi: ["Reddedildi", "danger"], iptal: ["Geri çekildi", "neutral"] };
const BORDRO_DURUMU: Record<string, string> = { onaylandi: "Onaylandı", kismen_odendi: "Kısmen ödendi", odendi: "Ödendi" };

/**
 * PRS-21 (P3-4): çalışan self-servisi. Çalışan yalnız kendi kartını,
 * onaylı bordrolarının pusulasını ve izinlerini görür; talepleri İK onaylar.
 */
export default function SelfServis() {
  const [sekme, setSekme] = useState<Sekme>("ozet");
  const [ben, setBen] = useState<Ben | null>(null);
  const [pusulalar, setPusulalar] = useState<Pusula[]>([]);
  const [izinler, setIzinler] = useState<IzinTalebi[]>([]);
  const [hata, setHata] = useState("");
  const [bilgi, setBilgi] = useState("");
  const [izinFormu, setIzinFormu] = useState({ izinTuruId: "", baslangicTarihi: "", bitisTarihi: "", aciklama: "" });
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const yukle = useCallback(async () => {
    try {
      setHata("");
      const [b, p, i] = await Promise.all([api<Ben>("/self-servis/ben"), api<Pusula[]>("/self-servis/pusulalar"), api<IzinTalebi[]>("/self-servis/izinler")]);
      setBen(b); setPusulalar(p); setIzinler(i);
    } catch (e) { setHata(e instanceof Error ? e.message : "Bilgiler alınamadı"); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  async function izinGonder(e: FormEvent) {
    e.preventDefault();
    setGonderiliyor(true); setHata(""); setBilgi("");
    try {
      await api("/self-servis/izinler", { method: "POST", body: JSON.stringify({ ...izinFormu, aciklama: izinFormu.aciklama || null }) });
      setIzinFormu({ izinTuruId: "", baslangicTarihi: "", bitisTarihi: "", aciklama: "" });
      setBilgi("İzin talebiniz İK onayına gönderildi.");
      await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "İzin talebi gönderilemedi"); }
    finally { setGonderiliyor(false); }
  }

  async function geriCek(id: string) {
    if (!window.confirm("İzin talebi geri çekilsin mi?")) return;
    try { await api(`/self-servis/izinler/${id}/geri-cek`, { method: "POST" }); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "Talep geri çekilemedi"); }
  }

  return (
    <div className="stack self-servis">
      <PageHeader title={ben ? `Merhaba, ${ben.ad}` : "Self-servis"} subtitle="Ücret pusulalarınız, izin bakiyeniz ve talepleriniz" />
      {hata && <Alert tone="error">{hata}</Alert>}
      {bilgi && <Alert tone="success">{bilgi}</Alert>}
      <Tabs<Sekme> items={[{ deger: "ozet", baslik: "Bilgilerim" }, { deger: "pusulalar", baslik: `Pusulalarım (${pusulalar.length})` }, { deger: "izinler", baslik: "İzinlerim" }]} value={sekme} onChange={setSekme} ariaLabel="Self-servis bölümleri" />

      {sekme === "ozet" && ben && (
        <div className="self-servis__ikili">
          <Card title="Kişisel bilgiler">
            <dl className="self-servis__tanim">
              <dt>Personel no</dt><dd>{ben.personelNo}</dd>
              <dt>Ad soyad</dt><dd>{ben.ad} {ben.soyad}</dd>
              <dt>Departman / unvan</dt><dd>{[ben.departman, ben.unvan].filter(Boolean).join(" · ") || "—"}</dd>
              <dt>İşe giriş</dt><dd><Tarih deger={ben.girisTarihi} /></dd>
              <dt>E-posta</dt><dd>{ben.eposta || "—"}</dd>
              <dt>Telefon</dt><dd>{ben.telefon || "—"}</dd>
              <dt>Adres</dt><dd>{ben.adres || "—"}</dd>
              <dt>Maaş hesabı (IBAN)</dt><dd>{ben.ibanKayitli ? "Kayıtlı" : "Kayıtlı değil"}</dd>
            </dl>
          </Card>
          <Card title="İzin bakiyem">
            {ben.izinBakiyeleri.length ? (
              <dl className="self-servis__tanim">{ben.izinBakiyeleri.map((b) => <div key={b.izinTuru.id} className="self-servis__satir"><dt>{b.izinTuru.ad}</dt><dd><strong>{Number(b.bakiye).toLocaleString("tr-TR")}</strong> gün kaldı</dd></div>)}</dl>
            ) : <p className="muted">Bakiyesi izlenen izin türü yok.</p>}
          </Card>
        </div>
      )}

      {sekme === "pusulalar" && (
        <Card title="Ücret hesap pusulalarım">
          {pusulalar.length ? (
            <Table><thead><tr><th>Dönem</th><th>Durum</th><th className="num">Net ücret</th><th className="num">Ödenecek</th><th className="num">Ödenen</th><th /></tr></thead>
              <tbody>{pusulalar.map((p) => (
                <tr key={p.id}>
                  <td>{p.donem}</td><td>{BORDRO_DURUMU[p.durum] ?? p.durum}</td>
                  <td className="num"><Para deger={p.netMaas} /></td><td className="num"><Para deger={p.odenecekTutar} /></td><td className="num"><Para deger={p.odenenTutar} /></td>
                  <td className="num"><Button size="sm" onClick={() => void apiDosyaIndir(`/self-servis/pusulalar/${p.id}/pdf`, `pusula-${p.donemYil}-${String(p.donemAy).padStart(2, "0")}.pdf`).catch((e) => setHata(e instanceof Error ? e.message : "Pusula indirilemedi"))}>PDF indir</Button></td>
                </tr>
              ))}</tbody></Table>
          ) : <p className="muted">Henüz onaylanmış bordronuz yok.</p>}
        </Card>
      )}

      {sekme === "izinler" && ben && (<>
        <Card title="Yeni izin talebi">
          <form onSubmit={izinGonder} className="form-grid">
            <Field label="İzin türü"><Select required value={izinFormu.izinTuruId} onChange={(e) => setIzinFormu({ ...izinFormu, izinTuruId: e.target.value })}><option value="">Seçin</option>{ben.izinTurleri.map((t) => <option key={t.id} value={t.id}>{t.ad}</option>)}</Select></Field>
            <Field label="Başlangıç"><Input required type="date" value={izinFormu.baslangicTarihi} onChange={(e) => setIzinFormu({ ...izinFormu, baslangicTarihi: e.target.value })} /></Field>
            <Field label="Bitiş"><Input required type="date" min={izinFormu.baslangicTarihi || undefined} value={izinFormu.bitisTarihi} onChange={(e) => setIzinFormu({ ...izinFormu, bitisTarihi: e.target.value })} /></Field>
            <Field label="Açıklama"><Input maxLength={500} value={izinFormu.aciklama} onChange={(e) => setIzinFormu({ ...izinFormu, aciklama: e.target.value })} /></Field>
            <div><Button variant="primary" type="submit" disabled={gonderiliyor}>{gonderiliyor ? "Gönderiliyor…" : "Talebi gönder"}</Button></div>
          </form>
        </Card>
        <Card title="Taleplerim">
          {izinler.length ? (
            <Table><thead><tr><th>Tür</th><th>Tarih</th><th className="num">Gün</th><th>Durum</th><th /></tr></thead>
              <tbody>{izinler.map((t) => (
                <tr key={t.id}>
                  <td>{t.izinTuru.ad}</td>
                  <td><Tarih deger={t.baslangicTarihi} /> – <Tarih deger={t.bitisTarihi} /></td>
                  <td className="num">{Number(t.gunSayisi).toLocaleString("tr-TR")}</td>
                  <td><Badge variant={IZIN_DURUMU[t.durum][1]}>{IZIN_DURUMU[t.durum][0]}</Badge>{t.retNedeni ? <span className="subtle"> · {t.retNedeni}</span> : null}</td>
                  <td className="num">{t.durum === "talep" && <Button size="sm" onClick={() => void geriCek(t.id)}>Geri çek</Button>}</td>
                </tr>
              ))}</tbody></Table>
          ) : <p className="muted">İzin talebiniz yok.</p>}
        </Card>
      </>)}
    </div>
  );
}
