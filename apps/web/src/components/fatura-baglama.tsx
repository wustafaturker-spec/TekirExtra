"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Input, Modal, Para, TableWrap } from "@/components/ui";

interface AcikFatura {
  id: string; no: string | null; tip: string; tarih: string; vadeTarihi: string | null; dovizCinsi: string;
  genelToplam: string; kalan: string;
  /** 1 fatura dövizi kaç fiş dövizi (fiş tarihinin kuru); aynı dövizde 1. */
  kur: string | null;
}
interface Bag { id: string; fatura: { id: string; no: string | null; dovizCinsi: string }; karsilik: string; tutar: string; kurFarkiFaturali: boolean }
interface Onizleme {
  fis: { id: string; tip: string; tarih: string; tutar: string; dovizCinsi: string; makbuzNo: string | null; aciklama: string | null; cari: { id: string; kod: string; unvan: string } | null; bosta: string };
  kapaliDonem: boolean;
  faturalar: AcikFatura[];
  baglar: Bag[];
}
interface Satir { tutar: string; karsilik: string; karsilikElle: boolean }

/** "1.234,56" (Türkçe) ya da "1234.56" kabul edilir. */
const sayi = (v: string) => Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v) || 0;
const iki = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const yaz = (n: number | string) => Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Kullanıcı "1.234,56" de yazsa API'ye "1234.56" gider. */
const apiSayi = (v: string) => iki(sayi(v));

/**
 * KSB-19…24: faturasız girilmiş tahsilat/ödeme fişini açık faturalara bağlar.
 * Fatura başka dövizdeyse karşılık fiş tarihinin kuruyla hesaplanır; bankanın
 * uyguladığı karşılık elle yazılabilir. Mevcut elle bağlar buradan çözülür.
 */
