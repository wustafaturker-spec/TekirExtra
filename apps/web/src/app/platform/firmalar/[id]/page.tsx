"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { FirmaYonet } from "@/components/platform-firma-yonet";
import { FirmaIstisnalari } from "@/components/platform-firma-istisnalari";
import { FirmaEkHacmi } from "@/components/platform-firma-ek-hacmi";
import { useKaydedilmemisUyarisi } from "@/lib/use-kaydedilmemis-uyarisi";
import { platformApi, PlatformApiHata } from "@/lib/platform-api";
import { type Firma, type FirmaListesi, DURUM, tarih } from "@/lib/platform-firmalar";
import { GOREV_DURUMU, type GorevListesi } from "@/lib/platform-gorevleri";
import { OLAY_ADI } from "@/lib/mevzuat-gorunum";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";

interface Takip {
  sorumluId: string | null; sorumluAdi: string | null; sorumluUygun: boolean | null;
  durum: "acik" | "bekliyor" | "tamamlandi"; sonrakiGorusme: string | null; surum: number;
  gecikti: boolean; guncelleyen: string | null; updatedAt: string | null;
}
interface Sayfali<T> { kayitlar: T[]; toplam: number; sayfa: number; sayfaBoyutu: number }
interface Not { id: string; metin: string; yazar: string; zaman: string }
interface Olay { id: string; olay: string; zaman: string; kullanici: string; detay: { gorevId?: string; notId?: string; onceki?: { durum?: string; sorumluId?: string; sonrakiGorusme?: string }; yeni?: { durum?: string; sorumluId?: string; sonrakiGorusme?: string } } | null }
interface DuyuruGecmisi { kayitlar: { id:string;baslik:string;durum:string;surum:number;baslangic:string;bitis:string;hedefKullanici:number;gosterim:number;okudum:number;tiklama:number }[]; toplam:number;sayfa:number;sayfaBoyutu:number;zaman:string }
const TAKIP_DURUMU = { acik: "Açık", bekliyor: "Yanıt bekleniyor", tamamlandi: "Tamamlandı" };
const zaman = (v: string) => new Date(v).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });

function donusAdresi(v: string | null) {
  if (!v) return "/platform/firmalar";
  try {
    const url = new URL(v, "https://yerel.invalid");
    if (url.origin === "https://yerel.invalid" && url.pathname === "/platform/firmalar") return `${url.pathname}${url.search}`;
  } catch { /* Geçersiz dönüş adresinde firma listesi kullanılır. */ }
  return "/platform/firmalar";
}

function FirmaDetayi() {
  const { id } = useParams<{ id: string }>();
  const parametreler = useSearchParams();
  const gecerli = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const firma = usePlatformVerisi<FirmaListesi>(gecerli ? `/platform/firmalar/sayfali?firma=${encodeURIComponent(id)}&sayfaBoyutu=1` : null);
  const [sonFirma, setSonFirma] = useState<{ id: string; firma: Firma } | null>(null);
  useEffect(() => { if (firma.veri?.kayitlar[0]) setSonFirma({ id, firma: firma.veri.kayitlar[0] }); }, [id, firma.veri]);
  // Yenileme sırasında çalışma alanını sökmeyerek diğer bölümlerdeki taslakları koru.
  const f = firma.veri?.kayitlar[0] ?? ((firma.yukleniyor || firma.hata) && sonFirma?.id === id ? sonFirma.firma : null);
  const donus = donusAdresi(parametreler.get("donus"));
  if (!gecerli || !f) return <>
    <PageHeader title="Firma detayı" actions={<Link className="btn btn--ghost" href={donus}>Firma listesine dön</Link>} />
    {firma.yukleniyor ? <p role="status">Firma yükleniyor…</p> : <Card><Alert tone="error">{firma.hata || "Firma bulunamadı."}</Alert>{firma.hata && <Button onClick={firma.yenile}>Tekrar dene</Button>}</Card>}
  </>;
  return <>{firma.hata && <Alert tone="warning">Firma bilgileri yenilenemedi. Son başarılı kayıt gösteriliyor; çalışma taslaklarınız korunuyor. <Button onClick={firma.yenile}>Tekrar dene</Button></Alert>}<FirmaCalismaAlani key={f.tenantId} firma={f} donus={donus} yenile={firma.yenile} /></>;
}

export default function FirmaDetaySayfasi() {
  return <Suspense fallback={<p role="status">Firma yükleniyor…</p>}><FirmaDetayi /></Suspense>;
}

