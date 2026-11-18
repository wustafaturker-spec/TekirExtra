"use client";

import { useId, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { Alert, Badge, Button, Field, Input, Select, TableWrap } from "@/components/ui";

/* ─── API sözleşmesi (apps/api/src/fiyat-endeks: GET /fiyat-endeks/fiyat-onerisi) ─── */
type Yuvarlama = "yok" | "kurus" | "tam" | "bes" | "on";
interface OneriSatiri {
  stokId: string; kod: string; ad: string; birim: string; eskiFiyat: string; sonDegisim: string | null;
  durum: "oneri" | "degisim_yok" | "baz_yok" | "endeks_yok"; bazAy: string | null; sonAy: string | null;
  endeksDegisim: string | null; yeniFiyat: string | null; fark: string | null; neden: string | null;
}
interface Oneri {
  surum: string;
  liste: { id: string; ad: string };
  endeks: { kod: string; ad: string; tur: string; bazYili: string | null; sonAy: string | null };
  satirlar: OneriSatiri[];
  ozet: { oneri: number; toplam: number };
}
export interface EndeksSecenegi { kod: string; ad: string; tur: "endeks" | "kur" }

const YUVARLAMA_ADLARI: Record<Yuvarlama, string> = { yok: "Yuvarlama yok (4 ondalık)", kurus: "Kuruşa", tam: "Tam liraya", bes: "5 TL'ye", on: "10 TL'ye" };
const ay = (d: string | null) => (d ? d.slice(0, 7) : "—");
const tl = (s: string | null) => (s === null ? "—" : `${Number(s).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} TL`);
const yuzde = (s: string | null) => (s === null ? "—" : `%${Number(s).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * END-16: fiyat listesinde "son fiyat değişikliğinden bu yana endeks kadar"
 * yeni fiyat önizlemesi. Kendiliğinden fiyat değişmez: kullanıcı satırları
 * seçip onaylayınca toplu fiyat ucuyla atomik uygulanır. Genel onay kuralı
 * varsa tek talep açılır; liste sürümü son onayda yeniden doğrulanır.
 */
export function EndeksFiyatOnerisi({ listeId, listeAdi, endeksler, onUygulandi }: { listeId: string; listeAdi: string; endeksler: EndeksSecenegi[]; onUygulandi: () => Promise<void> | void }) {
  const kimlik = useId();
  const [endeks, setEndeks] = useState(endeksler.find((e) => e.kod === "TUFE")?.kod ?? endeksler[0]?.kod ?? "");
  const [yuvarlama, setYuvarlama] = useState<Yuvarlama>("kurus");
  const [varsayilanBaz, setVarsayilanBaz] = useState("");
  const [oneri, setOneri] = useState<Oneri | null>(null);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [onay, setOnay] = useState<"liste" | "yeni" | null>(null);
  const [yeniAd, setYeniAd] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islem, setIslem] = useState(false);
  const [onizlemeGerekli, setOnizlemeGerekli] = useState(false);

  function onizlemeyiTemizle() {
    if (oneri) setOnizlemeGerekli(true);
    setOneri(null);
    setSecili(new Set());
    setOnay(null);
    setHata("");
  }

  async function onizle() {
    setIslem(true); setHata(""); setBasari(""); setOnay(null); setOneri(null); setOnizlemeGerekli(false);
    try {
      const q = new URLSearchParams({ listeId, endeks, yuvarlama });
      if (varsayilanBaz) q.set("varsayilanBazAy", varsayilanBaz);
      const r = await api<Oneri>(`/fiyat-endeks/fiyat-onerisi?${q}`);
      setOneri(r);
      setSecili(new Set(r.satirlar.filter((s) => s.durum === "oneri").map((s) => s.stokId)));
      setYeniAd(`${listeAdi} — ${r.endeks.ad} ${ay(r.endeks.sonAy)}`.slice(0, 100));
    } catch (e) {
      setOneri(null); setHata(e instanceof Error ? e.message : "Öneri hesaplanamadı.");
    } finally { setIslem(false); }
  }

  const uygulanacak = (oneri?.satirlar ?? []).filter((s) => secili.has(s.stokId) && s.yeniFiyat);

  async function uygula(hedef: "liste" | "yeni") {
    if (!oneri) return;
    setIslem(true); setHata(""); setBasari("");
    let yapilan = 0;
    try {
      const kalemler = hedef === "liste"
        ? uygulanacak.map((s) => ({ stokId: s.stokId, fiyat: s.yeniFiyat! }))
        : oneri.satirlar.map((s) => ({ stokId: s.stokId, fiyat: secili.has(s.stokId) && s.yeniFiyat ? s.yeniFiyat : s.eskiFiyat }));
      await api(`/fiyat-listeleri/${listeId}/toplu-fiyat`, { method: "POST", body: JSON.stringify({
        surum: oneri.surum, kaynak: "endeks", kalemler, ...(hedef === "yeni" ? { yeniAd: yeniAd.trim() } : {}),
      }) });
      yapilan = kalemler.length;
      setBasari(hedef === "liste" ? `${yapilan} kalemin fiyatı güncellendi.` : `'${yeniAd.trim()}' pasif liste olarak oluşturuldu (${yapilan} kalem).`);
      setOnay(null); setOneri(null);
      await onUygulandi();
    } catch (e) {
      if (e instanceof ApiHata && e.kod === "ONAY_GEREKLI") {
        setBasari(e.message); setOnay(null); setOneri(null);
      } else setHata(e instanceof Error ? e.message : "İşlem yapılamadı.");
    } finally { setIslem(false); }
  }

  const degistir = (id: string, acik: boolean) => setSecili((s) => { const y = new Set(s); if (acik) y.add(id); else y.delete(id); return y; });

  return (
    <details className="stack endeks-fiyat-onerisi">
      <summary className="card__title" style={{ cursor: "pointer" }}>Endekse göre fiyat güncelleme önerisi</summary>
      <p className="muted">Her kalem için son fiyat değişikliğinin bir önceki ayı baz alınır ve seçilen endeksin en son açıklanan aya kadarki değişimi kadar yeni fiyat önerilir. Fiyatlar siz onaylamadan değişmez. Tanımlı onay kuralı varsa talep Onaylar ekranına gider ve son onaydan sonra uygulanır.</p>
      <div className="form-grid">
        <Field label="Endeks" htmlFor={`${kimlik}-endeks`}><Select id={`${kimlik}-endeks`} value={endeks} disabled={islem} onChange={(e) => { setEndeks(e.target.value); onizlemeyiTemizle(); }}>{endeksler.map((e) => <option key={e.kod} value={e.kod}>{e.ad}</option>)}</Select></Field>
        <Field label="Yuvarlama" htmlFor={`${kimlik}-yuv`}><Select id={`${kimlik}-yuv`} value={yuvarlama} disabled={islem} onChange={(e) => { setYuvarlama(e.target.value as Yuvarlama); onizlemeyiTemizle(); }}>{(Object.keys(YUVARLAMA_ADLARI) as Yuvarlama[]).map((y) => <option key={y} value={y}>{YUVARLAMA_ADLARI[y]}</option>)}</Select></Field>
        <Field label="Fiyat geçmişi olmayan kalemlerde baz ay" htmlFor={`${kimlik}-baz`}><Input id={`${kimlik}-baz`} type="month" value={varsayilanBaz} disabled={islem} onChange={(e) => { setVarsayilanBaz(e.target.value); onizlemeyiTemizle(); }} /></Field>
      </div>
      <div><Button disabled={islem || !endeks} onClick={() => void onizle()}>Önizle</Button></div>
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>
      {onizlemeGerekli && <p className="muted" role="status">Ayarlar değişti. Uygulamadan önce yeniden önizleyin.</p>}
      {oneri && <>
        <p className="muted" role="status">{oneri.endeks.ad}{oneri.endeks.bazYili ? ` (baz ${oneri.endeks.bazYili})` : ""}, son açıklanan ay {ay(oneri.endeks.sonAy)} · {oneri.ozet.oneri} / {oneri.ozet.toplam} kalem için öneri var.</p>
        <TableWrap className="endeks-tablo">
          <thead><tr><th><span className="sr-only">Seç</span></th><th>Kod</th><th>Ürün</th><th className="num">Bugünkü fiyat</th><th>Baz → son ay</th><th className="num">Endeks</th><th className="num">Önerilen</th><th className="num">Fark</th></tr></thead>
          <tbody>{oneri.satirlar.map((s) => (
            <tr key={s.stokId}>
              <td><input type="checkbox" aria-label={`${s.ad} uygulansın`} disabled={!s.yeniFiyat} checked={secili.has(s.stokId)} onChange={(e) => degistir(s.stokId, e.target.checked)} /></td>
              <td className="mono">{s.kod}</td>
              <td>{s.ad}{s.neden && <div className="muted">{s.neden}</div>}</td>
              <td className="num money">{tl(s.eskiFiyat)}</td>
              <td>{ay(s.bazAy)} → {ay(s.sonAy)}{!s.sonDegisim && s.bazAy && <> <Badge variant="neutral">varsayılan baz</Badge></>}</td>
              <td className="num">{yuzde(s.endeksDegisim)}</td>
              <td className="num money">{tl(s.yeniFiyat)}</td>
              <td className="num money">{tl(s.fark)}</td>
            </tr>
          ))}</tbody>
        </TableWrap>
        {onay === null ? (
          <div className="row endeks-oneri-eylemleri">
            <Button variant="primary" disabled={islem || !uygulanacak.length} onClick={() => setOnay("liste")}>Seçilen {uygulanacak.length} kalemi bu listeye uygula</Button>
            <Button disabled={islem || !oneri.satirlar.length} onClick={() => setOnay("yeni")}>Yeni pasif liste olarak kaydet</Button>
          </div>
        ) : (
          <Alert tone="warning">
            <div className="stack">
              {onay === "liste"
                ? <span>{listeAdi} listesindeki {uygulanacak.length} kalemin fiyatı önerilen fiyatla değişecek; bu listeye bağlı carilerin yeni belgelerinde yeni fiyat kullanılır. Onaylıyor musunuz?</span>
                : <><span>Pasif yeni bir liste açılacak; mevcut liste ve cariler değişmez.</span>
                  <Field label="Yeni liste adı" htmlFor={`${kimlik}-ad`}><Input id={`${kimlik}-ad`} value={yeniAd} onChange={(e) => setYeniAd(e.target.value)} maxLength={100} required /></Field></>}
              <div className="row endeks-oneri-eylemleri">
                <Button variant="primary" disabled={islem || (onay === "yeni" && !yeniAd.trim())} onClick={() => void uygula(onay)}>{islem ? "Uygulanıyor…" : "Evet, uygula"}</Button>
                <Button disabled={islem} onClick={() => setOnay(null)}>Vazgeç</Button>
              </div>
            </div>
          </Alert>
        )}
      </>}
    </details>
  );
}
