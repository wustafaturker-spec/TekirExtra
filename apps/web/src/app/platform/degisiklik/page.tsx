"use client";

import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useKaydedilmemisUyarisi } from "@/lib/use-kaydedilmemis-uyarisi";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { MEVZUAT_TUR_TANIMLARI, MEVZUAT_TURLERI, dilimMetni, dilimleriCoz, mevzuatDegerHatalari, mevzuatDegerOzeti, type MevzuatTuru } from "@tekirextra/shared";
import { KabulSenaryolari, type KabulSenaryosu } from "./kabul-senaryolari";
import { DURUM_ADI, DURUM_ROZETI, ISLEM_ADI, OLAY_ADI, tarihTR, type MevzuatDurum } from "@/lib/mevzuat-gorunum";
import { PlatformApiHata, platformApi, platformTokenAl } from "@/lib/platform-api";

type Islem = "ekle" | "degistir" | "kaldir";
interface Satir { tur: string; anahtar: string; islem: Islem; deger: Record<string, unknown> | null; oncekiDeger?: unknown; oncekiYururluk?: string | null }
interface Detay {
  id: string; no: number; baslik: string; dayanak: string; aciklama: string | null; yururlukBaslangic: string; durum: MevzuatDurum;
  retGerekcesi: string | null; yayinZamani: string | null;
  hazirlayan: { adSoyad: string }; yayinlayan: { adSoyad: string } | null;
  satirlar: Satir[]; planHatalari: string[];
  /** MVZ-06: etkilenecek taslak belge sayıları (kiracı bilgisi yok). */
  etki: { kalemler: { ad: string; taslakFatura: number; taslakBelge: number; taslakBordro: number; firma: number }[]; hesaplanmayan: string[] } | null;
  /** MVZ-14: bordro parametresi eklenen/değişen değişiklikte kabul senaryosu zorunlu. */
  kabulGerekli: boolean;
  kabulSenaryolari: KabulSenaryosu[];
  olaylar: { id: string; olay: string; zaman: string; kullanici: string | null; detay: Record<string, unknown> | null }[];
  izinler: { duzenle: boolean; onayaGonder: boolean; taslagaCek: boolean; yayinla: boolean; geriCevir: boolean };
  /** PLT-28: her yazım okunan sürümle gider; başkası araya girdiyse 409. */
  surum: number;
}

/** Düzenleyicideki satır: alan değerleri metin olarak tutulur, kaydederken türüne çevrilir. */
interface TaslakSatir { tur: MevzuatTuru; anahtar: string; islem: Islem; alanlar: Record<string, string>; oncekiDeger?: unknown; oncekiYururluk?: string | null }

function taslagaCevir(s: Satir): TaslakSatir {
  const tanim = MEVZUAT_TUR_TANIMLARI[s.tur as MevzuatTuru];
  const alanlar: Record<string, string> = {};
  for (const a of tanim?.alanlar ?? []) {
    const v = s.deger?.[a.ad];
    alanlar[a.ad] = v === undefined || v === null ? "" : a.tip === "dilimler" ? dilimMetni(v) : Array.isArray(v) ? v.join(", ") : String(v);
  }
  return { tur: s.tur as MevzuatTuru, anahtar: s.anahtar, islem: s.islem, alanlar, oncekiDeger: s.oncekiDeger, oncekiYururluk: s.oncekiYururluk };
}

function degereCevir(s: TaslakSatir): Record<string, unknown> | null {
  if (s.islem === "kaldir") return null;
  const deger: Record<string, unknown> = {};
  for (const a of MEVZUAT_TUR_TANIMLARI[s.tur].alanlar) {
    const metin = (s.alanlar[a.ad] ?? "").trim();
    if (!metin) continue;
    deger[a.ad] = a.tip === "oranlar" ? metin.split(/[,;\s]+/).filter(Boolean) : a.tip === "dilimler" ? dilimleriCoz(metin) : a.tip === "sayi" ? Number(metin.replace(",", ".")) : metin;
  }
  return deger;
}

