"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { api, tokenAl } from "@/lib/api";
import { bugunTR } from "@tekirextra/shared";

type Durum = "taslak" | "planlandi" | "malzeme_bekliyor" | "hazir" | "uretimde" | "kismen_tamamlandi" | "kalite_bekliyor" | "beklemede" | "durduruldu" | "tamamlandi" | "iptal_talebi" | "iptal";
interface Bildirim { id: string; uretilenMiktar: string; hurdaMiktari: string; hurdaNedeni?: string | null; yenidenIslemeMiktari: string; yenidenIslemeNedeni?: string | null; toplamMaliyet: string; bildirimTarihi: string; aciklama?: string | null }
type OperasyonDurum = "planlandi" | "hazir" | "devam_ediyor" | "tamamlandi" | "beklemede" | "iptal";
interface Durus { id: string; nedenKodu: string; aciklama?: string | null; planli: boolean; baslangic: string; bitis?: string | null; sureDakika: string }
interface Operasyon { id: string; sira: number; operasyonKodu: string; operasyonAdi: string; planlananDakika: string; gerceklesenDakika: string; planlananBaslangic: string; planlananBitis: string; fiiliBaslangic?: string | null; fiiliBitis?: string | null; durum: OperasyonDurum; isMerkezi: { kod: string; ad: string }; vardiya?: { id: string; kod: string; ad: string } | null; operator?: { id: string; adSoyad: string } | null; durus: Durus[] }
interface Vardiya { id: string; kod: string; ad: string; baslangicSaati: string; bitisSaati: string }
interface Operator { id: string; adSoyad: string; eposta: string }
interface SarfDuzeltme { id: string; tip: "ek_sarf" | "iade"; miktar: string; birimMaliyet: string; neden: string; createdAt: string; depo: { kod: string; ad: string }; uretimEmriKalem: { malzeme: { kod: string; ad: string; anaBirim: string } } }
interface Emir { id: string; no: string; tarih: string; durum: Durum; planlananMiktar: string; uretilenMiktar: string; hurdaMiktari: string; yenidenIslemeMiktari: string; toplamMaliyet: string; aciklama?: string | null; kapanisNedeni?: string | null; stok: { kod: string; ad: string; anaBirim: string; takipTipi: "yok" | "lot" | "seri" }; hedefDepo: { kod: string; ad: string }; bildirimler: Bildirim[]; operasyonlar: Operasyon[]; sarfDuzeltmeleri: SarfDuzeltme[] }
interface DepoUygunlugu { depoId: string; depoKod: string; depoAd: string; varsayilan: boolean; mevcutMiktar: string; rezerveMiktar: string; emirRezervi: string; kullanilabilirMiktar: string }
interface UygunlukKalemi { kalemId: string; stokKod: string; stokAd: string; takipTipi: "yok" | "lot" | "seri"; birim: string; varyant: { kod: string; ad: string } | null; gerekenMiktar: string; rezerveEdilenMiktar: string; kullanilabilirMiktar: string; eksikMiktar: string; yeterli: boolean; depolar: DepoUygunlugu[] }
interface Uygunluk { uretimeHazir: boolean; eksikKalemSayisi: number; kalemler: UygunlukKalemi[] }
interface MaliyetOzeti { kalemler: { malzeme: MaliyetKalemi; operasyon: MaliyetKalemi }; toplamlar: MaliyetKalemi & { sapmaYuzdesi: string } }
interface MaliyetKalemi { planlanan: string; gerceklesen: string; sapma: string }

const durumAdi: Record<Durum, string> = { taslak: "Taslak", planlandi: "Planlandı", malzeme_bekliyor: "Malzeme bekliyor", hazir: "Hazır", uretimde: "Üretimde", kismen_tamamlandi: "Kısmen tamamlandı", kalite_bekliyor: "Kalite bekliyor", beklemede: "Beklemede", durduruldu: "Durduruldu", tamamlandi: "Tamamlandı", iptal_talebi: "İptal talebi", iptal: "İptal" };
const operasyonDurumAdi: Record<OperasyonDurum, string> = { planlandi: "Planlandı", hazir: "Hazır", devam_ediyor: "Devam ediyor", tamamlandi: "Tamamlandı", beklemede: "Beklemede", iptal: "İptal" };
const sayi = (deger: string | number) => Number(deger).toLocaleString("tr-TR", { maximumFractionDigits: 3 });

