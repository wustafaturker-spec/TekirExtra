"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Plus, RefreshCw } from "lucide-react";
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, TableWrap } from "@/components/ui";
import { PlatformArama, PlatformListeDurumu } from "@/components/platform-liste";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { usePlatformOturumu } from "@/lib/platform-oturumu";
import { useKaydedilmemisUyarisi } from "@/lib/use-kaydedilmemis-uyarisi";
import { platformApi, PlatformApiHata } from "@/lib/platform-api";
import { GOREV_DURUMU, GOREV_ONCELIGI, gorevAcik, type Gorev, type GorevListesi, type GorevDurumu, type GorevKapsami, type GorevOnceligi } from "@/lib/platform-gorevleri";
import { tarihTR } from "@/lib/mevzuat-gorunum";

type ListeDurumu = GorevDurumu | "hepsi" | "acik_isler";
interface Filtre { arama: string; durum: ListeDurumu; benim: boolean; geciken: boolean; sorumluPasif: boolean; sayfa: number }
const VARSAYILAN_FILTRE: Filtre = { arama: "", durum: "acik_isler", benim: false, geciken: false, sorumluPasif: false, sayfa: 1 };
function filtreOku(p: Pick<URLSearchParams, "get">): Filtre {
  const durum = p.get("durum") ?? "";
  const sayfa = Number(p.get("sayfa") ?? "1");
  return { arama: (p.get("arama") ?? "").trim().slice(0, 200), durum: ["hepsi", "acik_isler", ...Object.keys(GOREV_DURUMU)].includes(durum) ? durum as ListeDurumu : "acik_isler", benim: p.get("benim") === "1", geciken: p.get("geciken") === "1", sorumluPasif: p.get("sorumluPasif") === "1", sayfa: Number.isInteger(sayfa) && sayfa > 0 && sayfa <= 100000 ? sayfa : 1 };
}
function filtreYaz(ek: Partial<Filtre> | ((f: Filtre) => Filtre)) {
  const url = new URL(window.location.href);
  const onceki = filtreOku(url.searchParams);
  const yeni = typeof ek === "function" ? ek(onceki) : { ...onceki, ...ek };
  for (const alan of ["arama", "durum", "benim", "geciken", "sorumluPasif", "sayfa"] as const) {
    if (yeni[alan] === VARSAYILAN_FILTRE[alan]) url.searchParams.delete(alan);
    else url.searchParams.set(alan, typeof yeni[alan] === "boolean" ? "1" : String(yeni[alan]));
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function GorevMerkezi() {
  const parametreler = useSearchParams();
  const bag = parametreler.get("degisiklik");
  const ilkDegisiklik = bag && UUID.test(bag) ? bag : "";
  const gorevParam = parametreler.get("gorev");
  const firmaParam = parametreler.get("firma");
  const ilkFirma = firmaParam && UUID.test(firmaParam) ? firmaParam : "";
  const yeniFirmaGorevi = !!ilkFirma && parametreler.get("yeni") === "1";
  const filtre = filtreOku(parametreler);
  const setFiltre = filtreYaz;
  const [arama, setArama] = useState(filtre.arama);
  useEffect(() => { setArama(filtre.arama); }, [filtre.arama]);
  const sorgu = new URLSearchParams({ arama: filtre.arama, durum: filtre.durum, benim: filtre.benim ? "1" : "0", geciken: filtre.geciken ? "1" : "0", sorumluPasif: filtre.sorumluPasif ? "1" : "0", sayfa: String(filtre.sayfa) });
  if (ilkFirma) sorgu.set("firma", ilkFirma);
  const { veri, yukleniyor, hata: listeHatasi, yenile } = usePlatformVerisi<GorevListesi>(`/platform/gorevler?${sorgu}`);
  const [formAcik, setFormAcik] = useState(false);
  const [secili, setSecili] = useState<Gorev | null>(null);
  const [modalSurumu, setModalSurumu] = useState(0);
  const [islem, setIslem] = useState<string | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  function formuKapat() {
    setFormAcik(false);
    const url = new URL(window.location.href);
    if (url.searchParams.has("yeni")) { url.searchParams.delete("yeni"); window.history.replaceState(null, "", `${url.pathname}${url.search}`); }
  }
  const goster = (ek: Partial<Filtre>) => setFiltre((f) => ({ ...f, ...ek, sayfa: 1 }));
  useEffect(() => {
    if (arama.trim() === filtre.arama) return;
    const t = setTimeout(() => filtreYaz({ arama: arama.trim().slice(0, 200), sayfa: 1 }), 300);
    return () => clearTimeout(t);
  }, [arama, filtre.arama]);
  const filtreAktif = Boolean(filtre.arama || filtre.benim || filtre.geciken || filtre.sorumluPasif || filtre.durum !== "acik_isler" || filtre.sayfa !== 1);
  async function baglantiyiKopyala() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("gorev"); url.searchParams.delete("degisiklik"); url.searchParams.delete("yeni");
      await navigator.clipboard.writeText(url.toString());
      setBasari("Liste bağlantısı kopyalandı.");
    } catch { setHata("Bağlantı kopyalanamadı. Tarayıcının adres çubuğundaki bağlantıyı kopyalayabilirsiniz."); }
  }
  useEffect(() => { if (yeniFirmaGorevi) { setSecili(null); setFormAcik(true); } }, [yeniFirmaGorevi]);
  useEffect(() => { if (ilkDegisiklik) { setSecili(null); setFormAcik(true); } }, [ilkDegisiklik]);
  useEffect(() => {
    if (!gorevParam || !UUID.test(gorevParam)) return;
    const controller = new AbortController();
    platformApi<Gorev>(`/platform/gorevler/${gorevParam}`, { signal: controller.signal }).then((g) => {
      if (!controller.signal.aborted) { setSecili(g); setModalSurumu((v) => v + 1); setFormAcik(true); }
    }).catch((e) => { if (!controller.signal.aborted) setHata(e instanceof Error ? e.message : "Görev alınamadı."); });
    return () => controller.abort();
  }, [gorevParam]);
  const gecerliVeri = veri && Array.isArray(veri.kayitlar) && veri.sayilar ? veri : null;
  const veriHatasi = listeHatasi || (!yukleniyor && !gecerliVeri ? "Görev verileri alınamadı. Yeniden deneyin." : "");

  async function durumDegistir(g: Gorev) {
    if (islem) return;
    setIslem(g.id); setHata(""); setBasari("");
    try {
      const durum = gorevAcik(g) ? "tamamlandi" : "acik";
      await platformApi(`/platform/gorevler/${g.id}`, { method: "PATCH", body: JSON.stringify({ surum: g.surum, durum }) });
      setBasari(durum === "tamamlandi" ? "Görev tamamlandı." : "Görev yeniden açıldı."); yenile();
    } catch (e) { setHata(e instanceof Error ? e.message : "Görev güncellenemedi."); }
    finally { setIslem(null); }
  }

  return <>
    <PageHeader title="Görev merkezi" subtitle="Ekip işlerini sorumlu, öncelik ve son tarihle takip edin. Tamamlanan görevler geçmişte korunur." actions={<div className="platform-row-actions"><Button disabled={yukleniyor || Boolean(islem)} onClick={yenile}><RefreshCw size={16} aria-hidden="true" />Yenile</Button><Button variant="primary" onClick={() => { setSecili(null); setModalSurumu((v) => v + 1); setFormAcik(true); }}><Plus size={16} aria-hidden="true" />Yeni görev</Button></div>} />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>
    {ilkFirma && <p>Bu firmaya bağlı görevler · <Link href={`/platform/firmalar/${ilkFirma}`}>Firma detayına dön</Link> · <Link href="/platform/gorevler">Tüm görevler</Link></p>}
    <section aria-label="Görev durumları"><p className="platform-section-caption">Yetkinizdeki tüm görevler · Arama ve liste filtrelerinden bağımsız</p><div className="platform-overview platform-task-overview">
      {([ ["acik", "Açık", "acik"], ["devam_ediyor", "Devam ediyor", "devam_ediyor"], ["geciken", "Geciken", "acik_isler"], ["tamamlandi", "Tamamlandı", "tamamlandi"] ] as const).map(([kod, ad, durum]) => <button key={kod} className={`platform-metric${kod === "geciken" ? filtre.geciken ? " is-active" : "" : !filtre.geciken && filtre.durum === durum ? " is-active" : ""}`} onClick={() => goster({ durum, geciken: kod === "geciken" })}><span>{ad}</span><strong>{yukleniyor || veriHatasi ? "—" : gecerliVeri?.sayilar[kod] ?? "—"}</strong></button>)}
    </div></section>
    <Card title="Görev listesi" pad={false}>
      <div className="platform-filter-bar"><PlatformArama etiket="Görev ara" deger={arama} onChange={setArama} placeholder="Başlık veya açıklama ara…" /><Field label="Görev durumu"><Select value={filtre.durum} onChange={(e) => goster({ durum: e.target.value as ListeDurumu })}><option value="acik_isler">Açık ve devam edenler</option><option value="hepsi">Tüm durumlar</option>{Object.entries(GOREV_DURUMU).map(([kod, ad]) => <option key={kod} value={kod}>{ad}</option>)}</Select></Field></div>
      <div className="platform-task-toggles"><Button size="sm" onClick={() => void baglantiyiKopyala()}>Liste bağlantısını kopyala</Button>{filtreAktif && <Button size="sm" onClick={() => { setArama(""); filtreYaz(VARSAYILAN_FILTRE); }}>Filtreleri temizle</Button>}<label><input type="checkbox" checked={filtre.benim} onChange={(e) => goster({ benim: e.target.checked })} />Bana atananlar</label><label><input type="checkbox" checked={filtre.geciken} onChange={(e) => goster({ geciken: e.target.checked })} />Sadece gecikenler</label><label><input type="checkbox" checked={filtre.sorumluPasif} onChange={(e) => goster({ sorumluPasif: e.target.checked })} />Sorumlusu pasif</label><span role="status">{yukleniyor ? "Yükleniyor…" : veriHatasi ? "Liste alınamadı" : `${gecerliVeri?.toplam ?? 0} görev`}</span></div>
      <TableWrap className="platform-responsive-table platform-task-table"><thead><tr><th>Görev</th><th>Durum</th><th>Öncelik</th><th>Sorumlu</th><th>Son tarih</th><th>İşlem</th></tr></thead><tbody>
        {!yukleniyor && !veriHatasi && gecerliVeri?.kayitlar.map((g) => <tr key={g.id}>
          <td data-label="Görev" className="platform-cell-title"><strong>{g.baslik}</strong><div><Badge variant={g.kapsam === "mevzuat" ? "info" : "neutral"}>{g.kapsam === "mevzuat" ? "Mevzuat" : "Platform"}</Badge></div>{g.aciklama && <p className="platform-task-description">{g.aciklama}</p>}{g.degisiklik && <Link className="platform-task-related" href={`/platform/degisiklik?id=${g.degisiklik.id}`}>#{g.degisiklik.no} {g.degisiklik.baslik}</Link>}</td>
          <td data-label="Durum"><Badge variant={g.durum === "tamamlandi" ? "success" : g.durum === "devam_ediyor" ? "info" : "neutral"}>{GOREV_DURUMU[g.durum]}</Badge></td>
          <td data-label="Öncelik"><Badge variant={g.oncelik === "yuksek" ? "warning" : "neutral"}>{GOREV_ONCELIGI[g.oncelik]}</Badge></td>
          <td data-label="Sorumlu">{g.sorumlu?.adSoyad ?? <span className="muted">Atanmadı</span>}{g.sorumlu && !g.sorumlu.aktif && <div className="muted">Hesap pasif</div>}</td>
          <td data-label="Son tarih">{g.sonTarih ? tarihTR(g.sonTarih) : "Belirlenmedi"}{g.sonTarih && gorevAcik(g) && g.sonTarih < gecerliVeri.bugun && <div><Badge variant="danger">Gecikti</Badge></div>}</td>
          <td data-label="İşlem"><div className="platform-row-actions"><Button size="sm" disabled={Boolean(islem)} onClick={() => { setSecili(g); setModalSurumu((v) => v + 1); setFormAcik(true); }}>Düzenle</Button><Button size="sm" disabled={Boolean(islem)} onClick={() => void durumDegistir(g)}>{islem === g.id ? "Kaydediliyor…" : gorevAcik(g) ? "Tamamla" : "Yeniden aç"}</Button></div></td>
        </tr>)}
        <PlatformListeDurumu sutun={6} yukleniyor={yukleniyor} hata={veriHatasi} bos={!gecerliVeri?.kayitlar.length} baslik="Bu görünümde görev yok." aciklama="Filtreleri değiştirin veya yeni bir görev oluşturun." onTekrar={yenile} />
      </tbody></TableWrap>
      <div className="platform-pagination"><span>Sayfa {filtre.sayfa}{gecerliVeri ? ` / ${Math.max(1, Math.ceil(gecerliVeri.toplam / gecerliVeri.sayfaBoyutu))}` : ""}</span><div className="platform-row-actions"><Button size="sm" disabled={yukleniyor || filtre.sayfa === 1} onClick={() => setFiltre((f) => ({ ...f, sayfa: f.sayfa - 1 }))}><ArrowLeft size={14} aria-hidden="true" />Önceki</Button><Button size="sm" disabled={yukleniyor || !gecerliVeri || filtre.sayfa * gecerliVeri.sayfaBoyutu >= gecerliVeri.toplam} onClick={() => setFiltre((f) => ({ ...f, sayfa: f.sayfa + 1 }))}>Sonraki<ArrowRight size={14} aria-hidden="true" /></Button></div></div>
    </Card>
    {formAcik && <GorevFormu key={`${secili?.id ?? "yeni"}:${modalSurumu}`} gorev={secili} ilkFirmaId={secili ? "" : ilkFirma} ilkDegisiklikId={secili ? "" : ilkDegisiklik} onKapat={formuKapat} onTamam={(g) => { formuKapat(); setBasari(`${g.baslik}: görev kaydedildi.`); setHata(""); yenile(); }} onGuncel={(g) => { setSecili(g); setModalSurumu((v) => v + 1); }} />}
  </>;
}

interface Katilimci { id: string; adSoyad: string; rol: "yonetici" | "mevzuat_editoru" }
interface Degisiklik { id: string; no: number; baslik: string }
function GorevFormu({ gorev, ilkFirmaId, ilkDegisiklikId, onKapat, onTamam, onGuncel }: { gorev: Gorev | null; ilkFirmaId: string; ilkDegisiklikId: string; onKapat: () => void; onTamam: (g: Gorev) => void; onGuncel: (g: Gorev) => void }) {
  const ben = usePlatformOturumu();
  const ilk = { baslik: gorev?.baslik ?? "", aciklama: gorev?.aciklama ?? "", kapsam: gorev?.kapsam ?? (ilkFirmaId ? "platform" : "mevzuat") as GorevKapsami, durum: gorev?.durum ?? "acik" as GorevDurumu, oncelik: gorev?.oncelik ?? "normal" as GorevOnceligi, sonTarih: gorev?.sonTarih ?? "", sorumluId: gorev?.sorumluId ?? "", degisiklikId: gorev?.degisiklikId ?? ilkDegisiklikId };
  const [form, setForm] = useState(ilk);
  const [hata, setHata] = useState("");
  const [cakisma, setCakisma] = useState(false);
  const [islem, setIslem] = useState(false);
  const degisti = JSON.stringify(form) !== JSON.stringify(ilk);
  useKaydedilmemisUyarisi(degisti);
  const kisiler = usePlatformVerisi<Katilimci[]>("/platform/gorevler/katilimcilar");
  const degisiklikler = usePlatformVerisi<Degisiklik[]>(form.kapsam === "mevzuat" ? "/platform/mevzuat/degisiklikler" : null);
  const secenekler = Array.isArray(degisiklikler.veri) ? degisiklikler.veri : [];
  const bagli = usePlatformVerisi<Degisiklik>(form.kapsam === "mevzuat" && form.degisiklikId && !degisiklikler.yukleniyor && !degisiklikler.hata && !secenekler.some((d) => d.id === form.degisiklikId) && gorev?.degisiklik?.id !== form.degisiklikId ? `/platform/mevzuat/degisiklikler/${form.degisiklikId}` : null);
  const uygunKisiler = (Array.isArray(kisiler.veri) ? kisiler.veri : []).filter((k) => form.kapsam === "mevzuat" || k.rol === "yonetici");
  const sorumluGecerli = !form.sorumluId || uygunKisiler.some((k) => k.id === form.sorumluId);
  const kisiHatasi = kisiler.hata || (!kisiler.yukleniyor && !Array.isArray(kisiler.veri) ? "Sorumlu listesi alınamadı." : "");
  const degisiklikHatasi = degisiklikler.hata || (form.kapsam === "mevzuat" && !degisiklikler.yukleniyor && !Array.isArray(degisiklikler.veri) ? "Değişiklik listesi alınamadı." : "");
  const metaHatasi = kisiHatasi || degisiklikHatasi || bagli.hata;
  const bekle = kisiler.yukleniyor || degisiklikler.yukleniyor || bagli.yukleniyor;
  const kapat = () => { if (!islem && (!degisti || window.confirm("Görevde kaydedilmemiş değişiklikler var. Taslağı bırakmak istiyor musunuz?"))) onKapat(); };
  const ekSecenek = gorev?.degisiklik?.id === form.degisiklikId ? gorev.degisiklik : bagli.veri;

  async function kaydet(e: FormEvent) {
    e.preventDefault();
    if (islem || bekle || metaHatasi || !sorumluGecerli) return;
    setIslem(true); setHata(""); setCakisma(false);
    try {
      const { durum, kapsam, ...alanlar } = form;
      const veri = { ...alanlar, aciklama: form.aciklama.trim() || null, sonTarih: form.sonTarih || null, sorumluId: form.sorumluId || null, degisiklikId: form.degisiklikId || null, ...(gorev ? { surum: gorev.surum, durum } : { kapsam, ...(ilkFirmaId ? { tenantId: ilkFirmaId } : {}) }) };
      onTamam(await platformApi<Gorev>(gorev ? `/platform/gorevler/${gorev.id}` : "/platform/gorevler", { method: gorev ? "PATCH" : "POST", body: JSON.stringify(veri) }));
    } catch (e) { setHata(e instanceof Error ? e.message : "Görev kaydedilemedi."); setCakisma(e instanceof PlatformApiHata && e.durum === 409); }
    finally { setIslem(false); }
  }
  async function gunceliYukle() {
    if (!gorev || islem) return;
    setIslem(true);
    try { onGuncel(await platformApi<Gorev>(`/platform/gorevler/${gorev.id}`)); }
    catch (e) { setHata(e instanceof Error ? e.message : "Güncel görev alınamadı."); }
    finally { setIslem(false); }
  }

  return <Modal genis baslik={gorev ? "Görevi düzenle" : "Yeni görev"} aciklama={gorev ? `Oluşturan: ${gorev.olusturan?.adSoyad ?? "Sistem"}` : "Yeni görev açık durumda oluşturulur. Platform görevlerini yalnız yöneticiler görür."} onKapat={kapat}>
    <Alert tone="error">{hata}</Alert>
    {cakisma && <div className="platform-task-conflict"><p className="muted">Girdiğiniz taslak korunuyor. Güncel kaydı yüklemek bu taslağı bırakır.</p><Button disabled={islem} onClick={() => void gunceliYukle()}>Taslağı bırak ve güncel kaydı yükle</Button></div>}
    {kisiHatasi && <Alert tone="error">Sorumlu listesi alınamadı. <Button onClick={kisiler.yenile}>Yeniden dene</Button></Alert>}
    {degisiklikHatasi && <Alert tone="error">Değişiklik listesi alınamadı. <Button onClick={degisiklikler.yenile}>Yeniden dene</Button></Alert>}
    {bagli.hata && <Alert tone="error">Bağlı değişiklik alınamadı. <Button onClick={bagli.yenile}>Yeniden dene</Button><Button onClick={() => setForm((f) => ({ ...f, degisiklikId: "" }))}>Bağı kaldır</Button></Alert>}
    {(gorev?.tenantId || ilkFirmaId) && <p>Firma bağlantısı: <Link href={`/platform/firmalar/${gorev?.tenantId || ilkFirmaId}`}>Firma detayını aç</Link></p>}
    <form onSubmit={(e) => void kaydet(e)}><fieldset className="platform-editor-fieldset" disabled={islem}>
      <div className="platform-task-form">
        <Field label="Görev başlığı"><Input autoFocus required minLength={3} maxLength={200} value={form.baslik} onChange={(e) => setForm((f) => ({ ...f, baslik: e.target.value }))} /></Field>
        <Field label="Görev kapsamı"><Select value={form.kapsam} disabled={Boolean(gorev) || !!ilkFirmaId || ben?.rol !== "yonetici"} onChange={(e) => setForm((f) => ({ ...f, kapsam: e.target.value as GorevKapsami, sorumluId: "", degisiklikId: "" }))}><option value="mevzuat">Mevzuat ekibi</option>{(ben?.rol === "yonetici" || form.kapsam === "platform") && <option value="platform">Platform yönetimi</option>}</Select></Field>
        <Field label="Öncelik"><Select value={form.oncelik} onChange={(e) => setForm((f) => ({ ...f, oncelik: e.target.value as GorevOnceligi }))}>{Object.entries(GOREV_ONCELIGI).map(([kod, ad]) => <option key={kod} value={kod}>{ad}</option>)}</Select></Field>
        <Field label="Sorumlu"><Select value={form.sorumluId} disabled={bekle || Boolean(kisiler.hata)} onChange={(e) => setForm((f) => ({ ...f, sorumluId: e.target.value }))}><option value="">Atanmadı</option>{gorev?.sorumlu && !uygunKisiler.some((k) => k.id === gorev.sorumlu!.id) && <option value={gorev.sorumlu.id} disabled>{gorev.sorumlu.adSoyad} · yeniden atayın</option>}{uygunKisiler.map((k) => <option key={k.id} value={k.id}>{k.adSoyad}</option>)}</Select></Field>
        <Field label="Son tarih"><Input type="date" value={form.sonTarih} onChange={(e) => setForm((f) => ({ ...f, sonTarih: e.target.value }))} /></Field>
        {gorev && <Field label="Durum"><Select value={form.durum} onChange={(e) => setForm((f) => ({ ...f, durum: e.target.value as GorevDurumu }))}>{Object.entries(GOREV_DURUMU).map(([kod, ad]) => <option key={kod} value={kod}>{ad}</option>)}</Select></Field>}
        {form.kapsam === "mevzuat" && <Field label="İlgili mevzuat değişikliği"><Select value={form.degisiklikId} disabled={bekle || Boolean(degisiklikler.hata)} onChange={(e) => setForm((f) => ({ ...f, degisiklikId: e.target.value }))}><option value="">Bağlantı yok</option>{ekSecenek && !secenekler.some((d) => d.id === ekSecenek.id) && <option value={ekSecenek.id}>#{ekSecenek.no} {ekSecenek.baslik}</option>}{secenekler.map((d) => <option key={d.id} value={d.id}>#{d.no} {d.baslik}</option>)}</Select></Field>}
      </div>
      <Field label="Görev açıklaması" htmlFor="gorev-aciklama"><textarea id="gorev-aciklama" className="input platform-textarea" rows={4} maxLength={4000} value={form.aciklama} onChange={(e) => setForm((f) => ({ ...f, aciklama: e.target.value }))} /></Field>
      {bekle && <p className="muted" role="status">Görev seçenekleri yükleniyor…</p>}
      {!sorumluGecerli && !bekle && <Alert tone="warning">Bu görev için aktif ve yetkili bir sorumlu seçin veya atamayı kaldırın.</Alert>}
      <div className="platform-row-actions"><Button type="button" onClick={kapat}>Vazgeç</Button><Button type="submit" variant="primary" disabled={islem || bekle || Boolean(metaHatasi) || !sorumluGecerli || Boolean(gorev && !degisti)}>{islem ? "Kaydediliyor…" : "Görevi kaydet"}</Button></div>
    </fieldset></form>
  </Modal>;
}

export default function PlatformGorevleri() {
  return <Suspense fallback={<p className="muted" role="status">Görev merkezi yükleniyor…</p>}><GorevMerkezi /></Suspense>;
}
