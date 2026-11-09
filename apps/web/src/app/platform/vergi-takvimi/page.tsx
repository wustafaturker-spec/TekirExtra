"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap, Tarih } from "@/components/ui";
import { useKaydedilmemisUyarisi } from "@/lib/use-kaydedilmemis-uyarisi";
import { platformApi, platformDosyaYukle, platformIndir } from "@/lib/platform-api";
import { VERGI_YUKUMLULUK_ADLARI, VERGI_YUKUMLULUKLERI, vergiDonemAylari, vergiGunleriniCikar, vergiSonTarihHatasi, vergiTakvimOnerisi, vergiTarihUyarisi, type VergiGunDegeri, type VergiGunleri, type VergiYukumlulugu } from "@tekirextra/shared";

/** VTK-06/14: platform sistem yöneticisi takvimi hazırlar; yayın dört göz akışından geçer. */
interface TakvimSatiri { yukumluluk: VergiYukumlulugu; ay: number; sonTarih: string; oncekiSonTarih?: string | null }
interface Yanit { yil: number; bugun: string; yayinlanan: TakvimSatiri[]; oncekiYil: TakvimSatiri[]; acikDegisiklikler: { id: string; no: number; baslik: string; durum: string }[] }
interface OnizlemeSatiri extends TakvimSatiri { satirNo: number; durum: "yeni" | "degisen" | "ayni"; eskiTarih: string | null; uyari: string | null }
interface Onizleme { dosyaAdi: string; satirlar: OnizlemeSatiri[]; hatalar: { satirNo: number; mesaj: string }[] }

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const anahtar = (y: VergiYukumlulugu, ay: number) => `${y}:${ay}`;
const GUNLER = Array.from({ length: 31 }, (_, i) => i + 1);

