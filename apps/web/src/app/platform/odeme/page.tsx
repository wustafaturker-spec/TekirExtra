"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CreditCard, RefreshCw, ShieldCheck } from "lucide-react";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { platformApi, platformTokenAl } from "@/lib/platform-api";

interface Alan { anahtar: string; etiket: string; gizli: boolean; dolu: boolean; deger?: string }
interface Saglayici { saglayici: "iyzico" | "paytr"; ad: string; bagli: boolean; ortam: "test" | "canli"; etkin: boolean; guncellendi: string | null; bildirimAdresi?: string | null; alanlar: Alan[] }

/**
 * PLT-11: abonelik bedelini tahsil eden ödeme sağlayıcısı. Gizli alanlar bir
 * kez girilir, sonra gösterilmez; boş bırakılırsa kayıtlı değer korunur.
 * Etkin sağlayıcı yoksa firmalar ödemeyi elle (PLT-09) yapar.
 */
export default function PlatformOdeme() {
  const [liste, setListe] = useState<Saglayici[] | null>(null);
  const [listeHatasi, setListeHatasi] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kilitli, setKilitli] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async (signal?: AbortSignal) => {
    setYukleniyor(true);
    try {
      const sonuc = await platformApi<Saglayici[]>("/platform/odeme-saglayicilari", { signal });
      if (!signal?.aborted) { setListe(sonuc); setListeHatasi(""); }
    } catch (e) { if (!signal?.aborted) setListeHatasi(e instanceof Error ? e.message : "Sağlayıcılar yüklenemedi."); }
    finally { if (!signal?.aborted) setYukleniyor(false); }
  }, []);
  useEffect(() => {
    if (!platformTokenAl()) return;
    const kontrol = new AbortController();
    void yukle(kontrol.signal);
    return () => kontrol.abort();
  }, [yukle]);

  const etkin = liste?.find((s) => s.etkin);
  return <>
    <PageHeader title="Abonelik ödemesi" subtitle="Kartla tahsilat sağlayıcısını ve abonelik faturalarının hangi firmada oluşturulacağını yönetin." actions={<Button disabled={yukleniyor || kilitli} onClick={() => void yukle()}><RefreshCw size={16} aria-hidden="true" />Sağlayıcıları yenile</Button>} />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>
    {listeHatasi && <Alert tone="error">{listeHatasi} {liste && "Gösterilen sağlayıcı bilgileri son başarılı yüklemeye aittir."} <Button size="sm" disabled={yukleniyor || kilitli} onClick={() => void yukle()}>Tekrar dene</Button></Alert>}
    <div className="platform-workflow"><CreditCard size={20} aria-hidden="true" /><div><strong>{!liste ? "Tahsilat ayarları yükleniyor…" : etkin ? `Kartla tahsilat: ${etkin.ad} · ${etkin.ortam === "canli" ? "Canlı ortam" : "Test ortamı"}` : "Kartla tahsilat kapalı"}</strong><span>Aynı anda tek sağlayıcı etkin olur. <Link href="/platform/firmalar">Firmalar ekranından</Link> elle ödeme kaydı her zaman yapılabilir.</span></div></div>
    {liste && !etkin && !listeHatasi && <Alert tone="warning">Etkin sağlayıcı yok: firmalar panelde çevrim içi ödeme göremez, hatırlatma e-postası ödeme bağlantısı taşımaz.</Alert>}
    {!liste && yukleniyor && <Card><div className="platform-empty" role="status">Ödeme sağlayıcıları yükleniyor…</div></Card>}
    <div className="platform-provider-grid">
      {liste?.map((s) => <SaglayiciKarti key={s.saglayici} s={s} kilitli={kilitli || yukleniyor || Boolean(listeHatasi)} onIslem={setKilitli} onTamam={async (m) => { setBasari(m); setHata(""); await yukle(); }} onHata={(m) => { setHata(m); setBasari(""); }} />)}
    </div>
    <FaturaKarti onBasari={(m) => { setBasari(m); setHata(""); }} onHata={(m) => { setHata(m); setBasari(""); }} />
  </>;
}

