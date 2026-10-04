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

interface Avans { id: string; tutar: string; tarih: string; aciklama: string | null; durum: string; retNedeni: string | null; odenenTutar: string; mahsupEdilenTutar: string }
interface BilgiTalebi { id: string; durum: "bekliyor" | "onaylandi" | "reddedildi" | "iptal"; aciklama: string | null; retNedeni: string | null; createdAt: string; alanlar: { telefon?: string; adres?: string; iban?: string | null } }

type Sekme = "ozet" | "pusulalar" | "izinler" | "avanslar" | "bilgi";
const AVANS_DURUMU: Record<string, [string, "warning" | "success" | "danger" | "neutral" | "info"]> = { talep: ["Onay bekliyor", "warning"], onaylandi: ["Onaylandı, ödeme bekliyor", "info"], odendi: ["Ödendi", "success"], kismen_mahsup: ["Kısmen maaştan düşüldü", "info"], mahsup_edildi: ["Maaştan düşüldü", "neutral"], reddedildi: ["Reddedildi", "danger"], iptal: ["Geri çekildi", "neutral"] };
const BILGI_DURUMU: Record<BilgiTalebi["durum"], [string, "warning" | "success" | "danger" | "neutral"]> = { bekliyor: ["Onay bekliyor", "warning"], onaylandi: ["Karta işlendi", "success"], reddedildi: ["Reddedildi", "danger"], iptal: ["Geri çekildi", "neutral"] };
const IZIN_DURUMU: Record<IzinTalebi["durum"], [string, "warning" | "success" | "danger" | "neutral"]> = { talep: ["Onay bekliyor", "warning"], onaylandi: ["Onaylandı", "success"], reddedildi: ["Reddedildi", "danger"], iptal: ["Geri çekildi", "neutral"] };
const BORDRO_DURUMU: Record<string, string> = { onaylandi: "Onaylandı", kismen_odendi: "Kısmen ödendi", odendi: "Ödendi" };