export default function PlatformVergiTakvimiSayfasi() {
  const buYil = new Date().getFullYear();
  const [yil, setYil] = useState(buYil);
  const [veri, setVeri] = useState<Yanit | null>(null);
  const [taslak, setTaslak] = useState<Record<string, string>>({});
  const [gunler, setGunler] = useState<Partial<Record<VergiYukumlulugu, string>>>({});
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null);
  const [kaynakDosya, setKaynakDosya] = useState<string | null>(null);
  const [dayanak, setDayanak] = useState("");
  const [hata, setHata] = useState(""); const [bilgi, setBilgi] = useState(""); const [islem, setIslem] = useState(false);
  const dosyaGirdisi = useRef<HTMLInputElement>(null);

  const yukle = useCallback(async (hedef: number) => {
    setHata(""); setVeri(null);
    try {
      const v = await platformApi<Yanit>(`/platform/mevzuat/vergi-takvimi?yil=${hedef}`);
      setVeri(v); setTaslak(Object.fromEntries(v.yayinlanan.map((s) => [anahtar(s.yukumluluk, s.ay), s.sonTarih])));
      setOnizleme(null); setKaynakDosya(null);
    } catch (e) { setHata(e instanceof Error ? e.message : "Takvim yüklenemedi."); }
  }, []);
  useEffect(() => { void yukle(yil); }, [yil, yukle]);

  const yayinli = useMemo(() => new Map((veri?.yayinlanan ?? []).map((s) => [anahtar(s.yukumluluk, s.ay), s])), [veri]);
  const degisenler = useMemo(() => VERGI_YUKUMLULUKLERI.flatMap((y) => vergiDonemAylari(y).flatMap((ay) => {
    const t = taslak[anahtar(y, ay)];
    return t && t !== yayinli.get(anahtar(y, ay))?.sonTarih ? [{ yukumluluk: y, ay, sonTarih: t }] : [];
  })), [taslak, yayinli]);
  const hatalilar = degisenler.filter((s) => vergiSonTarihHatasi(yil, s.ay, s.sonTarih));
  useKaydedilmemisUyarisi(degisenler.length > 0);

  const yilSec = (y: number) => { if (!degisenler.length || window.confirm("Kaydedilmemiş tarihler silinecek. Devam edilsin mi?")) setYil(y); };
  const uygula = (satirlar: TakvimSatiri[]) => setTaslak((o) => ({ ...o, ...Object.fromEntries(satirlar.map((s) => [anahtar(s.yukumluluk, s.ay), s.sonTarih])) }));

  function gunleDoldur() {
    const secilen: VergiGunleri = {};
    for (const y of VERGI_YUKUMLULUKLERI) { const d = gunler[y]; if (d) secilen[y] = (d === "ay_sonu" ? d : Number(d)) as VergiGunDegeri; }
    if (!Object.keys(secilen).length) { setHata("En az bir yükümlülük için gün seçin."); return; }
    setHata(""); uygula(vergiTakvimOnerisi(yil, secilen)); setKaynakDosya(null);
    setBilgi("Tarihler önerildi. Hafta sonu ve resmî tatil kaydırıldı, arife günlerini kontrol edin.");
  }
  function oncekiYildanKopyala() {
    if (!veri?.oncekiYil.length) { setHata(`${yil - 1} yılı için yayınlanmış takvim yok.`); return; }
    const cikan = vergiGunleriniCikar(veri.oncekiYil, yil - 1);
    setHata(""); uygula(vergiTakvimOnerisi(yil, cikan)); setKaynakDosya(null);
    setGunler(Object.fromEntries(Object.entries(cikan).map(([k, v]) => [k, String(v)])));
    setBilgi(`${yil - 1} yılının günleri ${yil} yılına taşındı; tarihleri kontrol edin.`);
  }
  async function dosyaSec(dosya: File | undefined) {
    if (!dosya) return;
    setIslem(true); setHata(""); setBilgi("");
    try { setOnizleme(await platformDosyaYukle<Onizleme>(`/platform/mevzuat/vergi-takvimi/onizleme?yil=${yil}`, dosya)); }
    catch (e) { setHata(e instanceof Error ? e.message : "Dosya okunamadı."); }
    finally { setIslem(false); if (dosyaGirdisi.current) dosyaGirdisi.current.value = ""; }
  }
  function onizlemeyiUygula() {
    if (!onizleme || onizleme.hatalar.length) return;
    uygula(onizleme.satirlar); setKaynakDosya(onizleme.dosyaAdi);
    setBilgi(`${onizleme.satirlar.length} satır tabloya alındı. Kontrol edip onaya hazırlayın.`); setOnizleme(null);
  }
  async function indir() {
    setHata("");
    try { await platformIndir(`/platform/mevzuat/vergi-takvimi/sablon?yil=${yil}`, `vergi-takvimi-${yil}.xlsx`); }
    catch (e) { setHata(e instanceof Error ? e.message : "Şablon indirilemedi."); }
  }
  async function taslakOlustur() {
    setIslem(true); setHata(""); setBilgi("");
    try {
      const r = await platformApi<{ id: string }>("/platform/mevzuat/vergi-takvimi/taslak", { method: "POST", body: JSON.stringify({ yil, dayanak, kaynakDosya, satirlar: degisenler }) });
      setTaslak({}); window.location.href = `/platform/degisiklik?id=${r.id}`;
    } catch (e) { setHata(e instanceof Error ? e.message : "Taslak oluşturulamadı."); setIslem(false); }
  }

  const sayilar = onizleme ? { yeni: onizleme.satirlar.filter((s) => s.durum === "yeni").length, degisen: onizleme.satirlar.filter((s) => s.durum === "degisen").length, ayni: onizleme.satirlar.filter((s) => s.durum === "ayni").length } : null;
  const hucre = (y: VergiYukumlulugu, ay: number) => {
    if (!vergiDonemAylari(y).includes(ay)) return <td key={y} data-label={VERGI_YUKUMLULUK_ADLARI[y]} className="muted">—</td>;
    const k = anahtar(y, ay), t = taslak[k] ?? "", y2 = yayinli.get(k);
    const hataMetni = t ? vergiSonTarihHatasi(yil, ay, t) : null, uyari = t && !hataMetni ? vergiTarihUyarisi(t) : null;
    return <td key={y} data-label={VERGI_YUKUMLULUK_ADLARI[y]}>
      <Input type="date" aria-label={`${VERGI_YUKUMLULUK_ADLARI[y]} ${AYLAR[ay - 1]} ${yil} son tarihi`} value={t} onChange={(e) => setTaslak((o) => ({ ...o, [k]: e.target.value }))} />
      {t !== (y2?.sonTarih ?? "") && t && <div><Badge variant="warning">Değişti</Badge></div>}
      {y2?.oncekiSonTarih && <div className="muted" style={{ fontSize: "0.78rem" }}>Uzatıldı, eski: <Tarih deger={y2.oncekiSonTarih} /></div>}
      {hataMetni && <div className="is-negative" style={{ fontSize: "0.78rem" }}>{hataMetni}</div>}
      {uyari && <div className="muted" style={{ fontSize: "0.78rem" }}>{uyari}</div>}
    </td>;
  };

  return <div className="platform-editor">
    <PageHeader title="Vergi ve SGK Takvimi" subtitle="Son tarihleri hazırlayın. Yayın, ikinci yetkilinin onayıyla tüm firmalara geçer." actions={<Select aria-label="Yıl" value={yil} onChange={(e) => yilSec(Number(e.target.value))}>{[buYil - 1, buYil, buYil + 1, buYil + 2].map((y) => <option key={y} value={y}>{y}</option>)}</Select>} />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{bilgi}</Alert>
    {veri && veri.acikDegisiklikler.length > 0 && <Alert tone="warning">Bu yıl için açık değişiklik var: {veri.acikDegisiklikler.map((d) => <Link key={d.id} href={`/platform/degisiklik?id=${d.id}`} style={{ marginRight: "0.6rem" }}>#{d.no} {d.baslik}</Link>)}</Alert>}

    <Card title="Hızlı doldur">
      <div className="row-tight" style={{ flexWrap: "wrap", marginBottom: "1rem" }}>
        <Button onClick={() => void indir()}>Excel şablonunu indir</Button>
        <Button disabled={islem} onClick={() => dosyaGirdisi.current?.click()}>Excel yükle</Button>
        <input ref={dosyaGirdisi} type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Excel dosyası seç" onChange={(e) => void dosyaSec(e.target.files?.[0])} />
        <Button disabled={!veri?.oncekiYil.length} onClick={oncekiYildanKopyala}>{yil - 1} yılından kopyala</Button>
      </div>
      <div className="form-grid">
        {VERGI_YUKUMLULUKLERI.map((y) => <Field key={y} label={VERGI_YUKUMLULUK_ADLARI[y]}><Select value={gunler[y] ?? ""} onChange={(e) => setGunler((o) => ({ ...o, [y]: e.target.value }))}><option value="">Doldurma</option><option value="ay_sonu">Ay sonu</option>{GUNLER.map((g) => <option key={g} value={g}>Ayın {g}'i</option>)}</Select></Field>)}
      </div>
      <div style={{ marginTop: "0.8rem" }}><Button onClick={gunleDoldur}>Günle doldur</Button></div>
      <p className="platform-field-help">Gün, dönemi izleyen aya yazılır. Üç aylık muhtasarda izleyen ikinci aya yazılır.</p>
    </Card>

    {onizleme && sayilar && <Card title={`Önizleme: ${onizleme.dosyaAdi}`} actions={<div className="row-tight"><Button size="sm" onClick={() => setOnizleme(null)}>Vazgeç</Button><Button size="sm" variant="primary" disabled={onizleme.hatalar.length > 0 || !onizleme.satirlar.length} onClick={onizlemeyiUygula}>Tabloya al</Button></div>}>
      <p>{sayilar.yeni} yeni, {sayilar.degisen} değişen, {sayilar.ayni} aynı satır.{onizleme.hatalar.length > 0 && ` ${onizleme.hatalar.length} hata düzeltilmeden tabloya alınamaz.`}</p>
      {onizleme.hatalar.length > 0 && <Alert tone="error"><ul style={{ margin: 0, paddingLeft: "1.1rem" }}>{onizleme.hatalar.map((h) => <li key={`${h.satirNo}-${h.mesaj}`}>{h.satirNo}. satır: {h.mesaj}</li>)}</ul></Alert>}
      {onizleme.satirlar.some((s) => s.durum !== "ayni") && <TableWrap><table className="table table--fit"><thead><tr><th>Satır</th><th>Yükümlülük</th><th>Dönem</th><th>Eski tarih</th><th>Yeni tarih</th><th>Durum</th><th>Uyarı</th></tr></thead><tbody>
        {onizleme.satirlar.filter((s) => s.durum !== "ayni").map((s) => <tr key={s.satirNo}><td>{s.satirNo}</td><td>{VERGI_YUKUMLULUK_ADLARI[s.yukumluluk]}</td><td>{AYLAR[s.ay - 1]}</td><td>{s.eskiTarih ? <Tarih deger={s.eskiTarih} /> : "—"}</td><td><Tarih deger={s.sonTarih} /></td><td><Badge variant={s.durum === "yeni" ? "info" : "warning"}>{s.durum === "yeni" ? "Yeni" : "Değişen"}</Badge></td><td className="muted">{s.uyari ?? ""}</td></tr>)}
      </tbody></table></TableWrap>}
    </Card>}

    <Card title={`${yil} son tarihleri`} pad={false}>
      {!veri ? <p className="muted" style={{ padding: "1rem" }} role="status">Takvim yükleniyor…</p> : <TableWrap className="platform-responsive-table"><table className="table">
        <thead><tr><th>Dönem</th>{VERGI_YUKUMLULUKLERI.map((y) => <th key={y}>{VERGI_YUKUMLULUK_ADLARI[y]}</th>)}</tr></thead>
        <tbody>{AYLAR.map((ad, i) => <tr key={ad}><td data-label="Dönem"><strong>{ad}</strong></td>{VERGI_YUKUMLULUKLERI.map((y) => hucre(y, i + 1))}</tr>)}</tbody>
      </table></TableWrap>}
    </Card>

    <Card title="Onaya hazırla">
      <Field label="Mevzuat dayanağı"><Input value={dayanak} onChange={(e) => setDayanak(e.target.value)} maxLength={500} placeholder="ör. GİB 2027 vergi takvimi; süre uzatımı için sirküler sayısı" /></Field>
      <p className="muted">{degisenler.length} tarih yayınlanmış takvimden farklı{kaynakDosya ? `, kaynak ${kaynakDosya}` : ""}. Değişiklik taslağı açılır, ikinci yetkili yayınlayınca firmalara geçer.</p>
      <Button variant="primary" disabled={islem || !degisenler.length || hatalilar.length > 0 || dayanak.trim().length < 5} onClick={() => void taslakOlustur()}>Değişiklik taslağı oluştur</Button>
      {hatalilar.length > 0 && <p className="is-negative">{hatalilar.length} tarih hatalı; tabloda düzeltin.</p>}
    </Card>
  </div>;
}