export default function UretimEmriDetaySayfasi() {
  const { id } = useParams<{ id: string }>();
  const [emir, setEmir] = useState<Emir | null>(null);
  const [uygunluk, setUygunluk] = useState<Uygunluk | null>(null);
  const [maliyet, setMaliyet] = useState<MaliyetOzeti | null>(null);
  const [vardiyalar, setVardiyalar] = useState<Vardiya[]>([]); const [operatorler, setOperatorler] = useState<Operator[]>([]);
  const [vardiyaId, setVardiyaId] = useState(""); const [operatorId, setOperatorId] = useState(""); const [durusNedeni, setDurusNedeni] = useState("ariza"); const [durusAciklama, setDurusAciklama] = useState(""); const [durusPlanli, setDurusPlanli] = useState(false);
  const [hata, setHata] = useState("");
  const [islem, setIslem] = useState(false);
  const [bildirimAcik, setBildirimAcik] = useState(false);
  const [kapatAcik, setKapatAcik] = useState(false); const [kapatmaNedeni, setKapatmaNedeni] = useState("");
  const [bildirimMiktari, setBildirimMiktari] = useState("");
  const [hurdaMiktari, setHurdaMiktari] = useState("0");
  const [hurdaNedeni, setHurdaNedeni] = useState("");
  const [yenidenIslemeMiktari, setYenidenIslemeMiktari] = useState("0");
  const [yenidenIslemeNedeni, setYenidenIslemeNedeni] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [seriNumaralari, setSeriNumaralari] = useState("");
  const [uretimTarihi, setUretimTarihi] = useState("");
  const [sonKullanmaTarihi, setSonKullanmaTarihi] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [sarflar, setSarflar] = useState<Record<string, string>>({});
  const [duzeltmeKalemId, setDuzeltmeKalemId] = useState(""); const [duzeltmeDepoId, setDuzeltmeDepoId] = useState(""); const [duzeltmeTipi, setDuzeltmeTipi] = useState<"ek_sarf" | "iade">("ek_sarf"); const [duzeltmeMiktari, setDuzeltmeMiktari] = useState(""); const [duzeltmeNedeni, setDuzeltmeNedeni] = useState(""); const [duzeltmeLot, setDuzeltmeLot] = useState(""); const [duzeltmeSeriler, setDuzeltmeSeriler] = useState("");

  async function yukle() {
    const [emirVerisi, uygunlukVerisi, maliyetVerisi, vardiyaVerisi, operatorVerisi] = await Promise.all([api<Emir>(`/uretim/emirler/${id}`), api<Uygunluk>(`/uretim/emirler/${id}/malzeme-uygunlugu`), api<MaliyetOzeti>(`/uretim/emirler/${id}/maliyet`), api<Vardiya[]>("/uretim/vardiyalar"), api<Operator[]>("/uretim/operatorler")]);
    setEmir(emirVerisi); setUygunluk(uygunlukVerisi); setMaliyet(maliyetVerisi); setVardiyalar(vardiyaVerisi); setOperatorler(operatorVerisi); setVardiyaId((onceki) => onceki || vardiyaVerisi[0]?.id || ""); setOperatorId((onceki) => onceki || operatorVerisi[0]?.id || "");
  }
  useEffect(() => {
    if (!id || !tokenAl()) return;
    void yukle().catch((neden) => setHata(neden instanceof Error ? neden.message : "Üretim emri yüklenemedi"));
  }, [id]);
  useEffect(() => {
    if (!uygunluk?.kalemler.length || duzeltmeKalemId) return;
    setDuzeltmeKalemId(uygunluk.kalemler[0].kalemId);
    setDuzeltmeDepoId(uygunluk.kalemler[0].depolar[0]?.depoId ?? "");
  }, [uygunluk, duzeltmeKalemId]);

  async function malzemeAyir() {
    setIslem(true); setHata("");
    try { await api(`/uretim/emirler/${id}/rezerve-et`, { method: "POST" }); await yukle(); }
    catch (neden) { setHata(neden instanceof Error ? neden.message : "Malzemeler rezerve edilemedi"); }
    finally { setIslem(false); }
  }

  function bildirimFormunuAc() {
    if (!emir || !uygunluk) return;
    const kalan = Number(emir.planlananMiktar) - Number(emir.uretilenMiktar);
    setBildirimMiktari(String(kalan));
    setLotNo(emir.no);
    setSeriNumaralari("");
    setUretimTarihi(bugunTR());
    setSonKullanmaTarihi("");
    setSarflar(Object.fromEntries(uygunluk.kalemler.map((k) => [k.kalemId, k.gerekenMiktar])));
    setBildirimAcik(true);
  }

  async function bildirimKaydet(event: React.FormEvent) {
    event.preventDefault(); setIslem(true); setHata("");
    try {
      const seriler = seriNumaralari.split(/[\n,;]/).map((deger) => deger.trim()).filter(Boolean);
      if (emir?.stok.takipTipi === "seri") {
        if (!Number.isInteger(Number(bildirimMiktari)) || seriler.length !== Number(bildirimMiktari)) throw new Error(`${Number(bildirimMiktari)} iyi ürün için aynı sayıda benzersiz seri numarası girin.`);
        if (new Set(seriler).size !== seriler.length) throw new Error("Seri numaraları benzersiz olmalıdır.");
      }
      await api(`/uretim/emirler/${id}/bildirimler`, { method: "POST", body: JSON.stringify({
        idempotencyAnahtari: crypto.randomUUID(), uretilenMiktar: bildirimMiktari, hurdaMiktari, hurdaNedeni: Number(hurdaMiktari) > 0 ? hurdaNedeni : null, yenidenIslemeMiktari, yenidenIslemeNedeni: Number(yenidenIslemeMiktari) > 0 ? yenidenIslemeNedeni : null,
        lotNo: emir?.stok.takipTipi === "yok" ? null : lotNo,
        seriNumaralari: emir?.stok.takipTipi === "seri" ? seriler : undefined,
        uretimTarihi: uretimTarihi || null, sonKullanmaTarihi: sonKullanmaTarihi || null,
        aciklama: aciklama || null,
        sarflar: Object.entries(sarflar).map(([uretimEmriKalemId, miktar]) => ({ uretimEmriKalemId, miktar })),
      }) });
      setBildirimAcik(false); setAciklama(""); setHurdaMiktari("0"); setHurdaNedeni(""); setYenidenIslemeMiktari("0"); setYenidenIslemeNedeni(""); await yukle();
    } catch (neden) { setHata(neden instanceof Error ? neden.message : "Üretim bildirimi kaydedilemedi"); }
    finally { setIslem(false); }
  }

  async function emriKapat(event: React.FormEvent) {
    event.preventDefault(); setIslem(true); setHata("");
    try { await api(`/uretim/emirler/${id}/kapat`, { method: "POST", body: JSON.stringify({ neden: kapatmaNedeni }) }); setKapatAcik(false); setKapatmaNedeni(""); await yukle(); }
    catch (neden) { setHata(neden instanceof Error ? neden.message : "Üretim emri kapatılamadı"); }
    finally { setIslem(false); }
  }

  async function operasyonIsle(operasyon: Operasyon, eylem: "baslat" | "beklet" | "tamamla") {
    setIslem(true); setHata("");
    try { if (eylem === "baslat" && (!vardiyaId || !operatorId)) throw new Error("Operasyonu başlatmak için vardiya ve operatör seçin."); await api(`/uretim/emirler/${id}/operasyonlar/${operasyon.id}/${eylem}`, { method: "POST", body: JSON.stringify(eylem === "baslat" ? { vardiyaId, operatorId } : eylem === "beklet" ? { nedenKodu: durusNedeni, aciklama: durusAciklama || null, planli: durusPlanli } : {}) }); if (eylem === "beklet") setDurusAciklama(""); await yukle(); }
    catch (neden) { setHata(neden instanceof Error ? neden.message : "Operasyon işlemi başarısız"); }
    finally { setIslem(false); }
  }

  async function sarfDuzelt(event: React.FormEvent) { event.preventDefault(); setIslem(true); setHata(""); try { await api(`/uretim/emirler/${id}/sarf-duzeltmeleri`, { method: "POST", body: JSON.stringify({ idempotencyAnahtari: crypto.randomUUID(), uretimEmriKalemId: duzeltmeKalemId, depoId: duzeltmeDepoId, tip: duzeltmeTipi, miktar: duzeltmeMiktari, neden: duzeltmeNedeni, lotNo: duzeltmeLot || null, seriNumaralari: duzeltmeSeriler.split(/[\n,;]/).map((x) => x.trim()).filter(Boolean) }) }); setDuzeltmeMiktari(""); setDuzeltmeNedeni(""); setDuzeltmeLot(""); setDuzeltmeSeriler(""); await yukle(); } catch (neden) { setHata(neden instanceof Error ? neden.message : "Sarf düzeltmesi kaydedilemedi"); } finally { setIslem(false); } }

  if (!emir) return <div className="production-detail"><Link className="production-back" href="/panel/uretim">← Üretim emirlerine dön</Link><Alert tone="error">{hata}</Alert>{!hata && <Card>Üretim emri yükleniyor…</Card>}</div>;

  const durumVaryanti = emir.durum === "tamamlandi" ? "success" : emir.durum === "iptal" ? "danger" : emir.durum === "uretimde" ? "info" : "warning";
  const duzeltmeKalemi = uygunluk?.kalemler.find((kalem) => kalem.kalemId === duzeltmeKalemId);
  // Kapanmış emirde hazırlık ve çalışma formları anlamsız; yalnız kayıtlar görünür.
  const acik = !["tamamlandi", "iptal"].includes(emir.durum);
  const sarfDuzeltilebilir = ["uretimde", "kismen_tamamlandi", "kalite_bekliyor", "malzeme_bekliyor"].includes(emir.durum);
  return <div className="production-detail">
    <Link className="production-back" href="/panel/uretim">← Üretim emirlerine dön</Link>
    <PageHeader title={emir.no} subtitle={`${emir.stok.kod} — ${emir.stok.ad}`} actions={<div className="row-tight"><Badge variant={durumVaryanti}>{durumAdi[emir.durum]}</Badge>{["planlandi", "malzeme_bekliyor"].includes(emir.durum) && <Button size="sm" variant="primary" disabled={islem} onClick={() => void malzemeAyir()}>{islem ? "Ayrılıyor…" : "Malzemeleri ayır"}</Button>}{["uretimde", "kismen_tamamlandi"].includes(emir.durum) && <Button size="sm" variant="primary" disabled={islem} onClick={bildirimFormunuAc}>Üretim bildir</Button>}{["uretimde", "kismen_tamamlandi", "malzeme_bekliyor"].includes(emir.durum) && <Button size="sm" disabled={islem} onClick={() => setKapatAcik((v) => !v)}>Emri kapat</Button>}</div>} />
    <Alert tone="error">{hata}</Alert>
    <section className="production-summary" aria-label="Üretim emri özeti">
      <article><span>Planlanan üretim</span><strong>{sayi(emir.planlananMiktar)} {emir.stok.anaBirim}</strong><small>{new Date(emir.tarih).toLocaleDateString("tr-TR")}</small></article>
      <article><span>Gerçekleşen</span><strong>{sayi(emir.uretilenMiktar)} {emir.stok.anaBirim}</strong><small>Üretilen miktar</small></article>
      <article><span>Kayıp / yeniden işleme</span><strong>{sayi(emir.hurdaMiktari)} / {sayi(emir.yenidenIslemeMiktari)} {emir.stok.anaBirim}</strong><small>Hurda / yeniden işleme</small></article>
      <article><span>Mamul giriş deposu</span><strong>{emir.hedefDepo.ad}</strong><small>{emir.hedefDepo.kod}</small></article>
      <article><span>Toplam maliyet</span><strong>{sayi(emir.toplamMaliyet)} TL</strong><small>Gerçekleşen üretim maliyeti</small></article>
    </section>
    {maliyet && <Card title="Maliyet ve sapma"><section className="production-summary"><article><span>Planlanan toplam</span><strong>{sayi(maliyet.toplamlar.planlanan)} TL</strong><small>Standart malzeme ve operasyon</small></article><article><span>Gerçekleşen toplam</span><strong>{sayi(maliyet.toplamlar.gerceklesen)} TL</strong><small>Gerçek sarf ve fiilî süre</small></article><article><span>Toplam sapma</span><strong>{sayi(maliyet.toplamlar.sapma)} TL</strong><small>%{sayi(maliyet.toplamlar.sapmaYuzdesi)} · {Number(maliyet.toplamlar.sapma) > 0 ? "Maliyet aşımı" : "Tasarruf"}</small></article><article><span>Malzeme / Operasyon</span><strong>{sayi(maliyet.kalemler.malzeme.gerceklesen)} / {sayi(maliyet.kalemler.operasyon.gerceklesen)} TL</strong><small>Gerçekleşen dağılım</small></article></section></Card>}
    {acik && !!emir.operasyonlar.length && <Card title="Operasyon çalışma bilgileri"><div className="form-grid"><Field label="Vardiya"><Select value={vardiyaId} onChange={(e) => setVardiyaId(e.target.value)}><option value="">Vardiya seçin</option>{vardiyalar.map((v) => <option key={v.id} value={v.id}>{v.kod} — {v.ad} ({v.baslangicSaati}-{v.bitisSaati})</option>)}</Select></Field><Field label="Operatör"><Select value={operatorId} onChange={(e) => setOperatorId(e.target.value)}><option value="">Operatör seçin</option>{operatorler.map((o) => <option key={o.id} value={o.id}>{o.adSoyad}</option>)}</Select></Field><Field label="Duruş nedeni"><Select value={durusNedeni} onChange={(e) => setDurusNedeni(e.target.value)}><option value="ariza">Arıza</option><option value="malzeme_bekleme">Malzeme bekleme</option><option value="kalite_bekleme">Kalite bekleme</option><option value="ayar">Ayar / kurulum</option><option value="mola">Mola</option><option value="planli_bakim">Planlı bakım</option><option value="diger">Diğer</option></Select></Field><Field label="Duruş açıklaması"><Input value={durusAciklama} onChange={(e) => setDurusAciklama(e.target.value)} maxLength={500} placeholder="Bekletirken kaydedilir" /></Field><label className="checkbox"><input type="checkbox" checked={durusPlanli} onChange={(e) => setDurusPlanli(e.target.checked)} /> Planlı duruş</label></div></Card>}
    {!!emir.operasyonlar.length && <Card title="Operasyon rotası" pad={false}><div className="production-materials">{emir.operasyonlar.map((o) => <article key={o.id} className={o.durum === "tamamlandi" ? "is-enough" : ""}><header><div><span>{o.sira}. ADIM · {o.isMerkezi.kod}</span><h3>{o.operasyonKodu} — {o.operasyonAdi}</h3><small>{o.isMerkezi.ad} · Plan {sayi(o.planlananDakika)} dk · Gerçekleşen {sayi(o.gerceklesenDakika)} dk{o.operator ? ` · ${o.operator.adSoyad}` : ""}{o.vardiya ? ` · ${o.vardiya.ad}` : ""}</small></div><Badge variant={o.durum === "tamamlandi" ? "success" : o.durum === "devam_ediyor" ? "info" : o.durum === "beklemede" ? "warning" : "neutral"}>{operasyonDurumAdi[o.durum]}</Badge></header>{!!o.durus?.length && <details><summary>Duruş geçmişi <span>{o.durus.length} kayıt</span></summary><div className="production-warehouses">{o.durus.map((d) => <div key={d.id}><span><strong>{d.nedenKodu.replaceAll("_", " ")}</strong><small>{d.aciklama || (d.planli ? "Planlı duruş" : "Plansız duruş")}</small></span><span><small>Başlangıç</small><strong>{new Date(d.baslangic).toLocaleString("tr-TR")}</strong></span><span><small>Süre</small><strong>{d.bitis ? `${sayi(d.sureDakika)} dk` : "Devam ediyor"}</strong></span></div>)}</div></details>}<div className="row-tight">{["hazir", "beklemede"].includes(o.durum) && <Button size="sm" variant="primary" disabled={islem || !vardiyaId || !operatorId} onClick={() => void operasyonIsle(o, "baslat")}>{o.durum === "beklemede" ? "Devam et" : "Başlat"}</Button>}{o.durum === "devam_ediyor" && <><Button size="sm" disabled={islem} onClick={() => void operasyonIsle(o, "beklet")}>Duruşa al</Button><Button size="sm" variant="primary" disabled={islem} onClick={() => void operasyonIsle(o, "tamamla")}>Tamamla</Button></>}</div></article>)}</div></Card>}
    {kapatAcik && <Card title="Emri kapat"><form className="form-grid" onSubmit={emriKapat}>
      <p className="production-note">Kalan {sayi(Number(emir.planlananMiktar) - Number(emir.uretilenMiktar))} {emir.stok.anaBirim} üretilmeyecek. Ayrılan malzeme serbest kalır, bekleyen operasyonlar iptal edilir. {emir.bildirimler.length ? "Emir üretilen miktarla tamamlanır." : "Hiç bildirim olmadığı için emir iptal edilir."}</p>
      <Field label="Kapatma nedeni"><Input required minLength={3} maxLength={250} value={kapatmaNedeni} onChange={(e) => setKapatmaNedeni(e.target.value)} placeholder="Örn. sipariş miktarı düşürüldü" /></Field>
      <div className="row-tight"><Button type="submit" variant="danger" disabled={islem}>{islem ? "Kapatılıyor…" : "Emri kapat"}</Button><Button type="button" disabled={islem} onClick={() => setKapatAcik(false)}>Vazgeç</Button></div>
    </form></Card>}
    {emir.kapanisNedeni && <Alert tone="warning">Emir kalan miktar üretilmeden kapatıldı: {emir.kapanisNedeni}</Alert>}
    {bildirimAcik && <Card title="Kısmi üretim bildirimi"><form className="form-grid" onSubmit={bildirimKaydet}>
      <Field label={`İyi ürün (${emir.stok.anaBirim})`}><Input required type="number" min="0.001" max={Number(emir.planlananMiktar) - Number(emir.uretilenMiktar)} step="0.001" value={bildirimMiktari} onChange={(e) => setBildirimMiktari(e.target.value)} /></Field>
      <Field label="Hurda miktarı"><Input required type="number" min="0" step="0.001" value={hurdaMiktari} onChange={(e) => setHurdaMiktari(e.target.value)} /></Field>
      {Number(hurdaMiktari) > 0 && <Field label="Hurda nedeni"><Input required minLength={3} maxLength={250} value={hurdaNedeni} onChange={(e) => setHurdaNedeni(e.target.value)} placeholder="Örn. ölçü toleransı dışında" /></Field>}
      <Field label="Yeniden işleme miktarı"><Input required type="number" min="0" step="0.001" value={yenidenIslemeMiktari} onChange={(e) => setYenidenIslemeMiktari(e.target.value)} /></Field>
      {Number(yenidenIslemeMiktari) > 0 && <Field label="Yeniden işleme nedeni"><Input required minLength={3} maxLength={250} value={yenidenIslemeNedeni} onChange={(e) => setYenidenIslemeNedeni(e.target.value)} placeholder="Örn. yüzey düzeltme" /></Field>}
      {emir.stok.takipTipi !== "yok" && <>
        <Field label="Lot / parti no"><Input required maxLength={100} value={lotNo} onChange={(e) => setLotNo(e.target.value)} /></Field>
        {emir.stok.takipTipi === "seri" && <Field label={`Seri numaraları (${sayi(bildirimMiktari || 0)} adet)`}><textarea className="textarea" required rows={5} value={seriNumaralari} onChange={(e) => setSeriNumaralari(e.target.value)} placeholder={"Her satıra bir seri numarası\nSN-0001\nSN-0002"} /><small>Satır, virgül veya noktalı virgülle ayırabilirsiniz.</small></Field>}
        <Field label="Üretim tarihi"><Input type="date" value={uretimTarihi} onChange={(e) => setUretimTarihi(e.target.value)} /></Field>
        <Field label="Son kullanma tarihi"><Input type="date" min={uretimTarihi || undefined} value={sonKullanmaTarihi} onChange={(e) => setSonKullanmaTarihi(e.target.value)} /></Field>
      </>}
      {uygunluk?.kalemler.map((kalem) => <Field key={kalem.kalemId} label={`${kalem.stokKod} gerçek sarf (${kalem.birim})`}><Input required type="number" min="0.001" step="0.001" value={sarflar[kalem.kalemId] ?? ""} onChange={(e) => setSarflar((onceki) => ({ ...onceki, [kalem.kalemId]: e.target.value }))} /></Field>)}
      <Field label="Açıklama"><Input maxLength={500} value={aciklama} onChange={(e) => setAciklama(e.target.value)} /></Field>
      <div className="row-tight"><Button type="submit" variant="primary" disabled={islem}>{islem ? "Kaydediliyor…" : "Bildirimi kaydet"}</Button><Button type="button" disabled={islem} onClick={() => setBildirimAcik(false)}>Vazgeç</Button></div>
    </form></Card>}
    {acik && uygunluk && <section className={`production-readiness ${uygunluk.uretimeHazir ? "is-ready" : "is-short"}`}><div className="production-readiness__icon" aria-hidden="true">{uygunluk.uretimeHazir ? "✓" : "!"}</div><div><strong>{uygunluk.uretimeHazir ? "Malzemeler üretime hazır" : `${uygunluk.eksikKalemSayisi} malzemede stok açığı var`}</strong><p>{uygunluk.uretimeHazir ? "Tüm reçete kalemleri için yeterli kullanılabilir stok bulunuyor." : "Üretime başlamadan önce eksik malzemelerin tedarik veya transfer planını oluşturun."}</p></div></section>}
    {sarfDuzeltilebilir && !!uygunluk?.kalemler.length && <Card title="Sarf düzeltme ve malzeme iadesi"><form className="form-grid" onSubmit={sarfDuzelt}>
      <Field label="Malzeme"><Select required value={duzeltmeKalemId} onChange={(e) => { const kalemId = e.target.value; const kalem = uygunluk.kalemler.find((x) => x.kalemId === kalemId); setDuzeltmeKalemId(kalemId); setDuzeltmeDepoId(kalem?.depolar[0]?.depoId ?? ""); setDuzeltmeLot(""); setDuzeltmeSeriler(""); }}>{uygunluk.kalemler.map((kalem) => <option key={kalem.kalemId} value={kalem.kalemId}>{kalem.stokKod} — {kalem.stokAd}</option>)}</Select></Field>
      <Field label="İşlem"><Select value={duzeltmeTipi} onChange={(e) => setDuzeltmeTipi(e.target.value as "ek_sarf" | "iade")}><option value="ek_sarf">Ek sarf</option><option value="iade">Depoya iade</option></Select></Field>
      <Field label="Depo"><Select required value={duzeltmeDepoId} onChange={(e) => setDuzeltmeDepoId(e.target.value)}><option value="">Depo seçin</option>{duzeltmeKalemi?.depolar.map((depo) => <option key={depo.depoId} value={depo.depoId}>{depo.depoKod} — {depo.depoAd}</option>)}</Select></Field>
      <Field label={`Miktar${duzeltmeKalemi ? ` (${duzeltmeKalemi.birim})` : ""}`}><Input required type="number" min="0.001" step="0.001" value={duzeltmeMiktari} onChange={(e) => setDuzeltmeMiktari(e.target.value)} /></Field>
      {duzeltmeTipi === "iade" && duzeltmeKalemi?.takipTipi !== "yok" && <Field label="Lot / parti no"><Input required={duzeltmeKalemi?.takipTipi === "lot"} maxLength={100} value={duzeltmeLot} onChange={(e) => setDuzeltmeLot(e.target.value)} /></Field>}
      {duzeltmeTipi === "iade" && duzeltmeKalemi?.takipTipi === "seri" && <Field label="İade edilen seri numaraları"><textarea className="textarea" required rows={4} value={duzeltmeSeriler} onChange={(e) => setDuzeltmeSeriler(e.target.value)} placeholder={"Her satıra bir seri numarası\nSN-0001"} /><small>Girilen seri adedi iade miktarıyla aynı olmalıdır.</small></Field>}
      <Field label="Düzeltme nedeni"><Input required minLength={3} maxLength={250} value={duzeltmeNedeni} onChange={(e) => setDuzeltmeNedeni(e.target.value)} placeholder="Örn. hatalı tartım düzeltmesi" /></Field>
      <div className="row-tight"><Button type="submit" variant="primary" disabled={islem || !duzeltmeDepoId}>{islem ? "Kaydediliyor…" : duzeltmeTipi === "ek_sarf" ? "Ek sarfı kaydet" : "İadeyi kaydet"}</Button></div>
    </form></Card>}
    <Card title={<><span className="production-eyebrow">MALZEME PLANI</span><h2>Reçete ve stok uygunluğu</h2></>}>
      <div className="production-materials">
        {uygunluk?.kalemler.map((kalem) => <article key={kalem.kalemId} className={kalem.yeterli ? "is-enough" : "is-missing"}>
          <header><div><span>{kalem.stokKod}</span><h3>{kalem.stokAd}</h3>{kalem.varyant && <small>{kalem.varyant.kod} — {kalem.varyant.ad}</small>}</div><Badge variant={kalem.yeterli ? "success" : "danger"}>{kalem.yeterli ? "Yeterli" : "Eksik"}</Badge></header>
          <div className="production-material__numbers"><div><span>Gereken</span><strong>{sayi(kalem.gerekenMiktar)} {kalem.birim}</strong></div><div><span>Bu emir için ayrılan</span><strong>{sayi(kalem.rezerveEdilenMiktar)} {kalem.birim}</strong></div><div><span>Kullanılabilir</span><strong>{sayi(kalem.kullanilabilirMiktar)} {kalem.birim}</strong></div><div><span>Eksik</span><strong>{sayi(kalem.eksikMiktar)} {kalem.birim}</strong></div></div>
          <details><summary>Depo dağılımı <span>{kalem.depolar.length} depo</span></summary><div className="production-warehouses">{kalem.depolar.map((depo) => <div key={depo.depoId}><span><strong>{depo.depoAd}</strong><small>{depo.depoKod}{depo.varsayilan ? " · Varsayılan" : ""}</small></span><span><small>Mevcut / Toplam rezerv</small><strong>{sayi(depo.mevcutMiktar)} / {sayi(depo.rezerveMiktar)}</strong></span><span><small>Bu emir / Kullanılabilir</small><strong>{sayi(depo.emirRezervi)} / {sayi(depo.kullanilabilirMiktar)} {kalem.birim}</strong></span></div>)}{!kalem.depolar.length && <p>Aktif depolarda stok bakiyesi bulunmuyor.</p>}</div></details>
        </article>)}
        {!uygunluk?.kalemler.length && <p className="production-empty">Bu emirde malzeme kalemi bulunmuyor.</p>}
      </div>
    </Card>
    {!!emir.sarfDuzeltmeleri?.length && <Card title="Sarf düzeltme geçmişi"><div className="production-materials">{emir.sarfDuzeltmeleri.map((duzeltme) => <article key={duzeltme.id} className={duzeltme.tip === "iade" ? "is-enough" : "is-missing"}><header><div><span>{new Date(duzeltme.createdAt).toLocaleString("tr-TR")} · {duzeltme.depo.kod}</span><h3>{duzeltme.uretimEmriKalem.malzeme.kod} — {duzeltme.uretimEmriKalem.malzeme.ad}</h3><small>{duzeltme.neden} · Birim maliyet: {sayi(duzeltme.birimMaliyet)} TL</small></div><Badge variant={duzeltme.tip === "iade" ? "success" : "warning"}>{duzeltme.tip === "iade" ? "İade" : "Ek sarf"} · {sayi(duzeltme.miktar)} {duzeltme.uretimEmriKalem.malzeme.anaBirim}</Badge></header></article>)}</div></Card>}
    {!!emir.bildirimler.length && <Card title="Üretim bildirimleri"><div className="production-materials">{emir.bildirimler.map((bildirim) => <article key={bildirim.id} className="is-enough"><header><div><span>{new Date(bildirim.bildirimTarihi).toLocaleString("tr-TR")}</span><h3>{sayi(bildirim.uretilenMiktar)} {emir.stok.anaBirim} iyi ürün</h3><small>Hurda: {sayi(bildirim.hurdaMiktari)}{bildirim.hurdaNedeni ? ` (${bildirim.hurdaNedeni})` : ""} · Yeniden işleme: {sayi(bildirim.yenidenIslemeMiktari)}{bildirim.yenidenIslemeNedeni ? ` (${bildirim.yenidenIslemeNedeni})` : ""} · Maliyet: {sayi(bildirim.toplamMaliyet)} TL</small></div><Badge variant="success">İşlendi</Badge></header>{bildirim.aciklama && <p>{bildirim.aciklama}</p>}</article>)}</div></Card>}
    {emir.aciklama && <Card title="Üretim notu"><p className="production-note">{emir.aciklama}</p></Card>}
  </div>;
}
