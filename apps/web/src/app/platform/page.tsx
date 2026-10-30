"use client";

import { FilePenLine, Plus, Search, ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Segmented, TableWrap } from "@/components/ui";
import { platformApi, platformTokenAl } from "@/lib/platform-api";
import type { TakvimSatiri } from "@tekirextra/shared";

import { DURUM_ADI, DURUM_ROZETI, tarihTR, type MevzuatDurum as Durum } from "@/lib/mevzuat-gorunum";

interface Degisiklik { id: string; no: number; baslik: string; dayanak: string; yururlukBaslangic: string; durum: Durum; satirSayisi: number; yayinZamani: string | null; hazirlayan: { adSoyad: string }; yayinlayan: { adSoyad: string } | null; retGerekcesi: string | null }


const TAKVIM_ADI: Record<TakvimSatiri["durum"], string> = { tamam: "Yayınlandı", bekliyor: "Henüz erken", yaklasiyor: "Yaklaşıyor — yayınlanmadı", eksik: "Dönem başladı — kayıt yok" };
const TAKVIM_ROZETI: Record<TakvimSatiri["durum"], "success" | "neutral" | "warning" | "danger"> = { tamam: "success", bekliyor: "neutral", yaklasiyor: "warning", eksik: "danger" };

/** MVZ-05: değişiklik listesi ve yeni değişiklik taslağı. */
function PlatformDegisiklikleriIcerigi() {
  const parametreler = useSearchParams();
  const yonlendir = useRouter();
  const [liste, setListe] = useState<Degisiklik[]>([]);
  const [ozet, setOzet] = useState<Degisiklik[] | null>(null);
  const [takvim, setTakvim] = useState<TakvimSatiri[]>([]);
  const [durum, setDurum] = useState<Durum | "hepsi">("hepsi");
  const [arama, setArama] = useState("");
  const [formAcik, setFormAcik] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [listeHatasi, setListeHatasi] = useState("");
  const [takvimHatasi, setTakvimHatasi] = useState("");
  const [tekrar, setTekrar] = useState(0);
  const [hata, setHata] = useState("");
  const [islem, setIslem] = useState(false);

  useEffect(() => {
    const secim = parametreler.get("durum");
    const kontrol = new AbortController();
    setDurum(secim === "taslak" || secim === "onay_bekliyor" || secim === "yayinlandi" ? secim : "hepsi");
    if (secim === "taslak" || secim === "onay_bekliyor" || secim === "yayinlandi") {
      setDurum(secim);
      if (platformTokenAl()) void platformApi<Degisiklik[]>("/platform/mevzuat/degisiklikler", { signal: kontrol.signal }).then((v) => { if (!kontrol.signal.aborted) setOzet(v); }).catch(() => undefined);
    }
    if (parametreler.get("yeni") === "1") setFormAcik(true);
    return () => kontrol.abort();
  }, [parametreler]);

  useEffect(() => {
    if (formAcik) {
      document.getElementById("yeni-degisiklik")?.scrollIntoView({ block: "start" });
      document.querySelector<HTMLInputElement>('#yeni-degisiklik input[name="baslik"]')?.focus({ preventScroll: true });
    }
  }, [formAcik]);

  useEffect(() => {
    if (!platformTokenAl()) return;
    const kontrol = new AbortController();
    setYukleniyor(true); setListeHatasi("");
    void platformApi<Degisiklik[]>(`/platform/mevzuat/degisiklikler${durum === "hepsi" ? "" : `?durum=${durum}`}`, { signal: kontrol.signal })
      .then((v) => { if (!kontrol.signal.aborted) { setListe(v); if (durum === "hepsi") setOzet(v); } })
      .catch((e) => { if (!kontrol.signal.aborted) setListeHatasi(e instanceof Error ? e.message : "Liste yüklenemedi"); })
      .finally(() => { if (!kontrol.signal.aborted) setYukleniyor(false); });
    return () => kontrol.abort();
  }, [tekrar, durum]);
  const takvimYukle = useCallback(async () => {
    setTakvimHatasi("");
    try { setTakvim(await platformApi<TakvimSatiri[]>("/platform/mevzuat/yayin-takvimi")); }
    catch { setTakvimHatasi("Yayın takvimi yüklenemedi. Dönem uyarılarını görmek için yeniden deneyin."); }
  }, []);
  useEffect(() => { if (platformTokenAl()) void takvimYukle(); }, [takvimYukle]);
  const gorunen = liste.filter((d) => (durum === "hepsi" || d.durum === durum) && `${d.no} ${d.baslik} ${d.dayanak}`.toLocaleLowerCase("tr-TR").includes(arama.toLocaleLowerCase("tr-TR")));

  async function olustur(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = new FormData(e.currentTarget);
    setIslem(true); setHata("");
    try {
      const d = await platformApi<{ id: string }>("/platform/mevzuat/degisiklikler", {
        method: "POST",
        body: JSON.stringify({ baslik: v.get("baslik"), dayanak: v.get("dayanak"), yururlukBaslangic: v.get("yururlukBaslangic"), aciklama: v.get("aciklama") || null }),
      });
      yonlendir.push(`/platform/degisiklik?id=${d.id}`);
    } catch (h) { setHata(h instanceof Error ? h.message : "Oluşturulamadı"); } finally { setIslem(false); }
  }

  return <>
    <PageHeader title="Mevzuat değişiklikleri" subtitle="Düzenlemeleri hazırlayın, onay sürecini izleyin ve yürürlük tarihlerini yönetin." actions={<Button variant="primary" aria-expanded={formAcik} aria-controls="yeni-degisiklik" onClick={() => setFormAcik(!formAcik)}><Plus size={17} aria-hidden="true" />Yeni değişiklik</Button>} />
    <div className="platform-workflow"><ShieldCheck size={20} aria-hidden="true" /><div><strong>Her yayın, ikinci bir gözden geçer.</strong><span>Taslağı hazırlayın <ArrowRight size={13} /> Onaya gönderin <ArrowRight size={13} /> Başka bir yetkili yayınlasın</span></div></div>
    <section aria-label="Son 200 değişikliğin durumu"><p className="platform-section-caption">Son 200 değişikliğin durumu</p><div className="platform-overview">{([['taslak', 'Taslak', 'Hazırlanmaya devam eden'], ['onay_bekliyor', 'Onay bekliyor', 'İkinci yetkilinin incelemesinde'], ['yayinlandi', 'Yayınlandı', 'Yayın süreci tamamlanan']] as const).map(([deger, ad, ipucu]) => <button key={deger} className={`platform-metric${durum === deger ? " is-active" : ""}`} aria-pressed={durum === deger} onClick={() => setDurum(durum === deger ? "hepsi" : deger)}><span>{ad}</span><strong>{ozet === null ? "—" : ozet.filter((d) => d.durum === deger).length}</strong><small>{ipucu}</small></button>)}</div></section>
    {takvimHatasi && <Alert tone="warning">{takvimHatasi} <Button size="sm" onClick={() => void takvimYukle()}>Tekrar dene</Button></Alert>}
    <Alert tone="error">{hata}</Alert>
    {takvim.length > 0 && <Card title="Yayın takvimi" pad={false}>
      <p className="muted" style={{ margin: "0 1.25rem 0.75rem" }}>Bu değerler yalnız başladıkları dönemde geçerlidir; yeni dönemin kaydı yayınlanmadan kiracılarda ilgili hesap yapılamaz. Döneme 45 gün kala uyarı verilir; 30, 15 ve 7 gün kala ve dönem başında platform ekibine e-posta gider.</p>
      <TableWrap>
        <thead><tr><th>Değer</th><th>Dönem</th><th>Başlangıç</th><th className="num">Kalan gün</th><th>Durum</th></tr></thead>
        <tbody>
          {takvim.map((t) => <tr key={`${t.tur}/${t.anahtar}/${t.donem}`}>
            <td>{t.ad}</td>
            <td>{t.donem}</td>
            <td>{tarihTR(t.baslangic)}</td>
            <td className="num">{t.kalanGun > 0 ? t.kalanGun : "—"}</td>
            <td><Badge variant={TAKVIM_ROZETI[t.durum]}>{TAKVIM_ADI[t.durum]}</Badge>{t.durum === "eksik" && <div className="muted">Kiracılarda {t.etki}.</div>}</td>
          </tr>)}
        </tbody>
      </TableWrap>
    </Card>}
    <Card className="platform-changes" title="Değişiklikler" actions={<Segmented ariaLabel="Durum" value={durum} onChange={setDurum} items={[{ deger: "hepsi", baslik: "Hepsi" }, { deger: "taslak", baslik: "Taslak" }, { deger: "onay_bekliyor", baslik: "Onay bekliyor" }, { deger: "yayinlandi", baslik: "Yayınlandı" }]} />} pad={false}>
      <div className="platform-list-tools"><label className="platform-search"><Search size={17} aria-hidden="true" /><Input aria-label="Değişiklik ara" placeholder="Başlık, dayanak veya numara ara…" value={arama} onChange={(e) => setArama(e.target.value)} /></label><span className="muted" aria-live="polite">{yukleniyor ? "Yükleniyor…" : listeHatasi ? "Liste alınamadı" : `${gorunen.length} değişiklik${liste.length === 200 ? " · Son 200 kayıt" : ""}`}</span></div>
      {listeHatasi && <div className="platform-inline-error"><Alert tone="error">{listeHatasi}</Alert><Button onClick={() => setTekrar((v) => v + 1)}>Tekrar dene</Button></div>}
      <TableWrap className="platform-change-table">
        <thead><tr><th>No</th><th>Başlık</th><th>Dayanak</th><th>Yürürlük</th><th>Kalem</th><th>Durum</th><th>Hazırlayan / Yayınlayan</th></tr></thead>
        <tbody>
          {(!yukleniyor && !listeHatasi ? gorunen : []).map((d) => <tr key={d.id}>
            <td>{d.no}</td>
            <td><Link href={`/platform/degisiklik?id=${d.id}`}><strong>{d.baslik}</strong></Link>{d.durum === "taslak" && d.retGerekcesi && <div className="muted">Geri çevrildi: {d.retGerekcesi}</div>}</td>
            <td className="muted">{d.dayanak}</td>
            <td>{tarihTR(d.yururlukBaslangic)}</td>
            <td>{d.satirSayisi}</td>
            <td><Badge variant={DURUM_ROZETI[d.durum]}>{DURUM_ADI[d.durum]}</Badge></td>
            <td className="muted">{d.hazirlayan.adSoyad}{d.yayinlayan ? ` / ${d.yayinlayan.adSoyad}` : ""}</td>
          </tr>)}
          {yukleniyor && <tr><td colSpan={7}><div className="platform-empty" role="status">Değişiklikler yükleniyor…</div></td></tr>}
          {!yukleniyor && !listeHatasi && !gorunen.length && <tr><td colSpan={7}><div className="platform-empty"><FilePenLine size={28} aria-hidden="true" /><strong>{liste.length ? "Aramanıza uygun değişiklik yok" : durum === "hepsi" ? "Henüz değişiklik yok" : "Bu durumda değişiklik yok"}</strong><span>{liste.length ? "Arama metnini veya durum filtresini değiştirin." : "İlk düzenlemenizi hazırlamak için yeni bir taslak oluşturun."}</span>{!liste.length && <Button onClick={() => setFormAcik(true)}>Yeni değişiklik oluştur</Button>}</div></td></tr>}
        </tbody>
      </TableWrap>
    </Card>
    <Card hidden={!formAcik} id="yeni-degisiklik" title="Yeni değişiklik" actions={<Button size="sm" onClick={() => setFormAcik(false)}>Kapat</Button>}>
      <p className="muted">Önce düzenlemenin temel bilgilerini girin. Kalemleri bir sonraki adımda ekleyebilirsiniz.</p>
      <form className="form-grid" onSubmit={(e) => void olustur(e)}>
        <Field label="Başlık"><Input name="baslik" required minLength={3} maxLength={200} placeholder="ör. KDV tevkifat oranları güncellemesi" /></Field>
        <Field label="Mevzuat dayanağı"><Input name="dayanak" required minLength={5} maxLength={500} placeholder="ör. KDVGUT değişikliği, Seri No: 50, RG 02.03.2024" /></Field>
        <Field label="Yürürlük başlangıcı"><Input name="yururlukBaslangic" type="date" required /></Field>
        <Field label="Açıklama (isteğe bağlı)" htmlFor="degisiklik-aciklama"><textarea id="degisiklik-aciklama" className="input platform-textarea" name="aciklama" maxLength={2000} rows={3} placeholder="Değişikliğin kapsamını ve hazırlık notlarını yazın." /></Field>
        <div><Button type="submit" variant="primary" disabled={islem}>{islem ? "Oluşturuluyor…" : "Taslak oluştur"}</Button></div>
      </form>
    </Card>
  </>;
}

export default function PlatformDegisiklikleri() {
  return <Suspense fallback={<p className="muted" role="status">Değişiklikler yükleniyor…</p>}><PlatformDegisiklikleriIcerigi /></Suspense>;
}
