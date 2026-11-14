"use client";

import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { RefreshCw, LineChart } from "lucide-react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { EndeksGrafigi } from "@/components/endeks-grafigi";
import { platformApi } from "@/lib/platform-api";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";

interface Seri {
  kod: string; evdsKodu: string; ad: string; siklik: string; kaynakSiklik: "aylik" | "gunluk"; tur: "endeks" | "kur"; bazYili: string | null; kaynak: string; etkin: boolean; sira: number;
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
    <div className="platform-workflow"><LineChart size={20} aria-hidden="true" /><div><strong>Worker serileri günde dört kez çeker.</strong><span>Son açıklanan dönemden 6 ay geriye bakılır; TÜİK revizyonları revizyon geçmişine düşer. Döviz kurları EVDS'den aylık ortalama olarak gelir; içinde bulunulan ayın değeri her çekimde güncellenir ve revizyon sayılmaz.</span></div></div>

    <Card title="Seriler" pad={false}>
      <div className="platform-list-caption" role="status">{yukleniyor ? "Seriler yükleniyor…" : `${veri?.seriler.length ?? 0} seri`}</div>
      <TableWrap className="platform-responsive-table">
        <thead><tr><th>Kod</th><th>Seri</th><th>Baz</th><th>Son dönem</th><th>Değer</th><th>Son çekim</th><th>Durum</th></tr></thead>
        <tbody>
          {veri?.seriler.map((s) => (
            <tr key={s.kod} className="row-link" tabIndex={0} role="button" aria-label={`${s.ad} ayrıntısı`} aria-pressed={secili === s.kod}
              onClick={() => setSecili(s.kod)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSecili(s.kod); } }}>
              <td data-label="Kod"><strong>{s.kod}</strong></td>
              <td data-label="Seri">{s.ad}<div className="muted">{s.evdsKodu}{s.kaynakSiklik === "gunluk" ? " · günlük → aylık ortalama" : ""}</div>{s.tur === "kur" && <Badge variant="info">Kur</Badge>}</td>
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
  const [kaynakSiklik, setKaynakSiklik] = useState<"aylik" | "gunluk">("aylik"), [tur, setTur] = useState<"endeks" | "kur">("endeks");
  const [sinama, setSinama] = useState<{ evdsKodu: string; siklik: string; metin: string } | null>(null);

  const sina = (kodu = evdsKodu, siklik = kaynakSiklik) => calistir(async () => {
    const r = await platformApi<{ ayAdedi: number; ilkDonem: string; sonDonem: string; sonDeger: string }>("/platform/endeksler/sina", { method: "POST", body: JSON.stringify({ evdsKodu: kodu, kaynakSiklik: siklik }) });
    const metin = `${kodu.toUpperCase()}${siklik === "gunluk" ? " (aylık ortalama)" : ""}: son 24 ayda ${r.ayAdedi} değer; son dönem ${ay(r.sonDonem)} = ${sayi(r.sonDeger)}.`;
    setSinama({ evdsKodu: kodu.trim().toUpperCase(), siklik, metin });
    return metin;
  });
  /** Seçiciden gelen seri formu doldurur ve hemen sınanır; kod önerisi düzenlenebilir. */
  const secildi = (s: EvdsSeri, g: EvdsGrup) => {
    const grupAdi = g.ad.replace(/\s*\([^)]*\)/g, "").trim();
    const onerilenKod = s.kod.toUpperCase().replace(/^TP\./, "").replace(/[^A-Z0-9]+/g, "_").replace(/^[^A-Z]+/, "").slice(0, 40) || "SERI";
    setEvdsKodu(s.kod); setKod(onerilenKod);
    setAd(`${grupAdi} — ${s.ad}`.slice(0, 160));
    setBazYili(/\((\d{4}(?:-\d{4})?=100)\)/.exec(g.ad)?.[1] ?? "");
    if (g.kaynak) setKaynak(g.kaynak.slice(0, 60));
    // Günlük seri (döviz kuru) EVDS'de aylık ortalamaya çevrilerek çekilir.
    const siklik = s.siklik === "GÜNLÜK" ? "gunluk" : "aylik";
    setKaynakSiklik(siklik); setTur(/^TP\.DK\./i.test(s.kod) ? "kur" : "endeks");
    void sina(s.kod, siklik);
  };
  const ekle = (e: FormEvent) => {
    e.preventDefault();
    void calistir(async () => {
      await platformApi("/platform/endeksler", { method: "POST", body: JSON.stringify({ kod: kod.trim(), evdsKodu: evdsKodu.trim(), ad: ad.trim(), bazYili: bazYili.trim() || null, kaynak: kaynak.trim() || "TÜİK", oncekiSeriKodu: onceki || null, kaynakSiklik, tur }) });
      setKod(""); setEvdsKodu(""); setAd(""); setBazYili(""); setOnceki(""); setSinama(null); setKaynakSiklik("aylik"); setTur("endeks");
      return `${kod.trim()} eklendi. Değerleri doldurmak için seriyi seçip “Şimdi çek” deyin.`;
    });
  };
  const sinandi = sinama?.evdsKodu === evdsKodu.trim().toUpperCase() && sinama.siklik === kaynakSiklik;