function DegisiklikDetayi({ id }: { id: string }) {
  const yonlendir = useRouter();
  const [d, setD] = useState<Detay | null>(null);
  const [satirlar, setSatirlar] = useState<TaslakSatir[]>([]);
  const [degisti, setDegisti] = useState(false);
  const [bilgi, setBilgi] = useState({ baslik: "", dayanak: "", yururlukBaslangic: "", aciklama: "" });
  const [senaryoDegisti, setSenaryoDegisti] = useState(false);
  const [senaryoIslem, setSenaryoIslem] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [gerekce, setGerekce] = useState("");
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState(""); const [islem, setIslem] = useState(false);
  // PLT-28: 409 sonrası sunucudaki güncel kayıt; taslaklar korunur, kullanıcı karşılaştırıp seçer.
  const [cakisma, setCakisma] = useState<Detay | null>(null);
  const [senaryoAnahtari, setSenaryoAnahtari] = useState(0);

  const bilgiDegisti = Boolean(d && (bilgi.baslik !== d.baslik || bilgi.dayanak !== d.dayanak || bilgi.yururlukBaslangic !== d.yururlukBaslangic || bilgi.aciklama !== (d.aciklama ?? "")));
  const kirliAlanlar = useRef({ bilgi: false, kalem: false });
  kirliAlanlar.current = { bilgi: bilgiDegisti, kalem: degisti };
  const kaydedilmedi = degisti || bilgiDegisti || senaryoDegisti;
  useKaydedilmemisUyarisi(kaydedilmedi);
  const yansit = useCallback((v: Detay, bolum: "hepsi" | "bilgi" | "kalem" | "senaryo" = "hepsi") => {
    setD(v);
    if (bolum === "hepsi" || bolum === "kalem" || !kirliAlanlar.current.kalem) { setSatirlar(v.satirlar.map(taslagaCevir)); setDegisti(false); }
    if (bolum === "hepsi" || bolum === "bilgi" || !kirliAlanlar.current.bilgi) setBilgi({ baslik: v.baslik, dayanak: v.dayanak, yururlukBaslangic: v.yururlukBaslangic, aciklama: v.aciklama ?? "" });
  }, []);
  const yukle = useCallback(async (signal?: AbortSignal) => {
    setYukleniyor(true); setHata("");
    try { const v = await platformApi<Detay>(`/platform/mevzuat/degisiklikler/${id}`, { signal }); if (!signal?.aborted) yansit(v); }
    catch (e) { if (!signal?.aborted) setHata(e instanceof Error ? e.message : "Değişiklik yüklenemedi."); }
    finally { if (!signal?.aborted) setYukleniyor(false); }
  }, [id, yansit]);
  useEffect(() => {
    if (!id || !platformTokenAl()) return;
    const kontrol = new AbortController();
    void yukle(kontrol.signal);
    return () => kontrol.abort();
  }, [id, yukle]);

  /** PLT-28: güncel kaydı çeker ama taslaklara dokunmaz; karşılaştırma paneli açılır. */
  const cakismaYukle = useCallback(async () => {
    try { setCakisma(await platformApi<Detay>(`/platform/mevzuat/degisiklikler/${id}`)); }
    catch (e) { setHata(e instanceof Error ? e.message : "Güncel kayıt yüklenemedi."); }
  }, [id]);
  async function calis(is: () => Promise<Detay>, mesaj: string, bolum: "hepsi" | "bilgi" | "kalem" = "hepsi") {
    if (islem || senaryoIslem) return;
    setIslem(true); setHata(""); setBasari("");
    try { yansit(await is(), bolum); setBasari(mesaj); setCakisma(null); }
    catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem başarısız.");
      if (h instanceof PlatformApiHata && h.durum === 409) void cakismaYukle();
    }
    finally { setIslem(false); }
  }
  async function taslagiSil() {
    if (islem || senaryoIslem || !window.confirm("Taslak silinsin mi?")) return;
    setIslem(true); setHata("");
    try { await platformApi(`/platform/mevzuat/degisiklikler/${id}?surum=${d?.surum ?? 0}`, { method: "DELETE" }); yonlendir.replace("/platform"); }
    catch (h) {
      setHata(h instanceof Error ? h.message : "Taslak silinemedi.");
      if (h instanceof PlatformApiHata && h.durum === 409) void cakismaYukle();
    }
    finally { setIslem(false); }
  }
  const post = (yol: string, govde: Record<string, unknown> = {}) => platformApi<Detay>(`/platform/mevzuat/degisiklikler/${id}/${yol}`, { method: "POST", body: JSON.stringify({ ...govde, surum: d?.surum }) });

  function bilgiKaydet(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = new FormData(e.currentTarget);
    void calis(() => platformApi<Detay>(`/platform/mevzuat/degisiklikler/${id}`, { method: "PATCH", body: JSON.stringify({ baslik: v.get("baslik"), dayanak: v.get("dayanak"), yururlukBaslangic: v.get("yururlukBaslangic"), aciklama: v.get("aciklama") || null, surum: d?.surum }) }), "Bilgiler kaydedildi.", "bilgi");
  }
  const satirlariKaydet = () => calis(() => platformApi<Detay>(`/platform/mevzuat/degisiklikler/${id}/satirlar`, {
    method: "PUT", body: JSON.stringify({ satirlar: satirlar.map((s) => ({ tur: s.tur, anahtar: s.anahtar.trim(), islem: s.islem, deger: degereCevir(s) })), surum: d?.surum }),
  }), "Kalemler kaydedildi.", "kalem");
  const guncelle = (i: number, ek: Partial<TaslakSatir>) => { setSatirlar((eski) => eski.map((s, j) => (j === i ? { ...s, ...ek } : s))); setDegisti(true); };
  const satirEkle = () => { setSatirlar((eski) => [...eski, { tur: "tevkifat_kodu", anahtar: "", islem: "ekle", alanlar: {} }]); setDegisti(true); };
  /** Tek anahtarlı türde (bordro) anahtar kendiliğinden seçilir; yürürlükteki değer düzenlemeye başlangıç olur. */
  async function turSec(i: number, tur: MevzuatTuru) {
    const secenekler = MEVZUAT_TUR_TANIMLARI[tur].anahtarSecenekleri;
    const anahtar = secenekler?.length === 1 ? secenekler[0]![0] : "";
    guncelle(i, { tur, anahtar, alanlar: {} });
    if (!anahtar || !d) return;
    try {
      const [mevcut] = await platformApi<{ deger: Record<string, unknown> }[]>(`/platform/mevzuat/kayitlar?tur=${tur}&tarih=${d.yururlukBaslangic}`);
      if (mevcut) guncelle(i, { tur, anahtar, islem: "degistir", alanlar: taslagaCevir({ tur, anahtar, islem: "degistir", deger: mevcut.deger }).alanlar });
    } catch { /* başlangıç değeri isteğe bağlı */ }
  }
  const satirSil = (i: number) => { setSatirlar((eski) => eski.filter((_, j) => j !== i)); setDegisti(true); };

  if (!id) return <Alert tone="error">Değişiklik seçilmedi.</Alert>;
  if (!d) return <Card title="Mevzuat değişikliği">{yukleniyor ? <p className="muted" role="status">Değişiklik yükleniyor…</p> : <><Alert tone="error">{hata}</Alert><Button onClick={() => void yukle()}>Tekrar dene</Button></>}<p><Link href="/platform">Değişikliklere dön</Link></p></Card>;
  const duzenle = d.izinler.duzenle;
  // Sunucu onaya gönderirken senaryoları yeniden çalıştırır; tutmadığı bilinen ya da eksik senaryoda düğme baştan kapalı.
  const kabulEngeli = d.kabulGerekli && !d.kabulSenaryolari.length
    ? "Onaya göndermek için en az bir kabul senaryosu ekleyin."
    : d.kabulSenaryolari.some((k) => k.basarili === false)
      ? "Tutmayan kabul senaryosu var; değeri ya da beklentiyi düzeltip yeniden çalıştırın."
      : null;

  return <div className="platform-editor">
    <Link className="platform-back-link" href="/platform"><ArrowLeft size={16} aria-hidden="true" />Değişiklikler</Link>
    <PageHeader title={`#${d.no} ${d.baslik}`} subtitle="Düzenlemenin bilgilerini, kalemlerini ve yayın sürecini bu ekrandan yönetin." actions={<Link className="btn btn--ghost" href={`/platform/gorevler?degisiklik=${encodeURIComponent(id)}`}>Görev oluştur</Link>} />
    <div className="platform-editor-status"><Badge variant={DURUM_ROZETI[d.durum]}>{DURUM_ADI[d.durum]}</Badge>{kaydedilmedi && <Badge variant="warning">Kaydedilmemiş değişiklikler</Badge>}<span><ShieldCheck size={15} aria-hidden="true" /> Yayın için ikinci yetkili kontrolü gerekir.</span></div>
    <ol className="platform-publish-steps" aria-label="Yayın aşamaları">{(["taslak", "onay_bekliyor", "yayinlandi"] as const).map((durum, i) => <li key={durum} aria-current={d.durum === durum ? "step" : undefined}><span>{i + 1}</span>{DURUM_ADI[durum]}</li>)}</ol>
    <dl className="platform-editor-metadata"><div><dt>Mevzuat dayanağı</dt><dd>{d.dayanak}</dd></div><div><dt>Yürürlük başlangıcı</dt><dd>{tarihTR(d.yururlukBaslangic)}</dd></div><div><dt>Hazırlayan</dt><dd>{d.hazirlayan.adSoyad}</dd></div><div><dt>Yayınlayan</dt><dd>{d.yayinlayan?.adSoyad ?? "Henüz yayınlanmadı"}</dd></div></dl>
    <nav className="platform-section-nav" aria-label="Değişiklik bölümleri">{duzenle && <a href="#degisiklik-bilgileri">Bilgiler</a>}<a href="#degisiklik-kalemleri">Kalemler</a>{(d.kabulGerekli || d.kabulSenaryolari.length > 0 || senaryoDegisti) && <a href="#kabul-senaryolari">Kabul senaryoları</a>}<a href="#degisiklik-onayi">Onay ve yayın</a><a href="#degisiklik-gecmisi">Geçmiş</a></nav>
    <fieldset className="platform-editor-fieldset" disabled={islem || senaryoIslem}>
    <Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>
    {cakisma && <section className="platform-conflict" role="region" aria-label="Güncel kayıtla karşılaştırma">
      <Alert tone="warning">Bu değişiklik siz düzenlerken güncellendi (sürüm {d.surum} → {cakisma.surum}). Taslağınız korunuyor; aşağıdaki güncel kayıtla karşılaştırıp seçin.</Alert>
      <dl className="platform-editor-metadata">
        <div><dt>Durum</dt><dd>{DURUM_ADI[cakisma.durum]}{cakisma.durum !== d.durum && " (değişti)"}</dd></div>
        <div><dt>Başlık</dt><dd>{cakisma.baslik}{bilgiDegisti && cakisma.baslik !== bilgi.baslik && <span className="muted"> · sizin taslağınız: {bilgi.baslik}</span>}</dd></div>
        <div><dt>Dayanak</dt><dd>{cakisma.dayanak}{bilgiDegisti && cakisma.dayanak !== bilgi.dayanak && <span className="muted"> · sizin taslağınız: {bilgi.dayanak}</span>}</dd></div>
        <div><dt>Yürürlük</dt><dd>{tarihTR(cakisma.yururlukBaslangic)}{bilgiDegisti && cakisma.yururlukBaslangic !== bilgi.yururlukBaslangic && <span className="muted"> · sizin taslağınız: {tarihTR(bilgi.yururlukBaslangic)}</span>}</dd></div>
        <div><dt>Kalemler</dt><dd>{cakisma.satirlar.length} kalem: {cakisma.satirlar.map((x) => `${MEVZUAT_TUR_TANIMLARI[x.tur as MevzuatTuru]?.ad ?? x.tur} ${x.anahtar}`).join(", ") || "—"}{degisti && <span className="muted"> · sizin taslağınızda {satirlar.length} kalem</span>}</dd></div>
        <div><dt>Kabul senaryoları</dt><dd>{cakisma.kabulSenaryolari.length}</dd></div>
      </dl>
      <div className="row-tight">
        {cakisma.durum === "taslak" && <Button variant="primary" onClick={() => { yansit(cakisma, "senaryo"); setCakisma(null); setHata(""); setBasari("Taslağınız güncel sürüme taşındı; kontrol edip yeniden kaydedin."); }}>Taslağımı güncel sürüme taşı</Button>}
        <Button onClick={() => { yansit(cakisma, "hepsi"); setSenaryoAnahtari((n) => n + 1); setSenaryoDegisti(false); setCakisma(null); setHata(""); setBasari("Güncel kayıt açıldı; taslağınız bırakıldı."); }}>Taslağımı bırak, güncel kaydı aç</Button>
      </div>
    </section>}
    {d.durum === "taslak" && d.retGerekcesi && <Alert tone="warning">Geri çevrildi: {d.retGerekcesi}</Alert>}
    {d.durum !== "yayinlandi" && d.satirlar.length > 0 && d.planHatalari.length > 0 && <Alert tone="warning"><strong>Yayınlanamaz:</strong><ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem" }}>{d.planHatalari.map((h) => <li key={h}>{h}</li>)}</ul></Alert>}

    {duzenle && <Card id="degisiklik-bilgileri" title="Bilgiler">
      <form className="form-grid" onSubmit={bilgiKaydet}>
        <Field label="Başlık"><Input name="baslik" value={bilgi.baslik} onChange={(e) => setBilgi((v) => ({ ...v, baslik: e.target.value }))} required minLength={3} maxLength={200} /></Field>
        <Field label="Mevzuat dayanağı"><Input name="dayanak" value={bilgi.dayanak} onChange={(e) => setBilgi((v) => ({ ...v, dayanak: e.target.value }))} required minLength={5} maxLength={500} /></Field>
        <Field label="Yürürlük başlangıcı"><Input name="yururlukBaslangic" type="date" value={bilgi.yururlukBaslangic} onChange={(e) => setBilgi((v) => ({ ...v, yururlukBaslangic: e.target.value }))} required /></Field>
        <Field label="Açıklama" htmlFor="degisiklik-aciklama"><textarea id="degisiklik-aciklama" className="input platform-textarea" name="aciklama" value={bilgi.aciklama} onChange={(e) => setBilgi((v) => ({ ...v, aciklama: e.target.value }))} maxLength={2000} rows={3} /></Field>
        <div><Button type="submit" disabled={islem || !bilgiDegisti}>Bilgileri kaydet</Button></div>
      </form>
    </Card>}

    <Card id="degisiklik-kalemleri" title="Kalemler" pad={false} actions={duzenle ? <div className="row-tight"><Button size="sm" onClick={satirEkle}>+ Kalem</Button><Button size="sm" variant="primary" disabled={islem || !degisti} onClick={() => void satirlariKaydet()}>Kalemleri kaydet</Button></div> : undefined}>
      <TableWrap className="mevzuat-kalemler platform-responsive-table platform-editor-table">
        <thead><tr><th>Tür</th><th>Anahtar</th><th>İşlem</th><th>Yeni değer</th><th>Önceki değer</th>{duzenle && <th>İşlem</th>}</tr></thead>
        <tbody>
          {satirlar.map((s, i) => {
            const tanim = MEVZUAT_TUR_TANIMLARI[s.tur];
            const sorunlar = s.islem === "kaldir" || !s.anahtar ? [] : mevzuatDegerHatalari(s.tur, s.anahtar.trim(), degereCevir(s));
            return <tr key={i}>
              <td data-label="Tür">{duzenle
                ? <Select aria-label="Tür" style={{ minWidth: "11rem" }} value={s.tur} onChange={(e) => void turSec(i, e.target.value as MevzuatTuru)}>{MEVZUAT_TURLERI.map((t) => <option key={t} value={t}>{MEVZUAT_TUR_TANIMLARI[t].ad}</option>)}</Select>
                : tanim.ad}</td>
              <td data-label="Anahtar">{duzenle
                ? tanim.anahtarSecenekleri
                  ? <Select aria-label={tanim.anahtarEtiketi} style={{ minWidth: "10rem" }} value={s.anahtar} onChange={(e) => guncelle(i, { anahtar: e.target.value })}><option value="">Seçin</option>{tanim.anahtarSecenekleri.map(([k, ad]) => <option key={k} value={k}>{ad}</option>)}</Select>
                  : <Input aria-label={tanim.anahtarEtiketi} value={s.anahtar} placeholder={tanim.anahtarIpucu} onChange={(e) => guncelle(i, { anahtar: e.target.value })} style={{ maxWidth: "8rem" }} />
                : <strong>{tanim.anahtarSecenekleri?.find(([k]) => k === s.anahtar)?.[1] ?? s.anahtar}</strong>}</td>
              <td data-label="Düzenleme">{duzenle
                ? <Select aria-label="İşlem" style={{ minWidth: "7rem" }} value={s.islem} onChange={(e) => guncelle(i, { islem: e.target.value as Islem })}>{(["ekle", "degistir", "kaldir"] as const).map((x) => <option key={x} value={x}>{ISLEM_ADI[x]}</option>)}</Select>
                : ISLEM_ADI[s.islem]}</td>
              <td data-label="Yeni değer">{s.islem === "kaldir" ? <span className="muted">Yürürlükten kalkar</span> : duzenle
                ? tanim.etiketli
                  ? <div className="mevzuat-deger mevzuat-deger--etiketli">
                      {tanim.alanlar.map((a) => <label key={a.ad} className={a.tip === "dilimler" ? "mevzuat-alan--genis" : undefined}>{a.etiket}<Input aria-label={a.etiket} placeholder={a.ipucu} value={s.alanlar[a.ad] ?? ""} onChange={(e) => guncelle(i, { alanlar: { ...s.alanlar, [a.ad]: e.target.value } })} /></label>)}
                      {sorunlar.length > 0 && <span className="is-negative mevzuat-alan--genis" style={{ fontSize: "0.8rem" }}>{sorunlar.join(" · ")}</span>}
                    </div>
                  : <div className="mevzuat-deger">
                    {tanim.alanlar.map((a) => a.tip === "secim"
                      ? <Select key={a.ad} aria-label={a.etiket} value={s.alanlar[a.ad] ?? ""} onChange={(e) => guncelle(i, { alanlar: { ...s.alanlar, [a.ad]: e.target.value } })}><option value="">{a.etiket}</option>{a.secenekler?.map(([k, ad]) => <option key={k} value={k}>{ad}</option>)}</Select>
                      : <Input key={a.ad} aria-label={a.etiket} placeholder={`${a.etiket}${a.ipucu ? ` (${a.ipucu})` : ""}${a.zorunlu ? "" : " — isteğe bağlı"}`} value={s.alanlar[a.ad] ?? ""} onChange={(e) => guncelle(i, { alanlar: { ...s.alanlar, [a.ad]: e.target.value } })} />)}
                    {sorunlar.length > 0 && <span className="is-negative" style={{ fontSize: "0.8rem" }}>{sorunlar[0]}</span>}
                  </div>
                : mevzuatDegerOzeti(s.tur, degereCevir(s))}</td>
              <td data-label="Önceki değer" className="mevzuat-onceki">{s.oncekiDeger ? <>{mevzuatDegerOzeti(s.tur, s.oncekiDeger)}<br />{tarihTR(s.oncekiYururluk ?? null)}'den beri</> : "—"}</td>
              {duzenle && <td data-label="İşlem"><Button size="sm" variant="danger" onClick={() => satirSil(i)}>Sil</Button></td>}
            </tr>;
          })}
          {!satirlar.length && <tr><td colSpan={6}>Henüz kalem yok.</td></tr>}
        </tbody>
      </TableWrap>
      {duzenle && degisti && <p className="muted" style={{ padding: "0.8rem 1.25rem", margin: 0 }}>Kaydedilmemiş değişiklik var; onaya göndermeden önce kalemleri kaydedin.</p>}
    </Card>

    {(d.kabulGerekli || d.kabulSenaryolari.length > 0 || senaryoDegisti) && <KabulSenaryolari<Detay> key={senaryoAnahtari} degisiklikId={id} surum={d.surum} onCakisma={() => void cakismaYukle()} senaryolar={d.kabulSenaryolari} duzenle={duzenle} yayinlandi={d.durum === "yayinlandi"} kalemlerKaydedilmedi={degisti || bilgiDegisti} onKayitDurumu={setSenaryoDegisti} onIslemDurumu={setSenaryoIslem} onDegisti={(v) => yansit(v, "senaryo")} />}

    <Card id="degisiklik-onayi" title="Onay ve yayın">
      {d.etki && d.satirlar.length > 0 && <div style={{ marginBottom: "1rem" }}>
        <strong>Etki</strong>
        <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem" }}>
          {d.etki.kalemler.map((k) => k.ad === MEVZUAT_TUR_TANIMLARI.bordro_parametreleri.ad
            ? <li key={k.ad}>{k.ad}: yürürlükten sonraki aynı yıl dönemlerinde <strong>{k.taslakBordro}</strong> onaylanmamış bordro ({k.firma} firma) yeniden hesaplanınca yeni değerle hesaplanır. Onaylı bordrolar saklı değerleriyle kalır; değer ayın ilk gününden sonra yürürlüğe giriyorsa sonraki aydan uygulanır.</li>
            : <li key={k.ad}>{k.ad}: yürürlük tarihinden sonraki <strong>{k.taslakFatura}</strong> taslak fatura{k.taslakBelge ? <> ve <strong>{k.taslakBelge}</strong> taslak teklif/sipariş/irsaliye</> : null} ({k.firma} firma) bir sonraki kaydedişte yeni değerle denetlenir. Kesinleşmiş belgeler değişmez.</li>)}
          {!d.etki.kalemler.length && !d.etki.hesaplanmayan.length && <li>Yalnız yeni kalem ekleniyor; mevcut belgeler etkilenmez.</li>}
          {d.etki.hesaplanmayan.includes("vergi_takvimi") && <li className="muted">Vergi ve SGK son tarihleri: yayınlanınca tüm firmaların takviminde, nakit akışında ve bildirimlerinde görünür.</li>}
          {d.etki.hesaplanmayan.filter((t) => t !== "vergi_takvimi").map((t) => <li key={t} className="muted">{MEVZUAT_TUR_TANIMLARI[t as MevzuatTuru]?.ad ?? t}: belgede saklanmaz; yeni değer yürürlükten itibaren BA/BS, faturalama süresi, e-Arşiv iptal ve kıdem tazminatı hesaplarında kullanılır. Kıdem tavanı yalnız başladığı yarıyılda (Ocak–Haziran / Temmuz–Aralık) geçerlidir.</li>)}
        </ul>
      </div>}
      <div className="row-tight">
        {d.izinler.onayaGonder && <Button variant="primary" disabled={islem || kaydedilmedi || kabulEngeli !== null} onClick={() => void calis(() => post("onaya-gonder"), "Onaya gönderildi. Başka bir platform yetkilisi yayınlayacak.")}>Onaya gönder</Button>}
        {d.izinler.taslagaCek && <Button disabled={islem} onClick={() => void calis(() => post("taslaga-cek"), "Taslağa çekildi.")}>Taslağa çek</Button>}
        {d.izinler.yayinla && <Button variant="primary" disabled={islem || d.planHatalari.length > 0} onClick={() => { if (window.confirm(`#${d.no} ${d.baslik} yayınlanacak ve ${tarihTR(d.yururlukBaslangic)} tarihinden itibaren tüm kiracılar için geçerli olacak. Yayınlanan değişiklik geri alınamaz. Devam edilsin mi?`)) void calis(async () => (await platformApi<{ degisiklik: Detay }>(`/platform/mevzuat/degisiklikler/${id}/yayinla`, { method: "POST", body: JSON.stringify({ surum: d.surum }) })).degisiklik, "Yayınlandı. Kiracılara bildirim bir sonraki taramada düşer."); }}>Yayınla</Button>}
        {d.izinler.duzenle && <Button variant="danger" disabled={islem} onClick={() => void taslagiSil()}>Taslağı sil</Button>}
      </div>
      {d.izinler.onayaGonder && kaydedilmedi && <p className="platform-field-help">Onaya göndermeden önce bilgi, kalem ve senaryo değişikliklerini kaydedin.</p>}
      {d.izinler.onayaGonder && kabulEngeli && <p className="muted">{kabulEngeli}</p>}
      {d.izinler.geriCevir && <div className="form-grid" style={{ marginTop: "1rem" }}>
        <Field label="Geri çevirme gerekçesi"><Input value={gerekce} onChange={(e) => setGerekce(e.target.value)} placeholder="ör. dayanak sayısı eksik, 603 oranı kılavuzla tutmuyor" /></Field>
        <div><Button variant="danger" disabled={islem || gerekce.trim().length < 5} onClick={() => void calis(() => post("geri-cevir", { gerekce }), "Geri çevrildi; hazırlayan düzeltecek.")}>Geri çevir</Button></div>
      </div>}
      {d.durum === "onay_bekliyor" && !d.izinler.yayinla && <p className="muted">Bu değişikliği siz hazırladınız ya da düzenlediniz; dört göz ilkesi gereği başka bir platform yetkilisi yayınlamalı.</p>}
      {d.durum === "yayinlandi" && <p className="muted">Yayınlandı: {d.yayinZamani ? new Date(d.yayinZamani).toLocaleString("tr-TR") : ""}. Yayınlanan değişiklik değiştirilemez; düzeltme yeni bir değişiklikle yapılır.</p>}
    </Card>

    <Card id="degisiklik-gecmisi" title="Geçmiş">
      <ul className="mevzuat-olaylar">
        {d.olaylar.map((o) => <li key={o.id}><time>{new Date(o.zaman).toLocaleString("tr-TR")}</time><span><strong>{o.kullanici ?? "Sistem"}</strong> — {OLAY_ADI[o.olay] ?? o.olay}{o.olay === "geri_cevrildi" && o.detay?.gerekce ? `: ${String(o.detay.gerekce)}` : ""}</span></li>)}
      </ul>
      {!d.olaylar.length && <p className="muted">Henüz işlem kaydı yok.</p>}
    </Card>
    </fieldset>
  </div>;
}

function DegisiklikIcerigi() {
  const id = useSearchParams().get("id") ?? "";
  return <DegisiklikDetayi key={id} id={id} />;
}
export default function DegisiklikSayfasi() {
  return <Suspense fallback={<p className="muted" role="status">Yükleniyor…</p>}><DegisiklikIcerigi /></Suspense>;
}