type HesapTuru = "kasa" | "banka" | "pos";
interface Hesap { tur: HesapTuru; id: string; ad: string; doviz: string; saglayici?: string | null }
interface Sorunlu { odemeId: string; firma: string; durum: "bekliyor" | "hata" | "kesinlesti"; faturaNo: string | null; hata: string | null; deneme: number; guncellendi: string }
interface FaturaAyari {
  faturalayan: { tenantId: string; unvan: string } | null;
  etkinSaglayici: string | null;
  kartHesap: { tur: HesapTuru; id: string } | null;
  elleHesap: { tur: HesapTuru; id: string } | null;
  baslangicAt: string | null;
  hesaplar: Hesap[];
  sorunlu: Sorunlu[];
}
const SAGLAYICI_ADI: Record<string, string> = { iyzico: "iyzico", paytr: "PayTR" };
const HESAP_TURU: Record<HesapTuru, string> = { kasa: "Kasa", banka: "Banka", pos: "POS" };
const SORUN: Record<Sorunlu["durum"], string> = { bekliyor: "Fatura bekliyor", hata: "Fatura açılamadı", kesinlesti: "Tahsilat açılamadı" };
const hesapDegeri = (h: { tur: HesapTuru; id: string } | null) => (h ? `${h.tur}:${h.id}` : "");
const hesapAyir = (s: string) => (s ? { tur: s.split(":")[0] as HesapTuru, id: s.split(":")[1]! } : null);

/**
 * PLT-20…23: abonelik ödemeleri seçilen firmada (TekirExtra'nın kendi kiracısı)
 * taslak satış faturasına dönüşür; fatura orada kesinleşince seçilen hesaba
 * tahsilat açılır. Fatura açılamayan ya da tahsilatı açılamayan ödemeler
 * burada listelenir ve yeniden denenir.
 */