function FirmaCalismaAlani({ firma: f, donus, yenile }: { firma: Firma; donus: string; yenile: () => void }) {
  const [basari, setBasari] = useState("");
  const [takipYenileme, setTakipYenileme] = useState(0);
  const tamamlandi = (mesaj: string) => { setBasari(mesaj); yenile(); setTakipYenileme((v) => v + 1); };
  return <>
    <PageHeader title={f.unvan} subtitle={`${f.vkn.length === 11 ? "TCKN" : "VKN"} ${f.vkn} · Kayıt ${tarih(f.kayitTarihi)}`} actions={<div className="platform-row-actions"><Link className="btn btn--ghost" href={donus}>Firma listesine dön</Link><Button onClick={yenile}>Firma bilgilerini yenile</Button></div>} />
    <Alert tone="success">{basari}</Alert>
    <nav className="platform-section-nav" aria-label="Firma bölümleri"><a href="#firma-ozeti">Genel bilgiler</a><Link href={`/platform/istatistikler?firma=${f.tenantId}`}>Kullanım istatistikleri</Link><a href="#firma-takibi">Takip</a><a href="#firma-notlari">İç notlar</a><a href="#firma-gorevleri">Görevler</a><a href="#firma-abonelik">Abonelik ve ödemeler</a><a href="#firma-duyurular">Duyurular</a><a href="#firma-olaylari">İşlem geçmişi</a></nav>
    <Card id="firma-ozeti" title="Genel bilgiler"><dl className="platform-firma-summary">
      <div><dt>Abonelik</dt><dd><Badge variant={DURUM[f.durum]?.ton ?? "neutral"}>{DURUM[f.durum]?.ad ?? f.durum}</Badge> · {f.planAdi}</dd></div>
      <div><dt>Dönem sonu</dt><dd>{tarih(f.donemSonu)}</dd></div>
      <div><dt>Aktif kullanıcı hesabı</dt><dd>{f.aktifKullanici}</dd></div>
      <div><dt>Son giriş</dt><dd>{f.sonGiris ? zaman(f.sonGiris) : "Henüz giriş yok"}</dd></div>
      <div><dt>e-Belge bağlantısı</dt><dd>{f.ebelgeSaglayici ?? "Aktif bağlantı yok"}</dd></div>
      <div><dt>Bağlantı uyarısı</dt><dd>{f.baglantiHatali ? <Link href="/platform/sistem-sagligi">Bağlantı hatası var · Sistem sağlığında incele</Link> : "Bildirilen bağlantı hatası yok"}</dd></div>
    </dl>{f.askiyaAlinacak && <Alert tone="warning">Ödemesi 15 günden fazla gecikmiş. Ödeme ve abonelik geçmişini inceleyin.</Alert>}
      {f.destek && <p className="subtle">Destek izni {zaman(f.destek.izinBitis)} tarihine kadar geçerli.{f.destek.acikOturum ? ` Açık oturum: ${f.destek.acikOturum.kisi}.` : ""} Destek oturumlarını firma listesinden yönetebilirsiniz.</p>}
    </Card>
    <VergiNumarasiDegisikligi firmaId={f.tenantId} mevcut={f.vkn} onTamam={tamamlandi} />
    <TakipBolumu firmaId={f.tenantId} onTamam={tamamlandi} />
    <Notlar firmaId={f.tenantId} onTamam={tamamlandi} />
    <FirmaGorevleri firmaId={f.tenantId} />
    <section id="firma-abonelik" aria-label="Abonelik ve ödemeler"><h2>Abonelik ve ödemeler</h2><FirmaYonet firma={f} sayfada onKapat={() => undefined} onTamam={tamamlandi} /></section>
    <FirmaIstisnalari tenantId={f.tenantId} />
    <FirmaDuyurulari firmaId={f.tenantId} />
    <FirmaEkHacmi tenantId={f.tenantId} />
    <FirmaOlaylari key={takipYenileme} firmaId={f.tenantId} />
  </>;
}