/**
 * PRS-21 (P3-4): çalışan self-servisi. Çalışan yalnız kendi kartını,
 * onaylı bordrolarının pusulasını, izinlerini ve avanslarını görür; izin, avans
 * ve bilgi güncelleme talebi gönderir, talepleri İK onaylar.
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
  const [avanslar, setAvanslar] = useState<Avans[]>([]);
  const [bilgiTalepleri, setBilgiTalepleri] = useState<BilgiTalebi[]>([]);
  const [avansFormu, setAvansFormu] = useState({ tutar: "", aciklama: "" });
  const [bilgiFormu, setBilgiFormu] = useState({ telefon: "", adres: "", iban: "", aciklama: "" });

  const yukle = useCallback(async () => {
    try {
      setHata("");
      const [b, p, i, a, bt] = await Promise.all([api<Ben>("/self-servis/ben"), api<Pusula[]>("/self-servis/pusulalar"), api<IzinTalebi[]>("/self-servis/izinler"), api<Avans[]>("/self-servis/avanslar"), api<BilgiTalebi[]>("/self-servis/bilgi-talepleri")]);
      setBen(b); setPusulalar(p); setIzinler(i); setAvanslar(a); setBilgiTalepleri(bt);
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

  async function talepGonder(e: FormEvent, yol: string, govde: Record<string, unknown>, mesaj: string, temizle: () => void) {
    e.preventDefault();
    setGonderiliyor(true); setHata(""); setBilgi("");
    try { await api(yol, { method: "POST", body: JSON.stringify(govde) }); temizle(); setBilgi(mesaj); await yukle(); }
    catch (err) { setHata(err instanceof Error ? err.message : "Talep gönderilemedi"); }
    finally { setGonderiliyor(false); }
  }

  async function talepGeriCek(yol: string) {
    if (!window.confirm("Talep geri çekilsin mi?")) return;
    try { await api(yol, { method: "POST" }); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "Talep geri çekilemedi"); }
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
      <Tabs<Sekme> items={[{ deger: "ozet", baslik: "Bilgilerim" }, { deger: "pusulalar", baslik: `Pusulalarım (${pusulalar.length})` }, { deger: "izinler", baslik: "İzinlerim" }, { deger: "avanslar", baslik: "Avanslarım" }, { deger: "bilgi", baslik: "Bilgi güncelleme" }]} value={sekme} onChange={setSekme} ariaLabel="Self-servis bölümleri" />

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
      {sekme === "avanslar" && (<>
        <Card title="Avans talebi">
          <form onSubmit={(e) => void talepGonder(e, "/self-servis/avanslar", { tutar: Number(avansFormu.tutar), aciklama: avansFormu.aciklama || null }, "Avans talebiniz İK onayına gönderildi.", () => setAvansFormu({ tutar: "", aciklama: "" }))} className="form-grid">
            <Field label="Tutar (TL)"><Input required type="number" min="1" step="0.01" value={avansFormu.tutar} onChange={(e) => setAvansFormu({ ...avansFormu, tutar: e.target.value })} /></Field>
            <Field label="Açıklama" className="form-grid__genis"><Input maxLength={500} value={avansFormu.aciklama} onChange={(e) => setAvansFormu({ ...avansFormu, aciklama: e.target.value })} /></Field>
            <div><Button variant="primary" type="submit" disabled={gonderiliyor}>Talebi gönder</Button></div>
          </form>
          <p className="muted">Onaylanan avans ödendikten sonra maaşınızdan düşülür.</p>
        </Card>
        <Card title="Avanslarım">
          {avanslar.length ? (
            <Table><thead><tr><th>Tarih</th><th className="num">Tutar</th><th className="num">Ödenen</th><th className="num">Maaştan düşülen</th><th>Durum</th><th /></tr></thead>
              <tbody>{avanslar.map((a) => (
                <tr key={a.id}>
                  <td><Tarih deger={a.tarih} />{a.aciklama && <div className="subtle">{a.aciklama}</div>}</td>
                  <td className="num"><Para deger={a.tutar} /></td><td className="num"><Para deger={a.odenenTutar} /></td><td className="num"><Para deger={a.mahsupEdilenTutar} /></td>
                  <td><Badge variant={(AVANS_DURUMU[a.durum] ?? [a.durum, "neutral"])[1]}>{(AVANS_DURUMU[a.durum] ?? [a.durum])[0]}</Badge>{a.retNedeni && <span className="subtle"> · {a.retNedeni}</span>}</td>
                  <td className="num">{a.durum === "talep" && <Button size="sm" onClick={() => void talepGeriCek(`/self-servis/avanslar/${a.id}/geri-cek`)}>Geri çek</Button>}</td>
                </tr>
              ))}</tbody></Table>
          ) : <p className="muted">Avans kaydınız yok.</p>}
        </Card>
      </>)}

      {sekme === "bilgi" && ben && (<>
        <Card title="Bilgilerimi güncelle">
          <p className="muted">Değişmesini istediğiniz alanı doldurun; boş bıraktığınız alan aynı kalır. Talep İK onayından sonra kartınıza işlenir.</p>
          <form onSubmit={(e) => void talepGonder(e, "/self-servis/bilgi-talepleri", { ...(bilgiFormu.telefon && { telefon: bilgiFormu.telefon }), ...(bilgiFormu.adres && { adres: bilgiFormu.adres }), ...(bilgiFormu.iban && { iban: bilgiFormu.iban }), aciklama: bilgiFormu.aciklama || null }, "Güncelleme talebiniz İK onayına gönderildi.", () => setBilgiFormu({ telefon: "", adres: "", iban: "", aciklama: "" }))} className="form-grid">
            <Field label={`Telefon (şu an: ${ben.telefon || "—"})`}><Input maxLength={30} value={bilgiFormu.telefon} onChange={(e) => setBilgiFormu({ ...bilgiFormu, telefon: e.target.value })} /></Field>
            <Field label="Maaş IBAN'ı (TR…)" className="form-grid__genis"><Input maxLength={34} placeholder="TR00 0000 0000 0000 0000 0000 00" value={bilgiFormu.iban} onChange={(e) => setBilgiFormu({ ...bilgiFormu, iban: e.target.value })} /></Field>
            <Field label={`Adres (şu an: ${ben.adres || "—"})`} className="form-grid__tam"><Input maxLength={500} value={bilgiFormu.adres} onChange={(e) => setBilgiFormu({ ...bilgiFormu, adres: e.target.value })} /></Field>
            <Field label="Not (isteğe bağlı)" className="form-grid__genis"><Input maxLength={500} value={bilgiFormu.aciklama} onChange={(e) => setBilgiFormu({ ...bilgiFormu, aciklama: e.target.value })} /></Field>
            <div><Button variant="primary" type="submit" disabled={gonderiliyor || !(bilgiFormu.telefon || bilgiFormu.adres || bilgiFormu.iban)}>Talebi gönder</Button></div>
          </form>
        </Card>
        <Card title="Güncelleme taleplerim">
          {bilgiTalepleri.length ? (
            <Table><thead><tr><th>Tarih</th><th>İstenen</th><th>Durum</th><th /></tr></thead>
              <tbody>{bilgiTalepleri.map((t) => (
                <tr key={t.id}>
                  <td><Tarih deger={t.createdAt} /></td>
                  <td>{[t.alanlar.telefon && `Telefon: ${t.alanlar.telefon}`, t.alanlar.adres && `Adres: ${t.alanlar.adres}`, t.alanlar.iban && `IBAN: ${t.alanlar.iban}`].filter(Boolean).map((x) => <div key={x as string}>{x}</div>)}</td>
                  <td><Badge variant={BILGI_DURUMU[t.durum][1]}>{BILGI_DURUMU[t.durum][0]}</Badge>{t.retNedeni && <span className="subtle"> · {t.retNedeni}</span>}</td>
                  <td className="num">{t.durum === "bekliyor" && <Button size="sm" onClick={() => void talepGeriCek(`/self-servis/bilgi-talepleri/${t.id}/geri-cek`)}>Geri çek</Button>}</td>
                </tr>
              ))}</tbody></Table>
          ) : <p className="muted">Güncelleme talebiniz yok.</p>}
        </Card>
      </>)}
    </div>
  );
}