function FaturaKarti({ onBasari, onHata }: { onBasari: (m: string) => void; onHata: (m: string) => void }) {
  const { veri, yukleniyor, hata: yuklemeHatasi, yenile } = usePlatformVerisi<Partial<FaturaAyari>>("/platform/abonelik-fatura");
  const { veri: hamFirmalar, yukleniyor: firmaYukleniyor, hata: firmaHatasi, yenile: firmaYenile } = usePlatformVerisi<{ tenantId: string; unvan: string; vkn: string }[]>("/platform/firmalar");
  const firmalar = Array.isArray(hamFirmalar) ? hamFirmalar : [];
  const [taslak, setTaslak] = useState<{ firma: string; kart: string; elle: string } | null>(null);
  const [islem, setIslem] = useState(false);
  const ayar: FaturaAyari | null = veri ? {
    faturalayan: veri.faturalayan ?? null, etkinSaglayici: veri.etkinSaglayici ?? null, kartHesap: veri.kartHesap ?? null, elleHesap: veri.elleHesap ?? null,
    baslangicAt: veri.baslangicAt ?? null, hesaplar: Array.isArray(veri.hesaplar) ? veri.hesaplar : [], sorunlu: Array.isArray(veri.sorunlu) ? veri.sorunlu : [],
  } : null;
  const firma = taslak?.firma ?? ayar?.faturalayan?.tenantId ?? "";
  const kart = taslak?.kart ?? hesapDegeri(ayar?.kartHesap ?? null);
  const elle = taslak?.elle ?? hesapDegeri(ayar?.elleHesap ?? null);
  const { veri: firmaHesaplari, yukleniyor: hesapYukleniyor, hata: hesapHatasi, yenile: hesapYenile } = usePlatformVerisi<Hesap[]>(ayar && firma && firma !== ayar.faturalayan?.tenantId ? `/platform/abonelik-fatura/hesaplar/${encodeURIComponent(firma)}` : null);
  const hesaplar = firma === ayar?.faturalayan?.tenantId ? ayar.hesaplar : Array.isArray(firmaHesaplari) ? firmaHesaplari : [];
  const tlHesaplar = hesaplar.filter((h) => h.doviz === "TRY");
  // PLT-38: kartla alınan ödeme yalnız etkin sağlayıcının TL POS hesabına işlenir.
  const kartHesaplari = tlHesaplar.filter((h) => h.tur === "pos" && (!ayar?.etkinSaglayici || h.saglayici === ayar.etkinSaglayici));
  const seciliKart = hesaplar.find((h) => hesapDegeri(h) === kart);
  const kartUyumsuz = Boolean(kart && seciliKart && !kartHesaplari.some((h) => hesapDegeri(h) === kart));
  const degisti = Boolean(ayar && (firma !== (ayar.faturalayan?.tenantId ?? "") || kart !== hesapDegeri(ayar.kartHesap) || elle !== hesapDegeri(ayar.elleHesap)));
  const taslakYaz = (ek: Partial<{ firma: string; kart: string; elle: string }>) => setTaslak({ firma, kart, elle, ...ek });

  async function calistir(is: () => Promise<{ mesaj: string }>) {
    if (islem) return;
    setIslem(true);
    try { onBasari((await is()).mesaj); yenile(); }
    catch (e) { onHata(e instanceof Error ? e.message : "İşlem tamamlanamadı."); }
    finally { setIslem(false); }
  }

  function kaydet() {
    if (!ayar || hesapYukleniyor || hesapHatasi || islem) return;
    const firmaDegisti = firma !== (ayar.faturalayan?.tenantId ?? "");
    if (firmaDegisti && firma && !confirm("Bu tarihten sonraki abonelik ödemeleri için seçilen firmada taslak satış faturası açılsın mı? Geçmiş ödemeler faturalanmaz.")) return;
    if (firmaDegisti && !firma && !confirm("Otomatik abonelik faturası kapatılsın mı?")) return;
    void calistir(() => platformApi<{ mesaj: string }>("/platform/abonelik-fatura", { method: "PUT", body: JSON.stringify({ faturalayanTenantId: firma || null, kartHesap: firma ? hesapAyir(kart) : null, elleHesap: firma ? hesapAyir(elle) : null }) }));
  }

  if (!ayar) return <Card id="abonelik-faturasi" title="Abonelik faturası">{yuklemeHatasi ? <><Alert tone="error">{yuklemeHatasi}</Alert><Button onClick={yenile}>Fatura ayarını yeniden yükle</Button></> : <p className="muted" role="status">Fatura ayarları yükleniyor…</p>}</Card>;
  const hesapSecimi = (deger: string, anahtar: "kart" | "elle", etiket: string, liste: Hesap[], ipucu?: string) => <div><Field label={etiket}>
    <Select value={deger} disabled={!firma || islem || hesapYukleniyor || Boolean(hesapHatasi)} onChange={(e) => taslakYaz({ [anahtar]: e.target.value })}>
      <option value="">— Seçilmedi (tahsilat açılmaz) —</option>
      {anahtar === "kart" && kartUyumsuz && seciliKart && <option value={deger}>{HESAP_TURU[seciliKart.tur]} · {seciliKart.ad} (uygun değil)</option>}
      {liste.map((h) => <option key={`${h.tur}:${h.id}`} value={`${h.tur}:${h.id}`}>{HESAP_TURU[h.tur]} · {h.ad}</option>)}
    </Select>
  </Field>{ipucu && <small className="platform-field-help">{ipucu}</small>}</div>;

  return <Card id="abonelik-faturasi" title="Abonelik faturası" className="platform-invoice-card">
    <div className="stack">
      <div className="row-tight">{ayar.faturalayan ? <Badge variant="success">Açık · {ayar.faturalayan.unvan}</Badge> : <Badge variant="neutral">Kapalı</Badge>}{ayar.baslangicAt && <span className="subtle">{new Date(ayar.baslangicAt).toLocaleString("tr-TR")} sonrası ödemeler faturalanır</span>}</div>
      {kartUyumsuz && <Alert tone="warning">Seçili kart hesabı ({seciliKart?.ad}) {ayar.etkinSaglayici ? `etkin sağlayıcının (${SAGLAYICI_ADI[ayar.etkinSaglayici] ?? ayar.etkinSaglayici}) POS hesabı değil` : "bir POS hesabı değil"}. Kartla alınan ödemelerin tahsilatı POS işlemlerinde görünmez; uygun bir POS hesabı seçip kaydedin.</Alert>}
      {degisti && <Alert tone="warning">Kaydedilmemiş ayarlar var. Seçimleriniz Kaydet düğmesine bastığınızda uygulanır.</Alert>}
      <p className="platform-field-help">Ödemeler seçilen firmada taslak satış faturasına dönüşür. Kesinleştirme ve gönderim, o firmanın Faturalar ekranında yapılır. Kesinleşen faturanın tahsilatı seçilen hesaba işlenir.</p>
      {firmaHatasi && <Alert tone="error">Firma listesi yüklenemedi: {firmaHatasi} <Button size="sm" onClick={firmaYenile}>Firmaları yeniden yükle</Button></Alert>}
      <div className="platform-invoice-fields">
        <Field label="Faturalayan firma"><Select value={firma} disabled={islem || firmaYukleniyor || Boolean(firmaHatasi)} onChange={(e) => taslakYaz({ firma: e.target.value, kart: "", elle: "" })}>
          <option value="">— Kapalı —</option>
          {ayar.faturalayan && !firmalar?.some((f) => f.tenantId === ayar.faturalayan!.tenantId) && <option value={ayar.faturalayan.tenantId}>{ayar.faturalayan.unvan}</option>}
          {(firmalar ?? []).map((f) => <option key={f.tenantId} value={f.tenantId}>{f.unvan} · {f.vkn}</option>)}
        </Select></Field>
        {hesapSecimi(kart, "kart", "Kartla alınan ödemelerin hesabı", kartHesaplari, ayar.etkinSaglayici ? `Yalnız ${SAGLAYICI_ADI[ayar.etkinSaglayici] ?? ayar.etkinSaglayici} POS hesapları; tahsilat POS işlemleri listesine komisyon ve kart bilgisiyle düşer.` : "Yalnız POS hesapları.")}
        {hesapSecimi(elle, "elle", "Elle (havale) alınan ödemelerin hesabı", tlHesaplar)}
      </div>
      {hesapYukleniyor && <p className="platform-field-help" role="status">Seçilen firmanın hesapları yükleniyor…</p>}
      {hesapHatasi && <Alert tone="error">Hesaplar yüklenemedi: {hesapHatasi} <Button size="sm" onClick={hesapYenile}>Hesapları yeniden yükle</Button></Alert>}
      {firma && !hesapYukleniyor && !hesapHatasi && !tlHesaplar.length && <Alert tone="warning">Seçilen firmada TL kasa, banka ya da POS hesabı yok; tahsilat açılamaz.</Alert>}
      <div className="platform-row-actions"><Button variant="primary" disabled={islem || yukleniyor || hesapYukleniyor || firmaYukleniyor || Boolean(hesapHatasi) || Boolean(firmaHatasi)} onClick={kaydet}>{islem ? "Kaydediliyor…" : "Kaydet"}</Button></div>
      <div className="platform-section-heading"><h2>İşlem bekleyen faturalar</h2><Badge variant={ayar.sorunlu.length ? "warning" : "success"}>{ayar.sorunlu.length} kayıt</Badge></div>
      {ayar.sorunlu.length ? <TableWrap className="platform-responsive-table platform-invoice-table">
        <thead><tr><th>Firma</th><th>Durum</th><th>Fatura</th><th>Ayrıntı</th><th className="num">Deneme</th><th>İşlem</th></tr></thead>
        <tbody>{ayar.sorunlu.map((s) => <tr key={s.odemeId}>
          <td data-label="Firma" className="platform-cell-title">{s.firma}</td>
          <td data-label="Durum"><Badge variant={s.durum === "hata" ? "danger" : "warning"}>{SORUN[s.durum]}</Badge></td>
          <td data-label="Fatura">{s.faturaNo ?? "—"}</td>
          <td data-label="Ayrıntı" className="subtle">{s.hata ?? "—"}<div>{new Date(s.guncellendi).toLocaleString("tr-TR")}</div></td>
          <td data-label="Deneme" className="num">{s.deneme}</td>
          <td data-label="İşlem"><Button size="sm" disabled={islem} onClick={() => void calistir(() => platformApi<{ mesaj: string }>(`/platform/abonelik-fatura/${encodeURIComponent(s.odemeId)}/yeniden-dene`, { method: "POST" }))}>Yeniden dene</Button></td>
        </tr>)}</tbody>
      </TableWrap> : <p className="platform-field-help">Yeniden işlem bekleyen fatura veya tahsilat yok.</p>}
    </div>
  </Card>;
}