function VergiNumarasiDegisikligi({ firmaId, mevcut, onTamam }: { firmaId: string; mevcut: string; onTamam: (mesaj: string) => void }) {
  const [yeni, setYeni] = useState("");
  const [destekTalepNo, setDestekTalepNo] = useState("");
  const [not, setNot] = useState("");
  const [hata, setHata] = useState("");
  const [islem, setIslem] = useState(false);
  async function kaydet(e: FormEvent) {
    e.preventDefault(); setHata(""); setIslem(true);
    try {
      await platformApi(`/platform/firmalar/${firmaId}/vergi-numarasi`, { method: "POST", body: JSON.stringify({ yeniVkn: yeni, destekTalepNo: destekTalepNo.trim(), dogrulamaNotu: not.trim() }) });
      setYeni(""); setDestekTalepNo(""); setNot(""); onTamam("Firma vergi numarası destek kaydıyla doğrulanıp değiştirildi.");
    } catch (err) { setHata(err instanceof Error ? err.message : "Vergi numarası değiştirilemedi."); }
    finally { setIslem(false); }
  }
  return <Card title="VKN / TCKN değişikliği">
    <p className="subtle">Mevcut numara: <span className="mono">{mevcut}</span>. Yalnızca firma talebi doğrulandıktan sonra kullanın. İşlem denetim geçmişine kaydedilir.</p>
    <Alert tone="error">{hata}</Alert>
    <form className="stack" onSubmit={(e) => void kaydet(e)}>
      <Field label="Yeni VKN / TCKN"><Input value={yeni} onChange={(e) => setYeni(e.target.value.replace(/\D/g, "").slice(0, 11))} inputMode="numeric" required minLength={10} maxLength={11} /></Field>
      <Field label="Destek talep / kayıt numarası"><Input value={destekTalepNo} onChange={(e) => setDestekTalepNo(e.target.value)} required minLength={3} maxLength={100} /></Field>
      <Field label="Doğrulama yöntemi ve dayanağı"><textarea className="input" rows={3} value={not} onChange={(e) => setNot(e.target.value)} required minLength={10} maxLength={1000} /></Field>
      <Button variant="primary" type="submit" disabled={islem || yeni === mevcut || yeni.length < 10 || destekTalepNo.trim().length < 3 || not.trim().length < 10}>{islem ? "Kaydediliyor…" : "Destek kaydını doğrula ve değiştir"}</Button>
    </form>
  </Card>;
}

function FirmaDuyurulari({ firmaId }: { firmaId: string }) {
  const [sayfa,setSayfa] = useState(1);
  const kaynak = usePlatformVerisi<DuyuruGecmisi>(`/platform/duyurular/firma/${firmaId}?sayfa=${sayfa}`);
  return <Card id="firma-duyurular" title="Duyuru geçmişi"><p className="subtle">Bu firmaya hedeflenen yayınlar ve firma kullanıcılarının benzersiz etkileşimleri. Zamanlar Türkiye saatidir.</p>
    {kaynak.yukleniyor && <p role="status">Duyuru geçmişi yükleniyor…</p>}
    {kaynak.hata && <Alert tone="error">{kaynak.hata} <Button onClick={kaynak.yenile}>Tekrar dene</Button></Alert>}
    {kaynak.veri && !kaynak.veri.kayitlar.length && <p>Bu firmaya hedeflenmiş duyuru yok.</p>}
    <TableWrap><thead><tr><th>Duyuru</th><th>Durum</th><th>Başlangıç</th><th>Bitiş</th><th>Hedef kullanıcı</th><th>Gösterim</th><th>Okudum</th><th>Tıklama</th></tr></thead><tbody>
      {kaynak.veri?.kayitlar.map((d) => <tr key={d.id}><td><Link href={`/platform/duyurular/${d.id}`}>{d.baslik} · Sürüm {d.surum}</Link></td><td>{d.durum === "yayinlandi" ? (new Date(d.baslangic) > new Date() ? "Planlı" : new Date(d.bitis) <= new Date() ? "Sona erdi" : "Yayında") : d.durum === "durduruldu" ? "Durduruldu" : "Arşiv"}</td><td>{zaman(d.baslangic)}</td><td>{zaman(d.bitis)}</td><td>{d.hedefKullanici}</td><td>{d.gosterim}</td><td>{d.okudum}</td><td>{d.tiklama}</td></tr>)}
    </tbody></TableWrap>
    <div className="platform-pagination"><span>{kaynak.veri?.toplam ?? 0} duyuru · Rapor zamanı {kaynak.veri ? zaman(kaynak.veri.zaman) : "—"}</span><div className="platform-row-actions"><Button disabled={sayfa===1} onClick={() => setSayfa(sayfa-1)}>Önceki</Button><Button disabled={!kaynak.veri || sayfa*25>=kaynak.veri.toplam} onClick={() => setSayfa(sayfa+1)}>Sonraki</Button></div></div>
  </Card>;
}

