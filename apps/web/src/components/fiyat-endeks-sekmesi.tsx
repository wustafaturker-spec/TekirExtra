"use client";

import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, Field, Input, Segmented, Select, TableWrap } from "@/components/ui";
import { EndeksGrafigi, type EndeksGrafikSerisi } from "@/components/endeks-grafigi";

/* ─── API sözleşmesi (apps/api/src/fiyat-endeks) ─────────────────────────── */
export interface FiyatEndeksSecenekleri {
  erisim: { satis: boolean; alis: boolean };
  endeksler: { kod: string; ad: string; tur: "endeks" | "kur"; bazYili: string | null; kaynak: string; sonDonem: string | null }[];
  fiyatListeleri: { id: string; ad: string; dovizCinsi: string }[];
  buAy: string;
}
interface FiyatSatiri { ay: string; durum: "tamam" | "yetersiz" | "yok" | "birim_kirilmasi"; satir: number; fiyat: string | null; endeks100: string | null; aylikDegisim: string | null; yillikDegisim: string | null }
interface Karsilastirma { endeks: string; bazAy: string; sonAy: string | null; bazFiyat: string | null; sonFiyat: string | null; fiyatDegisim: string | null; endeksDegisim: string | null; reelDegisim: string | null; olmasiGerekenFiyat: string | null; fark: string | null; neden: string | null }
interface Sonuc {
  stok: { id: string; kod: string; ad: string; anaBirim: string };
  aylar: string[];
  baz: string;
  esik: { enAzSatir: number };
  seriler: { anahtar: string; ad: string; taraf: "satis" | "alis"; satirlar: FiyatSatiri[]; karsilastirmalar: Karsilastirma[] }[];
  endeksler: { kod: string; ad: string; tur: "endeks" | "kur"; bazYili: string | null; sonDonem: string | null; kismiAy: string | null; degerler: { ay: string; deger: string | null; normal: string | null }[] }[];
  /** END-07: liste fiyatı, ağırlıklı ortalama maliyet, son alış fiyatı. */
  ekCizgiler: { anahtar: string; tur: EkCizgiTuru; ad: string; kaynak: string; yatay: boolean; degerler: { ay: string; fiyat: string | null; normal: string | null }[] }[];
  ekCizgiOlcegi: { seri: string; bazFiyat: string } | null;
  birimGecmisi: { ay: string; degistiAt: string; birim: string; eskiBirim: string | null; yeniBirim: string | null; eskiKatsayi: string | null; yeniKatsayi: string | null }[];
  uyarilar: string[];
}
type EkCizgiTuru = "liste" | "maliyet" | "sonAlis";
const EK_CIZGI_ADLARI: Record<EkCizgiTuru, string> = { liste: "Liste fiyatı", maliyet: "Ağırlıklı ortalama maliyet", sonAlis: "Son alış fiyatı" };

