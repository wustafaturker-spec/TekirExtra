"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { RefreshCw, LineChart } from "lucide-react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { EndeksGrafigi } from "@/components/endeks-grafigi";
import { platformApi } from "@/lib/platform-api";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";

interface Seri {
  kod: string; evdsKodu: string; ad: string; siklik: string; bazYili: string | null; kaynak: string; etkin: boolean; sira: number;
  oncekiSeriKodu: string | null; zincirKatsayisi: string | null; zincirDonemi: string | null;
  sonCekimAt: string | null; sonBasariliAt: string | null; sonDonem: string | null; sonHata: string | null;
  degerSayisi: number; ilkDonem: string | null;
}
interface Liste { anahtarTanimli: boolean; seriler: Seri[] }
interface Degerler {
  degerler: { donem: string; deger: string; kaynak: string; alindiAt: string }[];
  revizyonlar: { donem: string; eskiDeger: string; yeniDeger: string; eskiKaynak: string; yeniKaynak: string; degistiAt: string }[];
}
interface CekimSonucu { kod: string; basarili: boolean; hata?: string; yeni?: number; revize?: number }

const ay = (d: string | null) => (d ? d.slice(0, 7) : "—");
const zaman = (d: string | null) => (d ? new Date(d).toLocaleString("tr-TR") : "—");
const sayi = (s: string) => Number(s).toLocaleString("tr-TR", { maximumFractionDigits: 4 });
const ozet = (s: CekimSonucu[]) => s.map((x) => x.basarili ? `${x.kod}: ${x.yeni ?? 0} yeni, ${x.revize ?? 0} revizyon` : `${x.kod}: ${x.hata}`).join(" · ");

/** END-26: EVDS verisi globaldir ve yalnız platformdan yönetilir. Seri silinmez, durdurulur. */
export default function PlatformEndeksler() {
  const { veri, yukleniyor, hata: listeHatasi, yenile } = usePlatformVerisi<Liste>("/platform/endeksler");
  const [secili, setSecili] = useState<string | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islem, setIslem] = useState(false);

  async function calistir(is: () => Promise<string>) {
    if (islem) return;
    setIslem(true); setHata(""); setBasari("");
    try { setBasari(await is()); yenile(); }
    catch (h) { setHata(h instanceof Error ? h.message : "İşlem yapılamadı."); }
    finally { setIslem(false); }
  }
  const cek = (kod?: string, gecmisYil?: number) => calistir(async () => {
    const r = await platformApi<{ sonuclar: CekimSonucu[] }>("/platform/endeksler/cek", { method: "POST", body: JSON.stringify({ ...(kod ? { kod } : {}), ...(gecmisYil ? { gecmisYil } : {}) }) });
    return ozet(r.sonuclar) || "Çekilecek etkin seri yok.";
  });
  const seri = veri?.seriler.find((s) => s.kod === secili) ?? null;

  return <>
    <PageHeader title="Endeks verileri" subtitle="TÜFE, Yİ-ÜFE gibi aylık endeksler TCMB EVDS'den bütün firmalar için tek kopya olarak çekilir; firmalar yalnız okur."
      actions={<Button variant="primary" disabled={islem || !veri?.anahtarTanimli} onClick={() => void cek()}><RefreshCw size={16} aria-hidden="true" /> Etkin serileri şimdi çek</Button>} />
    <Alert tone="error">{hata || listeHatasi}</Alert>
    <Alert tone="success">{basari}</Alert>
    {veri && !veri.anahtarTanimli && <Alert tone="warning">EVDS API anahtarı (TCMB_EVDS_API_KEY) sunucuda tanımlı değil; çekim ve sınama yapılamaz.</Alert>}
    <div className="platform-workflow"><LineChart size={20} aria-hidden="true" /><div><strong>Worker serileri günde dört kez çeker.</strong><span>Son açıklanan dönemden 6 ay geriye bakılır; TÜİK revizyonları revizyon geçmişine düşer. Kur karşılaştırması TCMB günlük kurlarından yapılır, burada yönetilmez.</span></div></div>

    <Card title="Seriler" pad={false}>
      <div className="platform-list-caption" role="status">{yukleniyor ? "Seriler yükleniyor…" : `${veri?.seriler.length ?? 0} seri`}</div>
      <TableWrap className="platform-responsive-table">
        <thead><tr><th>Kod</th><th>Seri</th><th>Baz</th><th>Son dönem</th><th>Değer</th><th>Son çekim</th><th>Durum</th></tr></thead>
        <tbody>
          {veri?.seriler.map((s) => (
            <tr key={s.kod} className="row-link" tabIndex={0} role="button" aria-label={`${s.ad} ayrıntısı`} aria-pressed={secili === s.kod}
              onClick={() => setSecili(s.kod)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSecili(s.kod); } }}>
              <td data-label="Kod"><strong>{s.kod}</strong></td>
              <td data-label="Seri">{s.ad}<div className="muted">{s.evdsKodu}</div></td>
              <td data-label="Baz">{s.bazYili ?? "—"}</td>
              <td data-label="Son dönem">{ay(s.sonDonem)}</td>
              <td data-label="Değer">{s.degerSayisi}<div className="muted">{s.ilkDonem ? `${ay(s.ilkDonem)}'dan` : ""}</div></td>
              <td data-label="Son çekim">{zaman(s.sonCekimAt)}{s.sonHata && <div><Badge variant="danger">{s.sonHata}</Badge></div>}</td>
              <td data-label="Durum"><Badge variant={s.etkin ? "success" : "neutral"}>{s.etkin ? "Etkin" : "Durduruldu"}</Badge></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Card>

    {seri && <SeriAyrintisi key={seri.kod} seri={seri} seriler={veri!.seriler} islem={islem} calistir={calistir} cek={cek} />}
    <YeniSeri seriler={veri?.seriler ?? []} islem={islem} calistir={calistir} anahtarVar={Boolean(veri?.anahtarTanimli)} />
  </>;
}