function TakipBolumu({ firmaId, onTamam }: { firmaId: string; onTamam: (mesaj: string) => void }) {
  const kaynak = usePlatformVerisi<Takip>(`/platform/firmalar/${firmaId}/takip`);
  return <Card id="firma-takibi" title="Firma takibi">
    {kaynak.yukleniyor ? <p role="status">Takip bilgileri yükleniyor…</p> : kaynak.hata || !kaynak.veri ? <Alert tone="error">{kaynak.hata || "Takip bilgisi alınamadı."} <Button onClick={kaynak.yenile}>Tekrar dene</Button></Alert> : <TakipFormu firmaId={firmaId} ilk={kaynak.veri} onTamam={onTamam} />}
  </Card>;
}

function TakipFormu({ firmaId, ilk, onTamam }: { firmaId: string; ilk: Takip; onTamam: (mesaj: string) => void }) {
  const [temel, setTemel] = useState(ilk);
  const alanlar = (t: Takip) => ({ sorumluId: t.sorumluId ?? "", durum: t.durum, sonrakiGorusme: t.sonrakiGorusme ?? "" });
  const [form, setForm] = useState(() => alanlar(ilk));
  const [islem, setIslem] = useState(false);
  const [hata, setHata] = useState("");
  const [cakisma, setCakisma] = useState(false);
  const [guncel, setGuncel] = useState<Takip | null>(null);
  const kisiler = usePlatformVerisi<{ id: string; adSoyad: string }[]>("/platform/firmalar/takip-sorumlulari");
  const degisti = JSON.stringify(form) !== JSON.stringify(alanlar(temel));
  useKaydedilmemisUyarisi(degisti);
  const uygun = !form.sorumluId || kisiler.veri?.some((k) => k.id === form.sorumluId);
  async function kaydet(e: FormEvent) {
    e.preventDefault();
    if (islem || cakisma || !uygun) return;
    setIslem(true); setHata("");
    try {
      const t = await platformApi<Takip>(`/platform/firmalar/${firmaId}/takip`, { method: "PATCH", body: JSON.stringify({ ...form, sorumluId: form.sorumluId || null, sonrakiGorusme: form.sonrakiGorusme || null, surum: temel.surum }) });
      setTemel(t); setForm(alanlar(t)); onTamam("Firma takibi kaydedildi.");
    } catch (e) { setHata(e instanceof Error ? e.message : "Kaydedilemedi."); setCakisma(e instanceof PlatformApiHata && e.durum === 409); }
    finally { setIslem(false); }
  }
  async function gunceliAl() {
    setIslem(true);
    try { setGuncel(await platformApi<Takip>(`/platform/firmalar/${firmaId}/takip`)); }
    catch (e) { setHata(e instanceof Error ? e.message : "Güncel kayıt alınamadı."); }
    finally { setIslem(false); }
  }
  return <>
    <Alert tone="error">{hata}</Alert>
    {temel.gecikti && <Alert tone="warning">Planlanan görüşme tarihi geçti.</Alert>}
    {temel.sorumluUygun === false && <Alert tone="warning">Sorumlu pasif veya platform yönetimi yetkisi değişmiş. Yeni bir sorumlu seçin.</Alert>}
    {kisiler.hata && <Alert tone="error">{kisiler.hata} <Button onClick={kisiler.yenile}>Sorumluları yeniden yükle</Button></Alert>}
    {cakisma && <Alert tone="warning">Taslağınız korunuyor. Güncel kaydı karşılaştırın. <Button disabled={islem} onClick={() => void gunceliAl()}>Güncel kaydı göster</Button></Alert>}
    {guncel && <Card title="Sunucudaki güncel takip"><p>{guncel.sorumluAdi ?? "Atanmadı"} · {TAKIP_DURUMU[guncel.durum]} · Görüşme {tarih(guncel.sonrakiGorusme)}</p><div className="platform-row-actions">
      <Button onClick={() => { setTemel(guncel); setForm(alanlar(guncel)); setGuncel(null); setCakisma(false); setHata(""); }}>Güncel bilgileri kullan</Button>
      <Button onClick={() => { setTemel(guncel); setGuncel(null); setCakisma(false); setHata(""); }}>Taslağı koruyarak devam et</Button>
    </div></Card>}
    <form onSubmit={(e) => void kaydet(e)}><fieldset disabled={islem} className="platform-editor-fieldset"><div className="platform-firma-summary">
      <Field label="Firma sorumlusu"><Select value={form.sorumluId} onChange={(e) => setForm((f) => ({ ...f, sorumluId: e.target.value }))}><option value="">Atanmadı</option>{kisiler.veri?.map((k) => <option key={k.id} value={k.id}>{k.adSoyad}</option>)}{form.sorumluId && !uygun && <option value={form.sorumluId}>{temel.sorumluAdi ?? "Önceki sorumlu"} (yeniden atayın)</option>}</Select></Field>
      <Field label="Takip durumu"><Select value={form.durum} onChange={(e) => setForm((f) => ({ ...f, durum: e.target.value as Takip["durum"] }))}>{Object.entries(TAKIP_DURUMU).map(([kod, ad]) => <option key={kod} value={kod}>{ad}</option>)}</Select></Field>
      <Field label="Sonraki görüşme tarihi"><Input type="date" value={form.sonrakiGorusme} onChange={(e) => setForm((f) => ({ ...f, sonrakiGorusme: e.target.value }))} /></Field>
    </div><Button variant="primary" type="submit" disabled={!degisti || cakisma || !uygun || kisiler.yukleniyor || !!kisiler.hata}>{islem ? "Kaydediliyor…" : "Takibi kaydet"}</Button></fieldset></form>
    {temel.updatedAt && <p className="subtle">Son güncelleme: {temel.guncelleyen} · {zaman(temel.updatedAt)}</p>}
  </>;
}