  return <Card title="Yeni seri">
    {anahtarVar && <EvdsSecici onSec={secildi} />}
    <form className="stack" onSubmit={ekle}>
      <p className="muted">EVDS seri kodunu önce sınayın. Aylık seriler olduğu gibi, günlük seriler (döviz kurları) aylık ortalamaya çevrilerek saklanır. Kod firmaların ekranında ve yapay zekâ araçlarında kullanılır.</p>
      <div className="form-grid">
        <Field label="Kod" htmlFor={`${kimlik}-kod`}><Input id={`${kimlik}-kod`} value={kod} onChange={(e) => setKod(e.target.value.toUpperCase())} placeholder="TUFE_GIDA" maxLength={40} required pattern="[A-Z][A-Z0-9_]{1,39}" /></Field>
        <Field label="EVDS seri kodu" htmlFor={`${kimlik}-evds`}><Input id={`${kimlik}-evds`} value={evdsKodu} onChange={(e) => setEvdsKodu(e.target.value)} placeholder="TP.TUKFIY2025.01" maxLength={80} required /></Field>
        <Field label="Ad" htmlFor={`${kimlik}-ad`}><Input id={`${kimlik}-ad`} value={ad} onChange={(e) => setAd(e.target.value)} maxLength={160} required /></Field>
        <Field label="Baz yılı" htmlFor={`${kimlik}-baz`}><Input id={`${kimlik}-baz`} value={bazYili} onChange={(e) => setBazYili(e.target.value)} maxLength={20} placeholder="2025=100" /></Field>
        <Field label="Kaynak" htmlFor={`${kimlik}-kaynak`}><Input id={`${kimlik}-kaynak`} value={kaynak} onChange={(e) => setKaynak(e.target.value)} maxLength={60} /></Field>
        <Field label="EVDS'deki sıklık" htmlFor={`${kimlik}-siklik`}>
          <Select id={`${kimlik}-siklik`} value={kaynakSiklik} onChange={(e) => setKaynakSiklik(e.target.value as "aylik" | "gunluk")}>
            <option value="aylik">Aylık seri</option>
            <option value="gunluk">Günlük seri → aylık ortalama</option>
          </Select>
        </Field>
        <Field label="Tür" htmlFor={`${kimlik}-tur`}>
          <Select id={`${kimlik}-tur`} value={tur} onChange={(e) => setTur(e.target.value as "endeks" | "kur")}>
            <option value="endeks">Endeks</option>
            <option value="kur">Kur (içinde bulunulan ay kısmi ortalama)</option>
          </Select>
        </Field>
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

interface EvdsGrup { kod: string; ad: string; siklik: string; baslangic: string | null; bitis: string | null; kaynak: string | null; arsiv: boolean }
interface EvdsSeri { kod: string; ad: string; siklik: string; baslangic: string | null; bitis: string | null; seviye: number | null; ustKod: string | null; kayitliKod: string | null }
const normal = (v: string) => v.toLocaleLowerCase("tr-TR");
const aralik = (b: string | null, s: string | null) => (b || s ? `${b?.slice(3) ?? "?"} – ${s?.slice(3) ?? "?"}` : "—");

/**
 * END-26: EVDS kataloğunda arama. Grup ara → grup seç → seriye tıkla; form
 * dolar ve kod hemen sınanır. Yalnız aylık seriler seçilebilir; katalogda
 * kayıtlı olanlar işaretlidir. Katalog sunucuda 24 saat önbelleklidir.
 */
function EvdsSecici({ onSec }: { onSec: (s: EvdsSeri, g: EvdsGrup) => void }) {
  const kimlik = useId();
  const [ara, setAra] = useState(""), [gecikmeli, setGecikmeli] = useState(""), [arsiv, setArsiv] = useState(false);
  const [grup, setGrup] = useState<EvdsGrup | null>(null);
  const [seriAra, setSeriAra] = useState("");
  useEffect(() => { const t = setTimeout(() => setGecikmeli(ara.trim()), 300); return () => clearTimeout(t); }, [ara]);
  const gruplar = usePlatformVerisi<{ toplam: number; gruplar: EvdsGrup[] }>(gecikmeli.length >= 2 ? `/platform/endeksler/evds/gruplar?ara=${encodeURIComponent(gecikmeli)}${arsiv ? "&arsiv=1" : ""}` : null);
  const seriler = usePlatformVerisi<{ seriler: EvdsSeri[] }>(grup ? `/platform/endeksler/evds/gruplar/${encodeURIComponent(grup.kod)}/seriler` : null);
  const kelimeler = normal(seriAra.trim()).split(/\s+/).filter(Boolean);
  const gorunenSeriler = (seriler.veri?.seriler ?? []).filter((s) => kelimeler.every((k) => normal(`${s.ad} ${s.kod}`).includes(k)));
  const satirTusu = (is: () => void) => (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); is(); } };

  return <details className="evds-secici" open>
    <summary className="card__title">EVDS'de seri ara</summary>
    {!grup ? <div className="stack">
      <div className="row" style={{ gap: "1rem", alignItems: "end", flexWrap: "wrap" }}>
        <Field label="Veri grubu ara (en az 2 harf)" htmlFor={`${kimlik}-ara`}><Input id={`${kimlik}-ara`} value={ara} onChange={(e) => setAra(e.target.value)} placeholder="ör. tüketici fiyat, üretici, konut" maxLength={100} /></Field>
        <label className="endeks-secim"><span><input type="checkbox" checked={arsiv} onChange={(e) => setArsiv(e.target.checked)} /> Arşiv gruplarını da göster</span></label>
      </div>
      <Alert tone="error">{gruplar.hata}</Alert>
      {gecikmeli.length >= 2 && <div className="platform-list-caption" role="status">{gruplar.yukleniyor ? "EVDS kataloğu aranıyor…" : gruplar.veri ? `${gruplar.veri.toplam} grup${gruplar.veri.toplam > gruplar.veri.gruplar.length ? `, ilk ${gruplar.veri.gruplar.length} gösteriliyor` : ""}` : ""}</div>}
      {gruplar.veri && gruplar.veri.gruplar.length > 0 && <TableWrap className="platform-responsive-table evds-secici__tablo">
        <thead><tr><th>Veri grubu</th><th>Sıklık</th><th>Dönem</th><th>Kaynak</th></tr></thead>
        <tbody>{gruplar.veri.gruplar.map((g) => (
          <tr key={g.kod} className="row-link" tabIndex={0} role="button" aria-label={`${g.ad} serilerini göster`} onClick={() => { setGrup(g); setSeriAra(""); }} onKeyDown={satirTusu(() => { setGrup(g); setSeriAra(""); })}>
            <td data-label="Veri grubu">{g.ad}{g.arsiv && <> <Badge variant="neutral">Arşiv</Badge></>}<div className="muted">{g.kod}</div></td>
            <td data-label="Sıklık">{g.siklik === "AYLIK" ? g.siklik : <span className="muted">{g.siklik || "—"}</span>}</td>
            <td data-label="Dönem">{aralik(g.baslangic, g.bitis)}</td>
            <td data-label="Kaynak">{g.kaynak ?? "—"}</td>
          </tr>))}</tbody>
      </TableWrap>}
    </div> : <div className="stack">
      <div className="between" style={{ flexWrap: "wrap", gap: ".5rem" }}>
        <div><strong>{grup.ad}</strong><div className="muted">{grup.kod} · {grup.siklik} · {aralik(grup.baslangic, grup.bitis)}</div></div>
        <Button size="sm" onClick={() => setGrup(null)}>← Gruplara dön</Button>
      </div>
      <Field label="Serilerde süz" htmlFor={`${kimlik}-seri`}><Input id={`${kimlik}-seri`} value={seriAra} onChange={(e) => setSeriAra(e.target.value)} placeholder="ör. gıda, genel" maxLength={100} /></Field>
      <Alert tone="error">{seriler.hata}</Alert>
      <div className="platform-list-caption" role="status">{seriler.yukleniyor ? "Seriler yükleniyor…" : `${gorunenSeriler.length} seri · aylık ve günlük (aylık ortalamayla) kayıtlı olmayan seriler seçilebilir`}</div>
      {gorunenSeriler.length > 0 && <TableWrap className="platform-responsive-table evds-secici__tablo">
        <thead><tr><th>Seri</th><th>EVDS kodu</th><th>Sıklık</th><th>Dönem</th><th>Durum</th></tr></thead>
        <tbody>{gorunenSeriler.map((s) => {
          const secilir = (s.siklik === "AYLIK" || s.siklik === "GÜNLÜK") && !s.kayitliKod;
          const sec = () => onSec(s, grup);
          return <tr key={s.kod} className={secilir ? "row-link" : undefined} tabIndex={secilir ? 0 : undefined} role={secilir ? "button" : undefined} aria-disabled={!secilir || undefined}
            aria-label={secilir ? `${s.ad} serisini forma al` : undefined} onClick={secilir ? sec : undefined} onKeyDown={secilir ? satirTusu(sec) : undefined}>
            <td data-label="Seri" style={{ paddingLeft: s.seviye && s.seviye > 1 ? `${0.75 + Math.min(s.seviye - 1, 4) * 0.9}rem` : undefined }}>{s.ad}</td>
            <td data-label="EVDS kodu"><code>{s.kod}</code></td>
            <td data-label="Sıklık">{s.siklik || "—"}</td>
            <td data-label="Dönem">{aralik(s.baslangic, s.bitis)}</td>
            <td data-label="Durum">{s.kayitliKod ? <Badge variant="success">Kayıtlı: {s.kayitliKod}</Badge> : !secilir ? <Badge variant="neutral">Desteklenmiyor</Badge> : s.siklik === "GÜNLÜK" ? <Badge variant="info">Seç (aylık ortalama)</Badge> : <Badge variant="info">Seç</Badge>}</td>
          </tr>;
        })}</tbody>
      </TableWrap>}
    </div>}
  </details>;
}