function SeriAyrintisi({ seri, seriler, islem, calistir, cek }: { seri: Seri; seriler: Seri[]; islem: boolean; calistir: (is: () => Promise<string>) => Promise<void>; cek: (kod?: string, yil?: number) => Promise<void> }) {
  const kimlik = useId();
  const { veri, yukleniyor, yenile } = usePlatformVerisi<Degerler>(`/platform/endeksler/${encodeURIComponent(seri.kod)}/degerler`);
  const [ad, setAd] = useState(seri.ad), [bazYili, setBazYili] = useState(seri.bazYili ?? ""), [kaynak, setKaynak] = useState(seri.kaynak);
  const [sira, setSira] = useState(String(seri.sira)), [onceki, setOnceki] = useState(seri.oncekiSeriKodu ?? ""), [yil, setYil] = useState("10");
  useEffect(() => { if (!islem) yenile(); }, [islem, yenile]);
  const son36 = (veri?.degerler ?? []).slice(0, 36).reverse();

  const kaydet = (e: FormEvent) => {
    e.preventDefault();
    void calistir(async () => {
      await platformApi(`/platform/endeksler/${encodeURIComponent(seri.kod)}`, { method: "PATCH", body: JSON.stringify({ ad, bazYili: bazYili.trim() || null, kaynak, sira: Number(sira), oncekiSeriKodu: onceki || null }) });
      return `${seri.kod} güncellendi.`;
    });
  };
  const etkinlik = () => calistir(async () => {
    await platformApi(`/platform/endeksler/${encodeURIComponent(seri.kod)}`, { method: "PATCH", body: JSON.stringify({ etkin: !seri.etkin }) });
    return seri.etkin ? `${seri.kod} durduruldu; mevcut değerler okunmaya devam eder.` : `${seri.kod} yeniden etkin.`;
  });

  return <Card title={`${seri.kod} — ${seri.ad}`} actions={<div className="row" style={{ gap: ".5rem" }}>
    <Button disabled={islem} onClick={() => void cek(seri.kod)}>Şimdi çek</Button>
    <Button variant={seri.etkin ? "danger" : "primary"} disabled={islem} onClick={() => void etkinlik()}>{seri.etkin ? "Durdur" : "Etkinleştir"}</Button>
  </div>}>
    <form className="stack" onSubmit={kaydet}>
      <div className="form-grid">
        <Field label="Ad" htmlFor={`${kimlik}-ad`}><Input id={`${kimlik}-ad`} value={ad} onChange={(e) => setAd(e.target.value)} maxLength={160} required /></Field>
        <Field label="Baz yılı" htmlFor={`${kimlik}-baz`}><Input id={`${kimlik}-baz`} value={bazYili} onChange={(e) => setBazYili(e.target.value)} maxLength={20} placeholder="2025=100" /></Field>
        <Field label="Kaynak" htmlFor={`${kimlik}-kaynak`}><Input id={`${kimlik}-kaynak`} value={kaynak} onChange={(e) => setKaynak(e.target.value)} maxLength={60} /></Field>
        <Field label="Sıra" htmlFor={`${kimlik}-sira`}><Input id={`${kimlik}-sira`} type="number" min={0} max={10000} value={sira} onChange={(e) => setSira(e.target.value)} /></Field>
        <Field label="Zincirlenecek önceki seri (baz yılı değişimi)" htmlFor={`${kimlik}-onceki`}>
          <Select id={`${kimlik}-onceki`} value={onceki} onChange={(e) => setOnceki(e.target.value)}>
            <option value="">— Yok —</option>
            {seriler.filter((s) => s.kod !== seri.kod).map((s) => <option key={s.kod} value={s.kod}>{s.kod} · {s.ad}</option>)}
          </Select>
        </Field>
      </div>
      {seri.oncekiSeriKodu && <p className="muted">Zincir: {seri.zincirKatsayisi ? `${ay(seri.zincirDonemi)} ortak ayında katsayı ${sayi(seri.zincirKatsayisi)}; bu aydan önceki dönemler ${seri.oncekiSeriKodu} serisinden taşınır.` : `${seri.oncekiSeriKodu} ile ortak ay bulunamadı; zincir kurulmadı.`}</p>}
      <div><Button type="submit" variant="primary" disabled={islem}>Kaydet</Button></div>
    </form>
    <div className="row" style={{ gap: ".5rem", alignItems: "end", marginTop: "1rem" }}>
      <Field label="Geçmişi doldur (yıl)" htmlFor={`${kimlik}-yil`}><Input id={`${kimlik}-yil`} type="number" min={1} max={40} value={yil} onChange={(e) => setYil(e.target.value)} style={{ width: 100 }} /></Field>
      <Button disabled={islem || !(Number(yil) >= 1 && Number(yil) <= 40)} onClick={() => void cek(seri.kod, Number(yil))}>Geçmişi doldur</Button>
    </div>
    <h3 className="card__title" style={{ marginTop: "1.25rem" }}>Son 36 ay</h3>
    {yukleniyor ? <p className="muted">Değerler yükleniyor…</p> : son36.length
      ? <EndeksGrafigi baslik={`${seri.ad} son 36 ay`} etiketler={son36.map((d) => ay(d.donem))} seriler={[{ ad: seri.ad, renk: 1, degerler: son36.map((d) => Number(d.deger)) }]} />
      : <p className="muted">Henüz değer yok; “Şimdi çek” ile doldurun.</p>}
    {veri && veri.degerler.length > 0 && <TableWrap className="platform-responsive-table">
      <thead><tr><th>Dönem</th><th>Değer</th><th>Kaynak</th><th>Alındı</th></tr></thead>
      <tbody>{veri.degerler.slice(0, 24).map((d) => <tr key={d.donem}><td data-label="Dönem">{ay(d.donem)}</td><td data-label="Değer">{sayi(d.deger)}</td><td data-label="Kaynak"><Badge variant={d.kaynak === "elle" ? "warning" : "neutral"}>{d.kaynak === "elle" ? "Elle" : "EVDS"}</Badge></td><td data-label="Alındı">{zaman(d.alindiAt)}</td></tr>)}</tbody>
    </TableWrap>}
    <h3 className="card__title" style={{ marginTop: "1.25rem" }}>Revizyon geçmişi</h3>
    {veri?.revizyonlar.length ? <TableWrap className="platform-responsive-table">
      <thead><tr><th>Dönem</th><th>Eski</th><th>Yeni</th><th>Zaman</th></tr></thead>
      <tbody>{veri.revizyonlar.map((r, i) => <tr key={i}><td data-label="Dönem">{ay(r.donem)}</td><td data-label="Eski">{sayi(r.eskiDeger)} ({r.eskiKaynak})</td><td data-label="Yeni">{sayi(r.yeniDeger)} ({r.yeniKaynak})</td><td data-label="Zaman">{zaman(r.degistiAt)}</td></tr>)}</tbody>
    </TableWrap> : <p className="muted">Kaynak geçmiş bir dönemi değiştirmedi.</p>}
  </Card>;
}