function Sayfalar({ sayfa, toplam, onSayfa, bekle }: { sayfa: number; toplam: number; onSayfa: (s: number) => void; bekle: boolean }) {
  return <div className="platform-pagination"><span>Sayfa {sayfa} / {Math.max(1, Math.ceil(toplam / 25))} · {toplam} kayıt</span><div className="platform-row-actions"><Button disabled={bekle || sayfa === 1} onClick={() => onSayfa(sayfa - 1)}>Önceki</Button><Button disabled={bekle || sayfa * 25 >= toplam} onClick={() => onSayfa(sayfa + 1)}>Sonraki</Button></div></div>;
}

function Notlar({ firmaId, onTamam }: { firmaId: string; onTamam: (s: string) => void }) {
  const [sayfa, setSayfa] = useState(1);
  const kaynak = usePlatformVerisi<Sayfali<Not>>(`/platform/firmalar/${firmaId}/notlar?sayfa=${sayfa}`);
  const [metin, setMetin] = useState("");
  const [anahtar, setAnahtar] = useState(() => crypto.randomUUID());
  const [anahtarCakisti, setAnahtarCakisti] = useState(false);
  const [islem, setIslem] = useState(false);
  const [hata, setHata] = useState("");
  useKaydedilmemisUyarisi(!!metin.trim());
  async function kaydet(e: FormEvent) {
    e.preventDefault(); if (islem || !metin.trim()) return;
    setIslem(true); setHata("");
    try {
      const s = await platformApi<{ mesaj: string }>(`/platform/firmalar/${firmaId}/notlar`, { method: "POST", body: JSON.stringify({ metin: metin.trim(), islemAnahtari: anahtar }) });
      setMetin(""); setAnahtar(crypto.randomUUID()); setSayfa(1); kaynak.yenile(); onTamam(s.mesaj);
    } catch (e) { setHata(e instanceof Error ? e.message : "Not kaydedilemedi."); setAnahtarCakisti(e instanceof PlatformApiHata && e.durum === 409); }
    finally { setIslem(false); }
  }
  return <Card id="firma-notlari" title="İç notlar"><p className="subtle">Yalnız platform yöneticileri görür. Düzeltmeler yeni not eklenerek yapılır.</p><Alert tone="error">{hata}</Alert>
    {anahtarCakisti && <Button onClick={() => { setAnahtar(crypto.randomUUID()); setAnahtarCakisti(false); setHata(""); }}>Taslağı yeni bir not olarak hazırla</Button>}
    <form onSubmit={(e) => void kaydet(e)}><Field label="Yeni iç not" htmlFor="firma-ic-not"><textarea id="firma-ic-not" className="input platform-textarea" rows={3} required maxLength={4000} disabled={islem} value={metin} onChange={(e) => setMetin(e.target.value)} /></Field><Button variant="primary" type="submit" disabled={islem || !metin.trim()}>{islem ? "Kaydediliyor…" : "İç not ekle"}</Button></form>
    {kaynak.hata && <Alert tone="error">{kaynak.hata} <Button onClick={kaynak.yenile}>Notları yeniden yükle</Button></Alert>}
    {kaynak.yukleniyor ? <p role="status">Notlar yükleniyor…</p> : kaynak.veri && !kaynak.veri.kayitlar.length ? <p className="muted">Henüz iç not yok.</p> : <ul className="platform-firma-notes">{kaynak.veri?.kayitlar.map((n) => <li key={n.id}><p>{n.metin}</p><small>{n.yazar} · {zaman(n.zaman)}</small></li>)}</ul>}
    {kaynak.veri && <Sayfalar sayfa={sayfa} toplam={kaynak.veri.toplam} onSayfa={setSayfa} bekle={kaynak.yukleniyor || islem} />}
  </Card>;
}