export function FaturaBaglamaPenceresi({ hareketId, onKapat, onBitti }: { hareketId: string; onKapat: () => void; onBitti: (mesaj: string) => void }) {
  const [veri, setVeri] = useState<Onizleme | null>(null);
  const [satirlar, setSatirlar] = useState<Record<string, Satir>>({});
  const [hata, setHata] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);

  const yukle = useCallback(async () => {
    try { setVeri(await api<Onizleme>(`/kasa-banka/hareketler/${hareketId}/fatura-baglama`)); setSatirlar({}); }
    catch (h) { setHata(h instanceof Error ? h.message : "Fiş okunamadı"); }
  }, [hareketId]);
  useEffect(() => { void yukle(); }, [yukle]);

  const toplam = useMemo(() => Object.values(satirlar).reduce((t, s) => t + sayi(s.tutar), 0), [satirlar]);
  const bosta = veri ? Number(veri.fis.bosta) : 0;

  function tutarYaz(f: AcikFatura, tutar: string) {
    setSatirlar((o) => {
      const eski = o[f.id];
      const kur = Number(f.kur ?? 0);
      const karsilik = eski?.karsilikElle ? eski.karsilik : f.dovizCinsi === veri!.fis.dovizCinsi || !kur ? tutar : iki(sayi(tutar) / kur);
      return { ...o, [f.id]: { tutar, karsilik, karsilikElle: eski?.karsilikElle ?? false } };
    });
  }
  function karsilikYaz(f: AcikFatura, karsilik: string) {
    setSatirlar((o) => ({ ...o, [f.id]: { tutar: o[f.id]?.tutar ?? "", karsilik, karsilikElle: true } }));
  }
  /** Faturanın kalanını ya da fişte kalanı (hangisi küçükse) doldurur. */
  function doldur(f: AcikFatura) {
    const kur = f.dovizCinsi === veri!.fis.dovizCinsi ? 1 : Number(f.kur ?? 0);
    if (!kur) return;
    const digerleri = toplam - sayi(satirlar[f.id]?.tutar ?? "0");
    const tutar = Math.max(0, Math.min(Number(f.kalan) * kur, bosta - digerleri));
    setSatirlar((o) => ({ ...o, [f.id]: { tutar: iki(tutar), karsilik: iki(Math.min(Number(f.kalan), tutar / kur)), karsilikElle: false } }));
  }

  async function bagla(e: React.FormEvent) {
    e.preventDefault();
    const secilen = Object.entries(satirlar).filter(([, s]) => sayi(s.tutar) > 0);
    if (!secilen.length) { setHata("En az bir faturaya tutar yazın"); return; }
    setIsleniyor(true); setHata("");
    try {
      const fis = veri!.fis;
      const sonuc = await api<{ baglar: { no: string | null; tutar: string; karsilik: string; dovizCinsi: string }[] }>(`/kasa-banka/hareketler/${hareketId}/fatura-baglama`, {
        method: "POST",
        body: JSON.stringify({
          faturalar: secilen.map(([faturaId, s]) => {
            const f = veri!.faturalar.find((x) => x.id === faturaId)!;
            return { faturaId, tutar: apiSayi(s.tutar), karsilik: f.dovizCinsi !== fis.dovizCinsi && s.karsilikElle ? apiSayi(s.karsilik) : null };
          }),
        }),
      });
      onBitti(`${sonuc.baglar.length} faturaya bağlandı: ${sonuc.baglar.map((b) => `${b.no ?? "numarasız"} ${yaz(b.karsilik)} ${b.dovizCinsi}`).join(", ")}.`);
    } catch (h) { setHata(h instanceof Error ? h.message : "Bağlanamadı"); }
    finally { setIsleniyor(false); }
  }

  async function coz(b: Bag) {
    if (!window.confirm(`${b.fatura.no ?? "Numarasız fatura"} ile bağ çözülsün mü? Fişin bu kısmı yeniden bağlanmamış olur.`)) return;
    setHata("");
    try { await api(`/kasa-banka/fatura-kapamalari/${b.id}/coz`, { method: "POST" }); await yukle(); }
    catch (h) { setHata(h instanceof Error ? h.message : "Bağ çözülemedi"); }
  }

  const fis = veri?.fis;
  return (
    <Modal genis baslik="Faturalara bağla" onKapat={onKapat}
      aciklama="Fişin faturaya bağlanmamış kısmı seçilen faturalara dağıtılır. Başka dövizli faturada karşılık fiş tarihinin kuruyla hesaplanır; bankanın uyguladığı karşılığı yazabilirsiniz.">
      <Alert tone="error">{hata}</Alert>
      {!veri || !fis ? <p className="subtle">{hata ? "" : "Yükleniyor…"}</p> : (
        <form onSubmit={bagla}>
          <div className="fatura-baglama__ozet">
            <div><span className="subtle">Fiş</span> <strong>{fis.makbuzNo ?? fis.aciklama ?? "—"}</strong> · {new Date(fis.tarih).toLocaleDateString("tr-TR")} · {fis.cari?.unvan}</div>
            <div><span className="subtle">Tutar</span> <Para deger={fis.tutar} dovizCinsi={fis.dovizCinsi} /></div>
            <div><span className="subtle">Bağlanmamış</span> <strong><Para deger={fis.bosta} dovizCinsi={fis.dovizCinsi} /></strong></div>
          </div>
          {veri.kapaliDonem && <Alert tone="warning">Fişin tarihi kapalı bir mali dönemde; bağlama ve bağ çözme yapılamaz.</Alert>}

          {veri.baglar.length > 0 && (
            <>
              <h4 className="fatura-baglama__baslik">Elle yapılmış bağlar</h4>
              <TableWrap>
                <thead><tr><th>Fatura</th><th className="num">Fişten</th><th className="num">Karşılık</th><th /></tr></thead>
                <tbody>
                  {veri.baglar.map((b) => (
                    <tr key={b.id}>
                      <td><a href={`/panel/fatura/yeni?ac=${b.fatura.id}`}>{b.fatura.no ?? "Numarasız"}</a></td>
                      <td className="num"><Para deger={b.tutar} dovizCinsi={fis.dovizCinsi} /></td>
                      <td className="num"><Para deger={b.karsilik} dovizCinsi={b.fatura.dovizCinsi} /></td>
                      <td>{b.kurFarkiFaturali ? <Badge variant="neutral">Kur farkı faturalı</Badge> : <Button type="button" size="sm" disabled={veri.kapaliDonem} onClick={() => void coz(b)}>Bağı çöz</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </>
          )}

          <h4 className="fatura-baglama__baslik">Açık faturalar</h4>
          {veri.faturalar.length === 0 ? <p className="subtle">Bu carinin bu yönde kalanı olan kesin faturası yok.</p> : (
            <TableWrap>
              <thead>
                <tr><th>Fatura</th><th>Vade</th><th className="num">Kalan</th><th className="num">Kur</th><th className="num">Fişten ({fis.dovizCinsi})</th><th className="num">Karşılık</th><th /></tr>
              </thead>
              <tbody>
                {veri.faturalar.map((f) => {
                  const s = satirlar[f.id];
                  const capraz = f.dovizCinsi !== fis.dovizCinsi;
                  return (
                    <tr key={f.id}>
                      <td><strong>{f.no ?? "Numarasız"}</strong>{capraz && <> <Badge variant="info">{f.dovizCinsi}</Badge></>}</td>
                      <td>{new Date(f.vadeTarihi ?? f.tarih).toLocaleDateString("tr-TR")}</td>
                      <td className="num"><Para deger={f.kalan} dovizCinsi={f.dovizCinsi} /></td>
                      <td className="num">{capraz ? (f.kur ? Number(f.kur).toLocaleString("tr-TR", { maximumFractionDigits: 4 }) : <span className="subtle">kur yok</span>) : "—"}</td>
                      <td className="num"><Input aria-label={`${f.no ?? "Fatura"} fişten bağlanan`} inputMode="decimal" className="fatura-baglama__tutar" value={s?.tutar ?? ""} onChange={(e) => tutarYaz(f, e.target.value)} /></td>
                      <td className="num">{capraz
                        ? <Input aria-label={`${f.no ?? "Fatura"} karşılık (${f.dovizCinsi})`} inputMode="decimal" className="fatura-baglama__tutar" value={s?.karsilik ?? ""} onChange={(e) => karsilikYaz(f, e.target.value)} placeholder={f.dovizCinsi} />
                        : <span className="subtle">aynı döviz</span>}</td>
                      <td><Button type="button" size="sm" disabled={capraz && !f.kur} onClick={() => doldur(f)}>Doldur</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
          <div className="fatura-baglama__alt">
            <span className={toplam > bosta + 0.004 ? "neg" : "subtle"}>Dağıtılan {yaz(toplam)} / {yaz(bosta)} {fis.dovizCinsi}</span>
            <div className="row-tight">
              <Button type="button" onClick={onKapat}>Vazgeç</Button>
              <Button type="submit" variant="primary" disabled={isleniyor || veri.kapaliDonem || toplam <= 0 || toplam > bosta + 0.004}>{isleniyor ? "Bağlanıyor…" : "Bağla"}</Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

interface BaglanmamisFis { id: string; tarih: string; tip: string; dovizCinsi: string; tutar: string; kalan: string; kalanTry: string; makbuzNo: string | null; aciklama: string | null }

/**
 * KSB-23: cari kartında faturaya bağlanmamış tahsilat/ödemeler. Yoksa hiçbir şey
 * göstermez; varsa vadesi geçmiş görünen faturanın bununla ödenmiş olabileceğini söyler.
 */
export function BaglanmamisOdemeler({ cariId, yazabilir, onDegisti }: { cariId: string; yazabilir: boolean; onDegisti?: (mesaj: string) => void }) {
  const [fisler, setFisler] = useState<BaglanmamisFis[]>([]);
  const [acik, setAcik] = useState<string | null>(null);
  const yukle = useCallback(() => {
    api<BaglanmamisFis[]>(`/kasa-banka/baglanmamis-fisler?cariId=${cariId}`).then(setFisler).catch(() => setFisler([]));
  }, [cariId]);
  useEffect(() => { yukle(); }, [yukle]);
  if (!fisler.length) return null;
  const toplam = fisler.reduce((t, f) => t + Number(f.kalanTry), 0);
  return (
    <Card className="fatura-baglama__panel" title="Faturaya bağlanmamış ödemeler">
      <p className="subtle">Bu caride faturaya bağlanmamış {yaz(toplam)} TL tutarında ödeme var. Vadesi geçmiş görünen faturalar bununla ödenmiş olabilir; ödemeyi faturalara bağlayın.</p>
      <TableWrap>
        <thead><tr><th>Tarih</th><th>Fiş</th><th>Tür</th><th className="num">Tutar</th><th className="num">Bağlanmamış</th>{yazabilir && <th />}</tr></thead>
        <tbody>
          {fisler.map((f) => (
            <tr key={f.id}>
              <td>{new Date(f.tarih).toLocaleDateString("tr-TR")}</td>
              <td>{f.makbuzNo ?? f.aciklama ?? "—"}</td>
              <td>{f.tip === "tahsilat" ? "Tahsilat" : "Ödeme"}</td>
              <td className="num"><Para deger={f.tutar} dovizCinsi={f.dovizCinsi} /></td>
              <td className="num"><strong><Para deger={f.kalan} dovizCinsi={f.dovizCinsi} /></strong></td>
              {yazabilir && <td><Button size="sm" onClick={() => setAcik(f.id)}>Faturalara bağla</Button></td>}
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {acik && <FaturaBaglamaPenceresi hareketId={acik} onKapat={() => setAcik(null)} onBitti={(m) => { setAcik(null); yukle(); onDegisti?.(m); }} />}
    </Card>
  );
}