function YeniSeri({ seriler, islem, calistir, anahtarVar }: { seriler: Seri[]; islem: boolean; calistir: (is: () => Promise<string>) => Promise<void>; anahtarVar: boolean }) {
  const kimlik = useId();
  const [kod, setKod] = useState(""), [evdsKodu, setEvdsKodu] = useState(""), [ad, setAd] = useState("");
  const [bazYili, setBazYili] = useState(""), [kaynak, setKaynak] = useState("TÜİK"), [onceki, setOnceki] = useState("");
  const [sinama, setSinama] = useState<{ evdsKodu: string; metin: string } | null>(null);

  const sina = () => calistir(async () => {
    const r = await platformApi<{ ayAdedi: number; ilkDonem: string; sonDonem: string; sonDeger: string }>("/platform/endeksler/sina", { method: "POST", body: JSON.stringify({ evdsKodu }) });
    const metin = `${evdsKodu.toUpperCase()}: son 24 ayda ${r.ayAdedi} değer; son dönem ${ay(r.sonDonem)} = ${sayi(r.sonDeger)}.`;
    setSinama({ evdsKodu: evdsKodu.trim().toUpperCase(), metin });
    return metin;
  });
  const ekle = (e: FormEvent) => {
    e.preventDefault();
    void calistir(async () => {
      await platformApi("/platform/endeksler", { method: "POST", body: JSON.stringify({ kod: kod.trim(), evdsKodu: evdsKodu.trim(), ad: ad.trim(), bazYili: bazYili.trim() || null, kaynak: kaynak.trim() || "TÜİK", oncekiSeriKodu: onceki || null }) });
      setKod(""); setEvdsKodu(""); setAd(""); setBazYili(""); setOnceki(""); setSinama(null);
      return `${kod.trim()} eklendi. Değerleri doldurmak için seriyi seçip “Şimdi çek” deyin.`;
    });
  };
  const sinandi = sinama?.evdsKodu === evdsKodu.trim().toUpperCase();

  return <Card title="Yeni seri">
    <form className="stack" onSubmit={ekle}>
      <p className="muted">EVDS seri kodunu önce sınayın; yalnız aylık seriler eklenir. Kod firmaların ekranında ve yapay zekâ araçlarında kullanılır.</p>
      <div className="form-grid">
        <Field label="Kod" htmlFor={`${kimlik}-kod`}><Input id={`${kimlik}-kod`} value={kod} onChange={(e) => setKod(e.target.value.toUpperCase())} placeholder="TUFE_GIDA" maxLength={40} required pattern="[A-Z][A-Z0-9_]{1,39}" /></Field>
        <Field label="EVDS seri kodu" htmlFor={`${kimlik}-evds`}><Input id={`${kimlik}-evds`} value={evdsKodu} onChange={(e) => setEvdsKodu(e.target.value)} placeholder="TP.TUKFIY2025.01" maxLength={80} required /></Field>
        <Field label="Ad" htmlFor={`${kimlik}-ad`}><Input id={`${kimlik}-ad`} value={ad} onChange={(e) => setAd(e.target.value)} maxLength={160} required /></Field>
        <Field label="Baz yılı" htmlFor={`${kimlik}-baz`}><Input id={`${kimlik}-baz`} value={bazYili} onChange={(e) => setBazYili(e.target.value)} maxLength={20} placeholder="2025=100" /></Field>
        <Field label="Kaynak" htmlFor={`${kimlik}-kaynak`}><Input id={`${kimlik}-kaynak`} value={kaynak} onChange={(e) => setKaynak(e.target.value)} maxLength={60} /></Field>
        <Field label="Zincirlenecek önceki seri" htmlFor={`${kimlik}-onceki`}>
          <Select id={`${kimlik}-onceki`} value={onceki} onChange={(e) => setOnceki(e.target.value)}>
            <option value="">— Yok —</option>
            {seriler.map((s) => <option key={s.kod} value={s.kod}>{s.kod} · {s.ad}</option>)}
          </Select>
        </Field>
      </div>
      {sinama && <p className="muted">{sinama.metin}</p>}
      <div className="row" style={{ gap: ".5rem" }}>
        <Button disabled={islem || !anahtarVar || !evdsKodu.trim()} onClick={() => void sina()}>Sına</Button>
        <Button type="submit" variant="primary" disabled={islem || !sinandi}>Ekle</Button>
      </div>
      {!sinandi && evdsKodu.trim() && <p className="muted">Eklemeden önce bu EVDS kodunu sınayın.</p>}
    </form>
  </Card>;
}
