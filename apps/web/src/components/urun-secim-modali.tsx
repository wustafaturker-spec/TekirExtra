"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Button, Field, Input, Select } from "@/components/ui";
import { dovizUyumsuzlugu, paraBirimiEtiketi } from "@/lib/doviz-uyumu";

export interface UrunSecimStok {
  id: string; kod: string; ad: string; anaBirim?: string; kdvOrani?: string;
  kullanilabilirMiktar?: string; mevcutMiktar?: string; aciklama?: string | null;
}
interface Varyant { id: string; kod: string; ad: string; mevcutMiktar: string; aktif: boolean }
interface FiyatListesi { id: string; ad: string; dovizCinsi: string; aktif: boolean }
interface Tavsiye {
  birimFiyat: number; kaynakFiyat: number; kaynakDoviz: string; belgeDovizi: string;
  belgeKuru: number; urunKuru: number | null; cevrilebilir: boolean; fiyatKaynagi: string; iskontoOrani: number;
}
export interface UrunSecimSonucu {
  stokId: string; varyantId?: string; miktar: number; birimFiyat: number;
  iskontoOrani: number; kdvOrani: number; kaynakDoviz: string; kaynakFiyat: number; urunKuru: number;
}

export function UrunSecimModali({ acik, baslangicStokId, stoklar, cariId, tip, belgeDovizi, belgeKuru, belgeTarihi, onKapat, onEkle }: {
  acik: boolean; stoklar: UrunSecimStok[]; cariId?: string; tip: string; belgeDovizi: string; belgeKuru: string;
  baslangicStokId?: string;
  belgeTarihi: string;
  onKapat: () => void; onEkle: (sonuc: UrunSecimSonucu) => void;
}) {
  const [arama, setArama] = useState("");
  const [stokId, setStokId] = useState("");
  const [varyantlar, setVaryantlar] = useState<Varyant[]>([]);
  const [varyantId, setVaryantId] = useState("");
  const [listeler, setListeler] = useState<FiyatListesi[]>([]);
  const [fiyatListesiId, setFiyatListesiId] = useState("");
  const [miktar, setMiktar] = useState("1");
  const [fiyat, setFiyat] = useState<Tavsiye | null>(null);
  const [birimFiyat, setBirimFiyat] = useState("0");
  /** FTR-28: ürünün fiyatı belge dövizinde değil; elle fiyat girilene kadar eklenemez. */
  const [dovizUyarisi, setDovizUyarisi] = useState<string | undefined>();
  const [iskonto, setIskonto] = useState("0");
  const [kdv, setKdv] = useState("20");
  const [hata, setHata] = useState("");
  const stok = stoklar.find((s) => s.id === stokId);
  const sonuclar = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr-TR");
    return (q ? stoklar.filter((s) => `${s.kod} ${s.ad}`.toLocaleLowerCase("tr-TR").includes(q)) : stoklar).slice(0, 12);
  }, [arama, stoklar]);

  useEffect(() => { if (acik) void api<FiyatListesi[]>("/fiyat-listeleri").then((x) => setListeler(x.filter((l) => l.aktif))).catch(() => setListeler([])); }, [acik]);
  useEffect(() => {
    if (!acik) return;
    setStokId(baslangicStokId ?? ""); setVaryantId(""); setMiktar("1"); setFiyat(null); setHata(""); setDovizUyarisi(undefined);
    const secili = stoklar.find((s) => s.id === baslangicStokId);
    if (secili) setKdv(secili.kdvOrani ?? "20");
  }, [acik, baslangicStokId, stoklar]);
  useEffect(() => {
    if (!stokId) { setVaryantlar([]); return; }
    void api<{ varyantlar: Varyant[] }>(`/stok/${stokId}`).then((x) => setVaryantlar((x.varyantlar ?? []).filter((v) => v.aktif))).catch(() => setVaryantlar([]));
    void fiyatGetir("", fiyatListesiId);
    // Yeni ürün seçildiğinde o ürünün başlangıç fiyatı yüklenir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stokId]);

  /**
   * FTR-28: kalem fiyatı belgenin dövizindedir. Ürünün fiyatı başka dövizdeyse
   * çevrilmez, boş gelir (kullanıcı kararı, 2026-09-27: "eklemeyi engelle").
   */
  async function fiyatGetir(seciliVaryant = varyantId, seciliListe = fiyatListesiId) {
    if (!stokId) return;
    const p = new URLSearchParams({ tip, dovizCinsi: belgeDovizi, belgeKuru: belgeDovizi === "TRY" ? "1" : belgeKuru || "1" });
    if (cariId) p.set("cariId", cariId);
    if (seciliListe) p.set("fiyatListesiId", seciliListe);
    if (seciliVaryant) p.set("varyantId", seciliVaryant);
    try {
      const t = await api<Tavsiye>(`/stok/${stokId}/tavsiye-fiyat?${p}`);
      const uyari = dovizUyumsuzlugu(t.kaynakDoviz, belgeDovizi);
      setFiyat(t); setIskonto(String(t.iskontoOrani)); setDovizUyarisi(uyari); setHata("");
      setBirimFiyat(uyari ? "" : String(t.kaynakFiyat));
    } catch (e) { setHata(e instanceof Error ? e.message : "Fiyat alınamadı"); }
  }

  function stokSec(id: string) {
    const s = stoklar.find((x) => x.id === id); setStokId(id); setVaryantId(""); setKdv(s?.kdvOrani ?? "20");
  }
  if (!acik) return null;
  return <div className="product-picker-layer" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onKapat(); }}>
    <section className="product-picker" role="dialog" aria-modal="true" aria-label="Ürün veya hizmet ekle">
      <header><div><small>ÜRÜN / HİZMETLER</small><h3>{stok ? `${stok.kod} ${stok.ad}` : "Ürün seçin"}</h3></div><button type="button" aria-label="Kapat" onClick={onKapat}>×</button></header>
      {!stok ? <div className="product-picker__search">
        <Input autoFocus value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Kod, barkod veya ürün adıyla ara" />
        <div className="product-picker__results">{sonuclar.map((s) => <button type="button" key={s.id} onClick={() => stokSec(s.id)}><strong>{s.ad}</strong><span>{s.kod}</span><em>{Number(s.kullanilabilirMiktar ?? s.mevcutMiktar ?? 0).toLocaleString("tr-TR")} {s.anaBirim ?? "adet"}</em></button>)}{!sonuclar.length && <p>Aramayla eşleşen ürün bulunamadı.</p>}</div>
      </div> : <div className="product-picker__body">
        {fiyat && <p className="product-picker__notice">Ürün fiyatı: <strong>{Number(fiyat.kaynakFiyat).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {paraBirimiEtiketi(fiyat.kaynakDoviz)}</strong> · Belge: {paraBirimiEtiketi(belgeDovizi)}</p>}
        {dovizUyarisi && <p className="product-picker__notice is-warning" role="alert">{dovizUyarisi}</p>}
        <div className="product-picker__grid">
          <Field label="Miktar"><Input autoFocus type="number" min="0.000001" step="any" value={miktar} onChange={(e) => setMiktar(e.target.value)} /></Field>
          {varyantlar.length > 0 && <Field label="Varyant"><Select value={varyantId} onChange={(e) => { setVaryantId(e.target.value); void fiyatGetir(e.target.value, fiyatListesiId); }}><option value="">Ana ürün</option>{varyantlar.map((v) => <option value={v.id} key={v.id}>{v.kod} — {v.ad} (stok {Number(v.mevcutMiktar).toLocaleString("tr-TR")})</option>)}</Select></Field>}
          <Field label="Fiyat listesi"><Select value={fiyatListesiId} onChange={(e) => { setFiyatListesiId(e.target.value); void fiyatGetir(varyantId, e.target.value); }}><option value="">Cari / ürün varsayılanı</option>{listeler.map((l) => <option value={l.id} key={l.id}>{l.ad} ({l.dovizCinsi})</option>)}</Select></Field>
          <Field label="Birim fiyat"><div className="row"><Input type="number" min="0" step="any" value={birimFiyat} onChange={(e) => { setBirimFiyat(e.target.value); setDovizUyarisi(undefined); }} /><strong>{paraBirimiEtiketi(belgeDovizi)}</strong></div></Field>
          <Field label="KDV (%)"><Input type="number" min="0" max="100" value={kdv} onChange={(e) => setKdv(e.target.value)} /></Field>
          <Field label="İndirim (%)"><Input type="number" min="0" max="100" value={iskonto} onChange={(e) => setIskonto(e.target.value)} /></Field>
        </div>
        {hata && <p className="product-picker__notice is-warning" role="alert">{hata}</p>}
        <div className="product-picker__total"><span>TOPLAM</span><strong>{(Number(miktar) * Number(birimFiyat || 0) * (1 - Number(iskonto) / 100)).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {paraBirimiEtiketi(belgeDovizi)}</strong></div>
        <footer><Button type="button" onClick={() => { setStokId(""); setFiyat(null); }}>Başka ürün seç</Button><Button variant="primary" type="button" disabled={Number(miktar) <= 0 || Boolean(dovizUyarisi) || birimFiyat === "" || !Number.isFinite(Number(birimFiyat))} onClick={() => onEkle({ stokId, varyantId: varyantId || undefined, miktar: Number(miktar), birimFiyat: Number(birimFiyat), iskontoOrani: Number(iskonto), kdvOrani: Number(kdv), kaynakDoviz: belgeDovizi, kaynakFiyat: Number(birimFiyat), urunKuru: 1 })}>+ Ekle</Button></footer>
      </div>}
    </section>
  </div>;
}