type Donem = "12" | "24" | "yil" | "ozel";
const ayEkle = (ay: string, n: number) => { const [y, a] = ay.split("-").map(Number); const t = new Date(Date.UTC(y, a - 1 + n, 1)); return t.toISOString().slice(0, 7); };
const ayAdi = (ay: string) => { const [y, a] = ay.slice(0, 7).split("-").map(Number); return new Date(Date.UTC(y, a - 1, 1)).toLocaleDateString("tr-TR", { month: "short", year: "numeric", timeZone: "UTC" }); };
const yuzde = (s: string | null) => (s === null ? "—" : `%${Number(s).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const tl = (s: string | null) => (s === null ? "—" : `${Number(s).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} TL`);
const yon = (s: string) => (Number(s) >= 0 ? "arttı" : "azaldı");
const mutlak = (s: string) => yuzde(String(Math.abs(Number(s))));

function ozetCumlesi(seriAdi: string, endeksAdi: string, k: Karsilastirma, birim: string): string {
  if (k.neden || !k.sonAy || !k.fiyatDegisim || !k.endeksDegisim || !k.reelDegisim) return `${seriAdi} × ${endeksAdi}: ${k.neden ?? "karşılaştırılamadı."}`;
  const reel = Number(k.reelDegisim);
  return `${seriAdi}: ${ayAdi(k.bazAy)} – ${ayAdi(k.sonAy)} arasında fiyat ${mutlak(k.fiyatDegisim)} ${yon(k.fiyatDegisim)}, ${endeksAdi} ${mutlak(k.endeksDegisim)} ${yon(k.endeksDegisim)}; `
    + `reel olarak ${mutlak(k.reelDegisim)} ${reel >= 0 ? "arttı" : "geriledi"}. Endekse göre fiyat ${tl(k.olmasiGerekenFiyat)}/${birim}, gerçekleşen ${tl(k.sonFiyat)}/${birim}.`;
}

/** CSV (Excel Türkçe ayarına uygun: noktalı virgül, ondalık virgül, BOM). */
function csvIndir(s: Sonuc) {
  const sayi = (v: string | null) => (v === null ? "" : v.replace(".", ","));
  const baslik = ["Ay", ...s.seriler.flatMap((x) => [`${x.ad} fiyat (TL/${s.stok.anaBirim})`, `${x.ad} aylık %`, `${x.ad} yıllık %`, `${x.ad} satır`, `${x.ad} durum`]), ...s.ekCizgiler.map((c) => `${c.ad} (TL/${s.stok.anaBirim})`), ...s.endeksler.flatMap((e) => [e.ad, `${e.ad} (baz=100)`])];
  const satirlar = s.aylar.map((ay, i) => [ay.slice(0, 7), ...s.seriler.flatMap((x) => { const r = x.satirlar[i]; return [sayi(r.fiyat), sayi(r.aylikDegisim), sayi(r.yillikDegisim), String(r.satir), r.durum]; }), ...s.ekCizgiler.map((c) => sayi(c.degerler[i].fiyat)), ...s.endeksler.flatMap((e) => [sayi(e.degerler[i].deger), sayi(e.degerler[i].normal)])]);
  const metin = [baslik, ...satirlar].map((r) => r.map((h) => `"${h.replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + metin], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `fiyat-endeks-${s.stok.kod}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/**
 * END-11: stok kartında "Fiyat ve endeks" sekmesi. Fiyat faturalardan gelir
 * (kullanıcı kararı 2026-11-14): tüm satışların ortalaması ya da seçilen
 * fiyat listelerine bağlı carilerin satışları; alış ayrı yetkiyle.
 */
export function FiyatEndeksSekmesi({ stokId, anaBirim, varyantlar, secenekler }: {
  stokId: string;
  anaBirim: string;
  varyantlar: { id: string; ad: string; kod?: string | null }[];
  secenekler: FiyatEndeksSecenekleri;
}) {
  const kimlik = useId();
  const buAy = secenekler.buAy;
  const [donem, setDonem] = useState<Donem>("12");
  const [ozelBas, setOzelBas] = useState(ayEkle(buAy, -11));
  const [ozelBit, setOzelBit] = useState(buAy);
  const [baz, setBaz] = useState("");
  const varsayilanEndeksler = secenekler.endeksler.filter((e) => e.kod === "TUFE" || e.kod === "USD").map((e) => e.kod);
  const [endeksler, setEndeksler] = useState<string[]>(varsayilanEndeksler.length ? varsayilanEndeksler : secenekler.endeksler.slice(0, 1).map((e) => e.kod));
  const [kapsam, setKapsam] = useState<"tum" | "liste">("tum");
  const [listeler, setListeler] = useState<string[]>([]);
  const [alis, setAlis] = useState(secenekler.erisim.alis && !secenekler.erisim.satis);
  const [varyantId, setVaryantId] = useState("");
  const [cizgiler, setCizgiler] = useState<EkCizgiTuru[]>([]);
  const secilebilirCizgiler = (Object.keys(EK_CIZGI_ADLARI) as EkCizgiTuru[]).filter((c) => (c === "liste" ? secenekler.erisim.satis : secenekler.erisim.alis));
  const [tekrar, setTekrar] = useState(0);
  const [yanit, setYanit] = useState<{ anahtar: string; sonuc: Sonuc | null; hata: string } | null>(null);

  const [baslangic, bitis] = donem === "12" ? [ayEkle(buAy, -11), buAy] : donem === "24" ? [ayEkle(buAy, -23), buAy] : donem === "yil" ? [`${buAy.slice(0, 4)}-01`, buAy] : [ozelBas, ozelBit];
  const bazAy = baz && baz >= baslangic && baz <= bitis ? baz : baslangic;
  const sorgu = useMemo(() => {
    const q = new URLSearchParams({ baslangic, bitis, baz: bazAy, endeksler: endeksler.join(",") });
    if (secenekler.erisim.satis && kapsam === "liste") { q.set("satisKapsami", "liste"); q.set("listeler", listeler.join(",")); }
    if (alis) q.set("alis", "1");
    if (varyantId) q.set("varyantId", varyantId);
    if (cizgiler.length) q.set("cizgiler", cizgiler.join(","));
    return q.toString();
  }, [baslangic, bitis, bazAy, endeksler, kapsam, listeler, alis, varyantId, cizgiler, secenekler.erisim.satis]);
  const filtreUyarisi = !baslangic || !bitis
    ? "Başlangıç ve bitiş ayını seçin."
    : baslangic > bitis
      ? "Başlangıç ayı bitiş ayından sonra olamaz."
      : !endeksler.length
        ? "En az bir endeks seçin."
        : kapsam === "liste" && secenekler.erisim.satis && !listeler.length
          ? "Fiyat listesine göre karşılaştırma için en az bir liste seçin."
          : !secenekler.erisim.satis && !alis ? "Karşılaştırılabilecek fiyat serisi yok." : "";
  const yol = filtreUyarisi ? null : `/fiyat-endeks/urun/${stokId}?${sorgu}`;
  const sorguAnahtari = yol ? JSON.stringify([yol, tekrar]) : null;
  const guncelYanit = sorguAnahtari && yanit?.anahtar === sorguAnahtari ? yanit : null;
  const sonuc = guncelYanit?.sonuc ?? null;
  const hata = guncelYanit?.hata ?? "";
  const yukleniyor = Boolean(sorguAnahtari && !guncelYanit);

  useEffect(() => {
    setYanit(null);
    if (!yol || !sorguAnahtari) return;
    const kontrol = new AbortController();
    api<Sonuc>(yol, { signal: kontrol.signal })
      .then((sonuc) => { if (!kontrol.signal.aborted) setYanit({ anahtar: sorguAnahtari, sonuc, hata: "" }); })
      .catch((e: unknown) => {
        if (!kontrol.signal.aborted) setYanit({ anahtar: sorguAnahtari, sonuc: null, hata: e instanceof Error ? e.message : "Karşılaştırma alınamadı." });
      });
    return () => kontrol.abort();
  }, [yol, sorguAnahtari]);

  const degistir = (liste: string[], deger: string, acik: boolean, sinir: number) => (acik ? (liste.includes(deger) || liste.length >= sinir ? liste : [...liste, deger]) : liste.filter((x) => x !== deger));
  const endeksAdi = (kod: string) => sonuc?.endeksler.find((e) => e.kod === kod)?.ad ?? kod;

  const grafikSerileri: EndeksGrafikSerisi[] = sonuc ? [
    ...sonuc.seriler.map((s, i) => ({ ad: s.ad, renk: ((i % 3) + 1) as 1 | 2 | 3, degerler: s.satirlar.map((r) => (r.endeks100 === null ? null : Number(r.endeks100))) })),
    ...sonuc.endeksler.map((e, i) => ({ ad: e.ad, renk: (((i + 2) % 3) + 1) as 1 | 2 | 3, kesikli: true, degerler: e.degerler.map((d) => (d.normal === null ? null : Number(d.normal))) })),
    ...sonuc.ekCizgiler.map((c, i) => ({ ad: c.ad, renk: (((i + 1) % 3) + 1) as 1 | 2 | 3, noktali: true, degerler: c.degerler.map((d) => (d.normal === null ? null : Number(d.normal))) })),
  ] : [];

  return (
    <div className="stack">
      <Card title="Fiyat ve endeks karşılaştırması">
        <div className="stack">
          <Segmented<Donem> ariaLabel="Dönem" value={donem} onChange={setDonem} items={[{ deger: "12", baslik: "Son 12 ay" }, { deger: "24", baslik: "Son 24 ay" }, { deger: "yil", baslik: "Yıl başından" }, { deger: "ozel", baslik: "Özel" }]} />
          <div className="form-grid">
            {donem === "ozel" && <>
              <Field label="Başlangıç ayı" htmlFor={`${kimlik}-bas`}><Input id={`${kimlik}-bas`} type="month" value={ozelBas} max={buAy} onChange={(e) => setOzelBas(e.target.value)} /></Field>
              <Field label="Bitiş ayı" htmlFor={`${kimlik}-bit`}><Input id={`${kimlik}-bit`} type="month" value={ozelBit} max={buAy} onChange={(e) => setOzelBit(e.target.value)} /></Field>
            </>}
            <Field label="Baz ay (= 100)" htmlFor={`${kimlik}-baz`}><Input id={`${kimlik}-baz`} type="month" value={bazAy} min={baslangic} max={bitis} onChange={(e) => setBaz(e.target.value)} /></Field>
            {varyantlar.length > 0 && <Field label="Varyant" htmlFor={`${kimlik}-var`}><Select id={`${kimlik}-var`} value={varyantId} onChange={(e) => setVaryantId(e.target.value)}><option value="">Tüm varyantlar</option>{varyantlar.map((v) => <option key={v.id} value={v.id}>{v.kod ? `${v.kod} · ` : ""}{v.ad}</option>)}</Select></Field>}
          </div>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="card__title" style={{ fontSize: ".85rem" }}>Karşılaştırılacak endeksler (en çok 4)</legend>
            <div className="endeks-secim">
              {secenekler.endeksler.map((e) => (
                <label key={e.kod}><input type="checkbox" checked={endeksler.includes(e.kod)} onChange={(x) => setEndeksler((l) => degistir(l, e.kod, x.target.checked, 4))} />{e.ad}{e.sonDonem ? <span className="muted">({e.sonDonem} açıklandı)</span> : null}</label>
              ))}
            </div>
          </fieldset>
          {secenekler.erisim.satis && <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="card__title" style={{ fontSize: ".85rem" }}>Satış fiyatı kaynağı</legend>
            <Segmented<"tum" | "liste"> ariaLabel="Satış fiyatı kaynağı" value={kapsam} onChange={setKapsam} items={[{ deger: "tum", baslik: "Tüm satışların ortalaması" }, { deger: "liste", baslik: "Fiyat listesine göre" }]} />
            {kapsam === "liste" && (secenekler.fiyatListeleri.length
              ? <div className="endeks-secim">{secenekler.fiyatListeleri.map((l) => <label key={l.id}><input type="checkbox" checked={listeler.includes(l.id)} onChange={(x) => setListeler((v) => degistir(v, l.id, x.target.checked, 5))} />{l.ad}</label>)}</div>
              : <p className="muted">Aktif fiyat listesi yok.</p>)}
          </fieldset>}
          {secenekler.erisim.alis && secenekler.erisim.satis && <label className="endeks-secim"><span><input type="checkbox" checked={alis} onChange={(e) => setAlis(e.target.checked)} /> Alış fiyatını da göster</span></label>}
          {secilebilirCizgiler.length > 0 && <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="card__title" style={{ fontSize: ".85rem" }}>Diğer fiyat çizgileri</legend>
            <div className="endeks-secim">
              {secilebilirCizgiler.map((c) => <label key={c}><input type="checkbox" checked={cizgiler.includes(c)} onChange={(x) => setCizgiler((l) => (x.target.checked ? [...l, c] : l.filter((y) => y !== c)))} />{EK_CIZGI_ADLARI[c]}{c === "liste" ? <span className="muted">({kapsam === "liste" ? "seçili listeler" : "kart fiyatı"})</span> : null}</label>)}
            </div>
          </fieldset>}
        </div>
      </Card>

      {filtreUyarisi && <Alert tone="warning">{filtreUyarisi}</Alert>}
      {hata && <Alert tone="error">{hata} <Button size="sm" onClick={() => setTekrar((v) => v + 1)}>Tekrar dene</Button></Alert>}
      {yukleniyor && <p className="muted" role="status">Karşılaştırma hesaplanıyor…</p>}

      {sonuc && <>
        {sonuc.uyarilar.length > 0 && <Alert tone="warning"><ul style={{ margin: 0, paddingLeft: "1.1rem" }}>{sonuc.uyarilar.map((u) => <li key={u}>{u}</li>)}</ul></Alert>}
        {sonuc.birimGecmisi?.length > 0 && <Card title="Birim değişikliği tarihçesi">
          <ul>{sonuc.birimGecmisi.map((k, i) => <li key={`${k.degistiAt}-${i}`}>
            {new Date(k.degistiAt + (k.degistiAt.endsWith("Z") ? "" : "Z")).toLocaleDateString("tr-TR")}: {k.eskiBirim ?? "—"} ({k.eskiKatsayi ?? "—"}) → {k.yeniBirim ?? "silindi"} ({k.yeniKatsayi ?? "—"}). {ayAdi(k.ay)} kırılma ayıdır.
          </li>)}</ul>
        </Card>}
        <Card title="Özet">
          <ul className="endeks-ozet">
            {sonuc.seriler.flatMap((s) => s.karsilastirmalar.map((k) => <li key={`${s.anahtar}-${k.endeks}`}>{ozetCumlesi(s.ad, endeksAdi(k.endeks), k, anaBirim)}</li>))}
          </ul>
        </Card>
        <Card title={`Baz ay ${ayAdi(sonuc.baz)} = 100`}>
          <EndeksGrafigi baslik="Fiyat ve endeks, baz ay 100" etiketler={sonuc.aylar.map(ayAdi)} seriler={grafikSerileri} />
          {sonuc.ekCizgiler.length > 0 && <ul className="endeks-grafik__not" style={{ paddingLeft: "1.1rem" }}>
            {sonuc.ekCizgiOlcegi && <li>Noktalı çizgiler {sonuc.ekCizgiOlcegi.seri} serisinin baz ay fiyatına ({tl(sonuc.ekCizgiOlcegi.bazFiyat)}/{anaBirim}) göre ölçeklidir: 100 = baz ayda gerçekleşen fiyat.</li>}
            {sonuc.ekCizgiler.map((c) => <li key={c.anahtar}><strong>{c.ad}:</strong> {c.kaynak}</li>)}
          </ul>}
        </Card>
        <Card title="Aylık veriler" pad={false} actions={<Button size="sm" onClick={() => csvIndir(sonuc)}>Excel (CSV) indir</Button>}>
          <TableWrap className="endeks-tablo">
            <thead>
              <tr><th rowSpan={2}>Ay</th>{sonuc.seriler.map((s) => <th key={s.anahtar} colSpan={3}>{s.ad}</th>)}{sonuc.ekCizgiler.map((c) => <th key={c.anahtar} rowSpan={2}>{c.ad}<br />TL/{anaBirim}</th>)}{sonuc.endeksler.map((e) => <th key={e.kod} colSpan={2}>{e.ad}</th>)}</tr>
              <tr>{sonuc.seriler.map((s) => <Fragment key={s.anahtar}><th>TL/{anaBirim}</th><th>Aylık</th><th>Yıllık</th></Fragment>)}{sonuc.endeksler.map((e) => <Fragment key={e.kod}><th>Değer</th><th>Baz=100</th></Fragment>)}</tr>
            </thead>
            <tbody>
              {sonuc.aylar.map((ay, i) => (
                <tr key={ay}>
                  <td>{ayAdi(ay)}</td>
                  {sonuc.seriler.map((s) => { const r = s.satirlar[i]; return <Fragment key={s.anahtar}>
                    <td className={r.fiyat ? undefined : "is-bos"} title={`${r.satir} fatura satırı`}>{r.fiyat ? tl(r.fiyat) : r.durum === "birim_kirilmasi" ? "Birim kırılması" : r.durum === "yetersiz" ? `Yetersiz veri (${r.satir})` : "—"}</td>
                    <td>{yuzde(r.aylikDegisim)}</td><td>{yuzde(r.yillikDegisim)}</td>
                  </Fragment>; })}
                  {sonuc.ekCizgiler.map((c) => <td key={c.anahtar} className={c.degerler[i].fiyat ? undefined : "is-bos"}>{tl(c.degerler[i].fiyat)}</td>)}
                  {sonuc.endeksler.map((e) => <Fragment key={e.kod}>
                    <td className={e.degerler[i].deger ? undefined : "is-bos"}>{e.degerler[i].deger ? Number(e.degerler[i].deger).toLocaleString("tr-TR", { maximumFractionDigits: 4 }) : "—"}{e.kismiAy === ay ? " *" : ""}</td>
                    <td>{e.degerler[i].normal ? Number(e.degerler[i].normal).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : "—"}</td>
                  </Fragment>)}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
        <details className="card card--pad">
          <summary className="card__title" style={{ cursor: "pointer" }}>Nasıl hesaplandı?</summary>
          <ul className="muted" style={{ paddingLeft: "1.1rem" }}>
            <li>Fiyat, kesinleşmiş faturaların satırlarından aylık miktar ağırlıklı ortalamadır: KDV hariç, satır ve genel iskonto düşülmüş tutar × belge kuru ÷ ana birime ({anaBirim}) çevrilmiş miktar. İade, proforma, taslak, iptal ve bedelsiz satırlar girmez.</li>
            <li>Bir ayda {sonuc.esik.enAzSatir} fatura satırından az varsa o ay “yetersiz veri”dir; önceki ayın fiyatı taşınmaz.</li>
            <li>Reel değişim = (1 + fiyat değişimi) ÷ (1 + endeks değişimi) − 1. Endekse göre fiyat = baz fiyat × son endeks ÷ baz endeks.</li>
            <li>Karşılaştırma, hem fiyatı hem endeksi olan son aya kadar yapılır. Endeksler ve kurlar TCMB EVDS'den gelir: endeksler TÜİK'in aylık değerleri, kurlar seçilen seriye göre TCMB döviz alış veya satış kurunun aylık ortalamasıdır; * işaretli ay ay başından bugüne ortalamadır.</li>
            {sonuc.endeksler.filter((e) => e.bazYili).map((e) => <li key={e.kod}>{e.ad}: baz {e.bazYili}, son açıklanan dönem {e.sonDonem?.slice(0, 7) ?? "—"}.</li>)}
          </ul>
        </details>
      </>}
    </div>
  );
}