function FirmaGorevleri({ firmaId }: { firmaId: string }) {
  const [sayfa, setSayfa] = useState(1);
  const g = usePlatformVerisi<GorevListesi>(`/platform/gorevler?firma=${firmaId}&durum=hepsi&sayfa=${sayfa}`);
  return <Card id="firma-gorevleri" title="Bağlı görevler" actions={<Link className="btn btn--primary" href={`/platform/gorevler?firma=${firmaId}&yeni=1`}>Firma görevi oluştur</Link>}>
    {g.hata && <Alert tone="error">{g.hata} <Button onClick={g.yenile}>Görevleri yeniden yükle</Button></Alert>}
    {g.yukleniyor ? <p role="status">Görevler yükleniyor…</p> : g.veri && !g.veri.kayitlar.length ? <p className="muted">Bu firmaya bağlı görev yok.</p> : <ul className="platform-dashboard-list">{g.veri?.kayitlar.map((v) => <li key={v.id}><Link href={`/platform/gorevler?gorev=${v.id}&firma=${firmaId}`}><strong>{v.baslik}</strong><span>{GOREV_DURUMU[v.durum]} · {v.sorumlu?.adSoyad ?? "Atanmadı"} · {tarih(v.sonTarih)}</span></Link></li>)}</ul>}
    {g.veri && <Sayfalar sayfa={sayfa} toplam={g.veri.toplam} onSayfa={setSayfa} bekle={g.yukleniyor} />}
  </Card>;
}

function FirmaOlaylari({ firmaId }: { firmaId: string }) {
  const [sayfa, setSayfa] = useState(1);
  const kaynak = usePlatformVerisi<Sayfali<Olay>>(`/platform/firmalar/${firmaId}/olaylar?sayfa=${sayfa}`);
  return <Card id="firma-olaylari" title="İşlem geçmişi"><p className="subtle">Firma kimliğiyle ilişkilendirilmiş platform işlemleri. Aboneliğin önceki kayıtları abonelik bölümünde ayrıca yer alır.</p>
    {kaynak.hata && <Alert tone="error">{kaynak.hata} <Button onClick={kaynak.yenile}>Geçmişi yeniden yükle</Button></Alert>}
    <TableWrap><thead><tr><th>Zaman</th><th>İşlem</th><th>Kişi</th><th>Ayrıntı</th></tr></thead><tbody>
      {kaynak.veri?.kayitlar.map((o) => <tr key={o.id}><td>{zaman(o.zaman)}</td><td>{OLAY_ADI[o.olay] ?? "Platform işlemi"}</td><td>{o.kullanici}</td><td>{o.detay?.gorevId && <Link href={`/platform/gorevler?gorev=${o.detay.gorevId}`}>Görevi aç</Link>}{o.detay?.notId && <a href="#firma-notlari">İç notlara git</a>}{o.detay?.yeni && <span>{TAKIP_DURUMU[o.detay.onceki?.durum as keyof typeof TAKIP_DURUMU] ?? "—"} → {TAKIP_DURUMU[o.detay.yeni.durum as keyof typeof TAKIP_DURUMU] ?? "Güncellendi"} · Görüşme {tarih(o.detay.yeni.sonrakiGorusme ?? null)}</span>}</td></tr>)}
      {kaynak.yukleniyor && <tr><td colSpan={4} role="status">Geçmiş yükleniyor…</td></tr>}
      {kaynak.veri && !kaynak.veri.kayitlar.length && <tr><td colSpan={4}>Henüz firma işlemi yok.</td></tr>}
    </tbody></TableWrap>
    {kaynak.veri && <Sayfalar sayfa={sayfa} toplam={kaynak.veri.toplam} onSayfa={setSayfa} bekle={kaynak.yukleniyor} />}
  </Card>;
}
