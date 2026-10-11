"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Alert, Button, Card, Field, Input, Miktar, PageHeader, Para, SearchInput, Segmented, Select, Tarih } from "@/components/ui";
import { bugunTR, yilBasiTR } from "@tekirextra/shared";

/*
 * RPR-14 (inceleme P1-4): toplamlar sunucuda kayıtlı TL tutarlardan gelir
 * (/rapor/fatura-pivot). Varsayılan yalnız kesin faturalar; iptal hiç girmez,
 * iadeler eksi sayılır, dövizli fatura kendi kuruyla TL'ye çevrilir.
 */

type Boyut = "cari" | "urun" | "kategori" | "tip" | "durum" | "yil" | "ay" | "depo" | "doviz";
type Metrik = "matrah" | "toplam" | "kdv" | "iskonto" | "miktar" | "ortalamaFiyat" | "kalem";
type Yon = "satis" | "alis" | "tum";
type Durum = "kesin" | "taslak" | "kesin_taslak";

interface Degerler { kalem: number; miktar: number; matrah: number; iskonto: number; kdv: number; toplam: number }
interface Hucre extends Degerler { satir: string; sutun: string }
interface PivotYaniti {
  satirlar: { anahtar: string; etiket: string }[];
  sutunlar: { anahtar: string; etiket: string }[];
  hucreler: Hucre[];
  kursuzDovizli: number;
}
interface DetaySatiri {
  faturaId: string; faturaNo: string | null; tarih: string; tip: string; durum: string; dovizCinsi: string;
  cariUnvan: string; stokKod: string; stokAd: string; miktar: number; birim: string; matrah: number; kdv: number; toplam: number;
}

const BOYUTLAR: Record<Boyut, string> = {
  cari: "Cari", urun: "Ürün / hizmet", kategori: "Kategori", tip: "Fatura tipi", durum: "Durum",
  yil: "Yıl", ay: "Ay", depo: "Depo", doviz: "Belge dövizi",
};
const METRIKLER: Record<Metrik, string> = {
  matrah: "Matrah (KDV hariç)", toplam: "Ödenecek tutar (KDV dahil)", kdv: "KDV", iskonto: "İskonto",
  miktar: "Miktar", ortalamaFiyat: "Ortalama birim fiyat", kalem: "Kalem sayısı",
};
const DURUMLAR: Record<Durum, string> = { kesin: "Kesin", taslak: "Taslak", kesin_taslak: "Kesin + taslak" };
const TIPLER: Record<string, string> = { satis: "Satış", satis_iade: "Satış iadesi", alis: "Alış", alis_iade: "Alış iadesi" };
const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const bos = (): Degerler => ({ kalem: 0, miktar: 0, matrah: 0, iskonto: 0, kdv: 0, toplam: 0 });
const ekle = (a: Degerler, b: Degerler) => {
  a.kalem += b.kalem; a.miktar += b.miktar; a.matrah += b.matrah; a.iskonto += b.iskonto; a.kdv += b.kdv; a.toplam += b.toplam;
};
const deger = (d: Degerler | undefined, m: Metrik): number | null => {
  if (!d || !d.kalem) return null;
  if (m === "ortalamaFiyat") return d.miktar ? d.matrah / d.miktar : null;
  return d[m];
};
const etiketGoster = (boyut: Boyut, etiket: string) =>
  boyut === "ay" && /^\d{4}-\d{2}$/.test(etiket) ? `${AYLAR[Number(etiket.slice(5)) - 1]} ${etiket.slice(0, 4)}` : etiket || "—";