function SaglayiciKarti({ s, onTamam, onHata, kilitli, onIslem }: { s: Saglayici; kilitli: boolean; onIslem: (v: boolean) => void; onTamam: (m: string) => Promise<void>; onHata: (m: string) => void }) {
  const [ortam, setOrtam] = useState(s.ortam);
  const [alanlar, setAlanlar] = useState<Record<string, string>>(() => Object.fromEntries(s.alanlar.map((a) => [a.anahtar, a.gizli ? "" : a.deger ?? ""])));
  const [islem, setIslem] = useState(false);

  async function kaydet(etkin: boolean) {
    if (islem || kilitli) return;
    if (etkin && ortam === "canli" && !confirm(`${s.ad} canlı ortamda etkinleştirilsin mi? Firmaların kartından gerçek çekim yapılır.`)) return;
    setIslem(true); onIslem(true);
    try {
      const r = await platformApi<{ mesaj: string }>(`/platform/odeme-saglayicilari/${s.saglayici}`, { method: "PUT", body: JSON.stringify({ ortam, etkin, alanlar }) });
      setAlanlar((v) => Object.fromEntries(s.alanlar.map((a) => [a.anahtar, a.gizli ? "" : v[a.anahtar] ?? ""])));
      await onTamam(r.mesaj);
    } catch (e) {
      onHata(e instanceof Error ? e.message : "Kaydedilemedi");
    } finally {
      setIslem(false); onIslem(false);
    }
  }

  return (
    <Card title={s.ad} className="platform-provider-card">
      <div className="stack">
        <div className="row-tight">
          {s.etkin ? <Badge variant="success">Etkin · {s.ortam === "canli" ? "canlı" : "test"}</Badge> : <Badge variant="neutral">Kapalı</Badge>}
          {!s.bagli && <Badge variant="warning">Abonelik tahsilatı henüz bağlı değil</Badge>}
          {s.guncellendi && <span className="subtle">Son değişiklik {new Date(s.guncellendi).toLocaleString("tr-TR")}</span>}
        </div>
        {s.saglayici === "paytr" && <p className="subtle" style={{ margin: 0 }}>PayTR mağaza panelinde Direkt API, Non3D ve tekrarlayan ödeme yetkileri açık olmalı; <strong>Bildirim URL</strong> olarak şunu girin: <code>{s.bildirimAdresi}</code></p>}
        <p className="platform-field-help"><ShieldCheck size={14} aria-hidden="true" /> Gizli alanlar tekrar gösterilmez. Boş bırakırsanız kayıtlı değer korunur.</p>
        <div className="form-grid">
          <Field label="Ortam"><Select disabled={islem || kilitli} value={ortam} onChange={(e) => setOrtam(e.target.value as "test" | "canli")}><option value="test">Test (sandbox)</option><option value="canli">Canlı</option></Select></Field>
          {s.alanlar.map((a) => (
            <Field key={a.anahtar} label={a.etiket}>
              <Input
                type={a.gizli ? "password" : "text"}
                autoComplete="off"
                disabled={islem || kilitli}
                value={alanlar[a.anahtar] ?? ""}
                placeholder={a.gizli && a.dolu ? "Kayıtlı — değiştirmek için yazın" : ""}
                onChange={(e) => setAlanlar((x) => ({ ...x, [a.anahtar]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
        <div className="platform-row-actions">
          <Button disabled={islem || kilitli} onClick={() => void kaydet(s.etkin)}>{islem ? "Kaydediliyor…" : "Kaydet"}</Button>
          {s.etkin
            ? <Button variant="danger" disabled={islem || kilitli} onClick={() => void kaydet(false)}>Kapat</Button>
            : <Button variant="primary" disabled={islem || kilitli || !s.bagli} onClick={() => void kaydet(true)}>Kaydet ve etkinleştir</Button>}
        </div>
      </div>
    </Card>
  );
}