export default function FaturaPivotSayfasi() {
  const [baslangic, setBaslangic] = useState(yilBasiTR());
  const [bitis, setBitis] = useState(bugunTR());
  const [yon, setYon] = useState<Yon>("satis");
  const [durum, setDurum] = useState<Durum>("kesin");
  const [satir, setSatir] = useState<Boyut>("cari");
  const [sutun, setSutun] = useState<Boyut>("ay");
  const [metrik, setMetrik] = useState<Metrik>("matrah");
  const [aramaGirdisi, setAramaGirdisi] = useState("");
  const [arama, setArama] = useState("");

  const [veri, setVeri] = useState<PivotYaniti | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");
  const [acik, setAcik] = useState<string | null>(null);
  const [detay, setDetay] = useState<{ satirlar: DetaySatiri[]; kesildi: boolean } | null>(null);

  const parametreler = useMemo(() => {
    const p = new URLSearchParams({ baslangic, bitis, yon, durum, satir, sutun });
    if (arama) p.set("arama", arama);
    return p;
  }, [baslangic, bitis, yon, durum, satir, sutun, arama]);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    setAcik(null);
    try {
      setVeri(await api<PivotYaniti>(`/rapor/fatura-pivot?${parametreler}`));
    } catch (e) {
      setVeri(null);
      setHata(e instanceof Error ? e.message : "Pivot yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [parametreler]);

  useEffect(() => { void yukle(); }, [yukle]);

  useEffect(() => {
    const t = setTimeout(() => setArama(aramaGirdisi.trim()), 400);
    return () => clearTimeout(t);
  }, [aramaGirdisi]);

  const satirAc = async (anahtar: string) => {
    if (acik === anahtar) { setAcik(null); return; }
    setAcik(anahtar);
    setDetay(null);
    try {
      const p = new URLSearchParams(parametreler);
      p.set("satirAnahtari", anahtar);
      setDetay(await api(`/rapor/fatura-pivot/detay?${p}`));
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Kalemler yüklenemedi");
    }
  };

  const { matris, satirToplam, sutunToplam, genel } = useMemo(() => {
    const matris = new Map<string, Degerler>();
    const satirToplam = new Map<string, Degerler>(), sutunToplam = new Map<string, Degerler>();
    const genel = bos();
    for (const h of veri?.hucreler ?? []) {
      matris.set(`${h.satir}\u0000${h.sutun}`, h);
      if (!satirToplam.has(h.satir)) satirToplam.set(h.satir, bos());
      if (!sutunToplam.has(h.sutun)) sutunToplam.set(h.sutun, bos());
      ekle(satirToplam.get(h.satir)!, h); ekle(sutunToplam.get(h.sutun)!, h); ekle(genel, h);
    }
    return { matris, satirToplam, sutunToplam, genel };
  }, [veri]);

  const goster = (d: Degerler | undefined) => {
    const v = deger(d, metrik);
    if (v === null) return <span className="muted">—</span>;
    if (metrik === "miktar" || metrik === "kalem") return <Miktar deger={v} />;
    return <Para deger={v} />;
  };

  const csvIndir = () => {
    if (!veri) return;
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const sayi = (d: Degerler | undefined) => { const v = deger(d, metrik); return v === null ? "" : v.toFixed(metrik === "miktar" ? 3 : 2).replace(".", ","); };
    const satirlar = [
      [q("Fatura pivotu"), q(`${baslangic} – ${bitis}`), q(yon === "tum" ? "Satış + alış" : TIPLER[yon]), q(DURUMLAR[durum]), q(METRIKLER[metrik] + " · TL"), arama ? q(`Arama: ${arama}`) : ""].join(";"),
      [q(`${BOYUTLAR[satir]} \\ ${BOYUTLAR[sutun]}`), ...veri.sutunlar.map((c) => q(etiketGoster(sutun, c.etiket))), q("Toplam")].join(";"),
      ...veri.satirlar.map((r) => [q(etiketGoster(satir, r.etiket)), ...veri.sutunlar.map((c) => sayi(matris.get(`${r.anahtar}\u0000${c.anahtar}`))), sayi(satirToplam.get(r.anahtar))].join(";")),
      [q("Toplam"), ...veri.sutunlar.map((c) => sayi(sutunToplam.get(c.anahtar))), sayi(genel)].join(";"),
    ];
    const url = URL.createObjectURL(new Blob(["﻿" + satirlar.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `fatura-pivot_${baslangic}_${bitis}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sutunSayisi = (veri?.sutunlar.length ?? 0) + 2;

  return (
    <div>
      <PageHeader
        title="Fatura pivotu"
        subtitle="Fatura kalemleri seçtiğiniz iki boyutta toplanır. Tutarlar TL'dir (dövizli fatura kendi kuruyla); iadeler eksi, iptal edilmiş faturalar hariçtir."
        actions={
          <div className="row-tight">
            <Link className="btn btn--ghost" href="/panel/fatura/raporlar">← Raporlar</Link>
            <Button variant="primary" onClick={csvIndir} disabled={!veri?.hucreler.length}>CSV indir</Button>
          </div>
        }
      />

      <Card style={{ marginBottom: "1rem" }}>
        <div className="row-tight" style={{ alignItems: "flex-end", gap: "0.75rem" }}>
          <Field label="Başlangıç"><Input type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} /></Field>
          <Field label="Bitiş"><Input type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} /></Field>
          <Field label="Yön">
            <Segmented<Yon> items={[{ deger: "satis", baslik: "Satış" }, { deger: "alis", baslik: "Alış" }, { deger: "tum", baslik: "Tümü" }]} value={yon} onChange={setYon} />
          </Field>
          <Field label="Durum">
            <Select value={durum} onChange={(e) => setDurum(e.target.value as Durum)}>
              {(Object.keys(DURUMLAR) as Durum[]).map((d) => <option key={d} value={d}>{DURUMLAR[d]}</option>)}
            </Select>
          </Field>
          <Field label="Satır">
            <Select value={satir} onChange={(e) => setSatir(e.target.value as Boyut)}>
              {(Object.keys(BOYUTLAR) as Boyut[]).map((b) => <option key={b} value={b} disabled={b === sutun}>{BOYUTLAR[b]}</option>)}
            </Select>
          </Field>
          <Field label="Sütun">
            <Select value={sutun} onChange={(e) => setSutun(e.target.value as Boyut)}>
              {(Object.keys(BOYUTLAR) as Boyut[]).map((b) => <option key={b} value={b} disabled={b === satir}>{BOYUTLAR[b]}</option>)}
            </Select>
          </Field>
          <Field label="Değer">
            <Select value={metrik} onChange={(e) => setMetrik(e.target.value as Metrik)}>
              {(Object.keys(METRIKLER) as Metrik[]).map((m) => <option key={m} value={m}>{METRIKLER[m]}</option>)}
            </Select>
          </Field>
          <Field label="Ara">
            <SearchInput placeholder="Fatura no, cari, ürün" value={aramaGirdisi} onChange={(e) => setAramaGirdisi(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Alert tone="error">{hata}</Alert>
      {!!veri?.kursuzDovizli && (
        <Alert tone="warning">{veri.kursuzDovizli} dövizli faturanın kuru 1 kayıtlı; bu faturaların tutarı TL'ye çevrilmemiş olabilir.</Alert>
      )}
      {(metrik === "miktar" || metrik === "ortalamaFiyat") && satir !== "urun" && sutun !== "urun" && (
        <Alert tone="warning">Miktar farklı ürünlerin farklı birimlerini topluyor; anlamlı karşılaştırma için satır ya da sütunda ürün seçin.</Alert>
      )}

      <Card pad={false}>
        <div className="table-wrap table-wrap--sticky">
          <table className="table table--compact">
            <thead>
              <tr>
                <th>{BOYUTLAR[satir]} \ {BOYUTLAR[sutun]}</th>
                {veri?.sutunlar.map((c) => <th className="num" key={c.anahtar}>{etiketGoster(sutun, c.etiket)}</th>)}
                <th className="num">Toplam</th>
              </tr>
            </thead>
            <tbody>
              {yukleniyor && <tr><td colSpan={sutunSayisi} className="muted">Hesaplanıyor…</td></tr>}
              {!yukleniyor && veri && !veri.satirlar.length && (
                <tr><td colSpan={sutunSayisi} className="muted">Seçilen dönemde ve süzgeçlerde fatura kalemi yok.</td></tr>
              )}
              {!yukleniyor && veri?.satirlar.map((r) => (
                <Fragment key={r.anahtar}>
                  <tr>
                    <td>
                      <button type="button" className="btn btn--ghost btn--sm" aria-expanded={acik === r.anahtar} onClick={() => void satirAc(r.anahtar)}>
                        {acik === r.anahtar ? "▾" : "▸"}
                      </button>{" "}
                      {etiketGoster(satir, r.etiket)}
                      <small className="muted"> · {satirToplam.get(r.anahtar)?.kalem ?? 0} kalem</small>
                    </td>
                    {veri.sutunlar.map((c) => <td className="num" key={c.anahtar}>{goster(matris.get(`${r.anahtar}\u0000${c.anahtar}`))}</td>)}
                    <td className="num"><strong>{goster(satirToplam.get(r.anahtar))}</strong></td>
                  </tr>
                  {acik === r.anahtar && (
                    <tr>
                      <td colSpan={sutunSayisi} style={{ background: "var(--surface-2)" }}>
                        {!detay ? <span className="muted">Kalemler yükleniyor…</span> : (
                          <div style={{ overflowX: "auto" }}>
                            <table className="table table--compact">
                              <thead>
                                <tr><th>Fatura</th><th>Tarih</th><th>Tip</th><th>Cari</th><th>Ürün</th><th className="num">Miktar</th><th className="num">Matrah</th><th className="num">KDV</th><th className="num">Toplam</th></tr>
                              </thead>
                              <tbody>
                                {detay.satirlar.map((d, i) => (
                                  <tr key={`${d.faturaId}-${i}`}>
                                    <td><Link href={`/panel/fatura/yeni?ac=${d.faturaId}`}>{d.faturaNo ?? "Numarasız"}</Link>{d.durum === "taslak" && <small className="muted"> · taslak</small>}</td>
                                    <td><Tarih deger={d.tarih} /></td>
                                    <td>{TIPLER[d.tip] ?? d.tip}{d.dovizCinsi !== "TRY" && <small className="muted"> · {d.dovizCinsi}</small>}</td>
                                    <td>{d.cariUnvan}</td>
                                    <td>{d.stokKod} · {d.stokAd}</td>
                                    <td className="num"><Miktar deger={d.miktar} birim={d.birim} /></td>
                                    <td className="num"><Para deger={d.matrah} /></td>
                                    <td className="num"><Para deger={d.kdv} /></td>
                                    <td className="num"><Para deger={d.toplam} /></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {detay.kesildi && <p className="muted">İlk {detay.satirlar.length} kalem gösteriliyor; tamamı için dönemi daraltın.</p>}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            {!yukleniyor && !!veri?.satirlar.length && (
              <tfoot>
                <tr>
                  <td><strong>Toplam</strong></td>
                  {veri.sutunlar.map((c) => <td className="num" key={c.anahtar}><strong>{goster(sutunToplam.get(c.anahtar))}</strong></td>)}
                  <td className="num"><strong>{goster(genel)}</strong></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
