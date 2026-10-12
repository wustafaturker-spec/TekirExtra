"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Button, Field, Input, Select } from "@/components/ui";
import { birimKatsayisi, SatirBirimi } from "@/components/birim-secimi";
import { birimKisaAdi } from "@tekirextra/shared";
import { DovizSecenekleri } from "@/components/doviz-secenekleri";

export interface UrunSecimStok {
  id: string; kod: string; ad: string; anaBirim?: string; kdvOrani?: string;
  /** STK-10: ek birimler (1 koli = 12 adet). */
  birimler?: { ad: string; katsayi: string }[];
  kullanilabilirMiktar?: string; mevcutMiktar?: string; aciklama?: string | null;
  barkod?: string | null;
  /** Aktif varyantlar: aramada varyant kodu/barkodu ürünü bulur ve varyantı seçer. */
  varyantlar?: { id: string; kod: string; barkod?: string | null }[];
  /** EBLG-125: kartın KDV dışı vergileri (ÖTV, ÖİV…). */
  ekVergiler?: UrunEkVergisi[];
}
/** EBLG-125: kart vergisi — oran (%) ya da birim başı tutar. */
export interface UrunEkVergisi { kod: string; hesap: "oran" | "birim"; deger: string }
interface Varyant { id: string; kod: string; ad: string; mevcutMiktar: string; aktif: boolean }
interface FiyatListesi { id: string; ad: string; dovizCinsi: string; aktif: boolean }
interface Tavsiye {
  birimFiyat: number; kaynakFiyat: number; kaynakDoviz: string; belgeDovizi: string;
  belgeKuru: number; urunKuru: number | null; cevrilebilir: boolean; fiyatKaynagi: string; iskontoOrani: number;
  aiOneri?: {
    onerilenFiyat: number;
    paraBirimi: string;
    altSinirFiyat: number;
    ustSinirFiyat: number;
    iskontoVeyaVadeFarkiOrani: number;
    karMarjiYuzde?: number;
    fiyatKaynagi?: string;
    uyarilar?: string[];
    kirilim: {
      bazFiyat: number;
      grupIskontosuYuzde: number;
      miktarIskontosuYuzde: number;
      efektifVadeGun: number;
      vadeFinansmanMaliyetiYuzde: number;
      asgariMaliyetKalkan: number;
    };
    gerekceler: string[];
    guvenSkoru: number;
  } | null;
}
export interface UrunSecimSonucu {
  stokId: string; varyantId?: string; miktar: number; birim: string; birimFiyat: number;
  iskontoOrani: number; kdvOrani: number; kaynakDoviz: string; kaynakFiyat: number; urunKuru: number;
  /** EBLG-125: pencerede gösterilip düzenlenebilen KDV dışı vergiler; `vergiTurleri` verilmezse boş. */
  ekVergiler: UrunEkVergisi[];
}

export function UrunSecimModali({ acik, baslangicStokId, baslangicVaryantId, stoklar, cariId, tip, belgeDovizi, belgeKuru, belgeTarihi, vergiTurleri, onKapat, onEkle }: {
  acik: boolean; stoklar: UrunSecimStok[]; cariId?: string; tip: string; belgeDovizi: string; belgeKuru: string;
  baslangicStokId?: string;
  /** Satır araması bir varyantı bulduysa pencere o varyant seçili açılır. */
  baslangicVaryantId?: string;
  belgeTarihi: string;
  /**
   * EBLG-125: verilirse kartın KDV dışı vergileri KDV gibi pencerede görünür ve
   * düzenlenir. KDV dışı vergi taşımayan belgede (teklif, irsaliye, iade) verilmez.
   */
  vergiTurleri?: readonly { kod: string; ad: string; stopaj: boolean }[];
  onKapat: () => void; onEkle: (sonuc: UrunSecimSonucu) => void;
}) {
  const [arama, setArama] = useState("");
  const [stokId, setStokId] = useState("");
  const [varyantlar, setVaryantlar] = useState<Varyant[]>([]);
  const [varyantId, setVaryantId] = useState("");
  const [listeler, setListeler] = useState<FiyatListesi[]>([]);
  const [fiyatListesiId, setFiyatListesiId] = useState("");
  const [miktar, setMiktar] = useState("1");
  const [birim, setBirim] = useState("");
  const [urunKuru, setUrunKuru] = useState("1");
  const [fiyat, setFiyat] = useState<Tavsiye | null>(null);
  const [birimFiyat, setBirimFiyat] = useState("0");
  const [fiyatDovizi, setFiyatDovizi] = useState("TRY");
  const [tcmbKurlari, setTcmbKurlari] = useState<Record<string, number>>({ TRY: 1 });
  const [kurTarihi, setKurTarihi] = useState("");
  const [kurDurumu, setKurDurumu] = useState<"yukleniyor" | "hazir" | "hata">("yukleniyor");
  const [kurHatasi, setKurHatasi] = useState("");
  const [iskonto, setIskonto] = useState("0");
  const [kdv, setKdv] = useState("20");
  const [ekVergiler, setEkVergiler] = useState<UrunEkVergisi[]>([]);
  /** Kartın vergileri; tanımı merkezde olmayan kod gösterilmez (faturada da taşınmaz). */
  const kartVergileri = (s?: UrunSecimStok) => (vergiTurleri ? (s?.ekVergiler ?? []).filter((v) => vergiTurleri.some((t) => t.kod === v.kod)) : []);
  const [hata, setHata] = useState("");
  const stok = stoklar.find((s) => s.id === stokId);
  const sonuclar = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr-TR");
    return (q ? stoklar.filter((s) => [s.kod, s.ad, s.barkod, ...(s.varyantlar ?? []).flatMap((v) => [v.kod, v.barkod])].filter(Boolean).join(" ").toLocaleLowerCase("tr-TR").includes(q)) : stoklar).slice(0, 12);
  }, [arama, stoklar]);

  useEffect(() => { if (acik) void api<FiyatListesi[]>("/fiyat-listeleri").then((x) => setListeler(x.filter((l) => l.aktif))).catch(() => setListeler([])); }, [acik]);
  async function kurlariYukle() {
    setKurDurumu("yukleniyor"); setKurHatasi("");
    try {
      let x: { kurTarihi: string; kurlar: Record<string, number> };
      try {
        x = await api<{ kurTarihi: string; kurlar: Record<string, number> }>(`/doviz-kurlari?tarih=${belgeTarihi}&tip=alis`);
      } catch {
        const yanit = await fetch(`/api/tcmb-kurlar?tarih=${belgeTarihi}`, { cache: "no-store" });
        const govde = await yanit.json() as { kurTarihi?: string; kurlar?: Record<string, number>; message?: string };
        if (!yanit.ok || !govde.kurTarihi || !govde.kurlar) throw new Error(govde.message ?? "TCMB kur servisine ulaşılamadı");
        x = { kurTarihi: govde.kurTarihi, kurlar: govde.kurlar };
      }
      setTcmbKurlari({ TRY: 1, ...x.kurlar }); setKurTarihi(x.kurTarihi); setKurDurumu("hazir");
    } catch (e) { setTcmbKurlari({ TRY: 1 }); setKurTarihi(""); setKurHatasi(e instanceof Error ? e.message : "Kur servisine ulaşılamadı"); setKurDurumu("hata"); }
  }
  // DVZ-10: fiyatın ve belgenin dövizi gösterilir; ikisi de TL ise USD/EUR.
  const gosterilecekKurlar = [...new Set([fiyatDovizi, fiyat?.kaynakDoviz, belgeDovizi].filter((d): d is string => Boolean(d) && d !== "TRY"))];
  if (!gosterilecekKurlar.length) gosterilecekKurlar.push("USD", "EUR");
  useEffect(() => { if (acik) void kurlariYukle(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [acik, belgeTarihi]);
  useEffect(() => {
    if (!acik) return;
    setStokId(baslangicStokId ?? ""); setVaryantId(baslangicVaryantId ?? ""); setMiktar("1"); setFiyat(null); setHata("");
    const secili = stoklar.find((s) => s.id === baslangicStokId);
    setBirim(secili?.anaBirim ?? "adet");
    if (secili) setKdv(secili.kdvOrani ?? "20");
    setEkVergiler(kartVergileri(secili));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik, baslangicStokId, baslangicVaryantId, stoklar]);
  useEffect(() => {
    if (!stokId) { setVaryantlar([]); return; }
    // Seçili varyant bu ürüne ait değilse (ürün değişti) bırakılır; fiyat varyanta göre gelir.
    void api<{ varyantlar: Varyant[] }>(`/stok/${stokId}`).then((x) => {
      const liste = (x.varyantlar ?? []).filter((v) => v.aktif);
      setVaryantlar(liste);
      const gecerli = liste.some((v) => v.id === varyantId) ? varyantId : "";
      setVaryantId(gecerli);
      void fiyatGetir("1", gecerli, fiyatListesiId);
    }).catch(() => { setVaryantlar([]); void fiyatGetir("1", "", fiyatListesiId); });
    // Yeni ürün seçildiğinde o ürünün başlangıç fiyatı yüklenir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stokId]);

  async function fiyatGetir(kaynakKur = urunKuru, seciliVaryant = varyantId, seciliListe = fiyatListesiId, seciliMiktar = miktar) {
    if (!stokId) return;
    const p = new URLSearchParams({ tip, dovizCinsi: belgeDovizi, belgeKuru: belgeDovizi === "TRY" ? "1" : belgeKuru || "1" });
    if (cariId) p.set("cariId", cariId);
    if (seciliListe) p.set("fiyatListesiId", seciliListe);
    if (seciliVaryant) p.set("varyantId", seciliVaryant);
    if (kaynakKur) p.set("urunKuru", kaynakKur);
    if (seciliMiktar) p.set("miktar", seciliMiktar);
    try {
      const t = await api<Tavsiye>(`/stok/${stokId}/tavsiye-fiyat?${p}`);
      // Tavsiye fiyat ana birim başınadır; seçili ek birime ölçeklenir.
      setFiyat(t); setBirimFiyat(String(Number((t.kaynakFiyat * birimKatsayisi(seciliStok, birim)).toFixed(4)))); setFiyatDovizi(t.kaynakDoviz); setIskonto(String(t.iskontoOrani));
      if (t.kaynakDoviz === "TRY") setUrunKuru("1");
      setHata(t.cevrilebilir ? "" : `${t.kaynakDoviz} fiyatını ${belgeDovizi} para birimine çevirmek için ürün kurunu girin.`);
    } catch (e) { setHata(e instanceof Error ? e.message : "Fiyat alınamadı"); }
  }

  function stokSec(id: string) {
    // Aranan metin bir varyantın kodu/barkoduysa o varyant hazır seçilir.
    const q = arama.trim().toLocaleLowerCase("tr-TR");
    const s = stoklar.find((x) => x.id === id);
    const eslesen = q ? s?.varyantlar?.find((v) => [v.kod, v.barkod].some((d) => d?.toLocaleLowerCase("tr-TR") === q)) : undefined;
    setStokId(id); setVaryantId(eslesen?.id ?? ""); setKdv(s?.kdvOrani ?? "20"); setBirim(s?.anaBirim ?? "adet");
    setEkVergiler(kartVergileri(s));
  }
  const seciliStok = stoklar.find((s) => s.id === stokId);
  function birimDegistir(yeni: string) {
    const oran = birimKatsayisi(seciliStok, yeni) / birimKatsayisi(seciliStok, birim);
    setBirimFiyat(String(Number((Number(birimFiyat) * oran).toFixed(4))));
    setBirim(yeni);
  }
  function fiyatDoviziDegistir(yeniDoviz: string) {
    const kaynakKur = tcmbKurlari[fiyatDovizi]; const hedefKur = tcmbKurlari[yeniDoviz];
    if (kaynakKur && hedefKur) setBirimFiyat(String(Number((Number(birimFiyat) * kaynakKur / hedefKur).toFixed(4))));
    setFiyatDovizi(yeniDoviz); setUrunKuru(String(hedefKur ?? 1));
  }
  const belgeyeCevrilmisFiyat = (() => { const kaynakKur = tcmbKurlari[fiyatDovizi]; const hedefKur = belgeDovizi === "TRY" ? 1 : Number(belgeKuru); return kaynakKur && hedefKur ? Number(birimFiyat) * kaynakKur / hedefKur : Number(birimFiyat); })();
  // EBLG-125: faturadaki hesapla aynı — oran satır matrahına, birim tutarı satır miktarına.
  const matrah = Number(miktar) * belgeyeCevrilmisFiyat * (1 - Number(iskonto) / 100);
  // EBLG-131: maktu vergi kartın ana birimi başınadır; ek birimde (koli) katsayıyla çarpılır.
  const ekVergiTutarlari = ekVergiler.map((v) => (v.hesap === "oran" ? matrah * Number(v.deger) / 100 : Number(miktar) * birimKatsayisi(seciliStok, birim) * Number(v.deger)));
  const vergiTuru = (kod: string) => vergiTurleri?.find((t) => t.kod === kod);
  const para = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!acik) return null;
  return <div className="product-picker-layer" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onKapat(); }}>
    <section className="product-picker" role="dialog" aria-modal="true" aria-label="Ürün veya hizmet ekle">
      <header><div><small>ÜRÜN / HİZMETLER</small><h3>{stok ? `${stok.kod} ${stok.ad}` : "Ürün seçin"}</h3></div><button type="button" aria-label="Kapat" onClick={onKapat}>×</button></header>
      {!stok ? <div className="product-picker__search">
        <Input autoFocus value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Kod, barkod veya ürün adıyla ara" />
        <div className="product-picker__results">{sonuclar.map((s) => <button type="button" key={s.id} onClick={() => stokSec(s.id)}><strong>{s.ad}</strong><span>{s.kod}</span><em>{Number(s.kullanilabilirMiktar ?? s.mevcutMiktar ?? 0).toLocaleString("tr-TR")} {birimKisaAdi(s.anaBirim ?? "adet")}</em></button>)}{!sonuclar.length && <p>Aramayla eşleşen ürün bulunamadı.</p>}</div>
      </div> : <div className="product-picker__body">
        {fiyat && <p className="product-picker__notice">Orijinal ürün fiyatı: <strong>{Number(fiyat.kaynakFiyat).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {fiyat.kaynakDoviz}</strong>{kurTarihi && ` · TCMB döviz alış kuru: ${kurTarihi}`}</p>}
        {fiyat?.aiOneri && (
          <div className="product-picker__notice" style={{ backgroundColor: "#eff6ff", borderColor: "#bfdbfe", color: "#1e3a8a", padding: "8px 12px", borderRadius: "6px", marginBottom: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <span style={{ fontWeight: 600 }}>✨ AI Dinamik Fiyat Önerisi: <strong>{fiyat.aiOneri.onerilenFiyat.toFixed(2)} {fiyat.aiOneri.paraBirimi}</strong></span>
              <button
                type="button"
                onClick={() => {
                  setBirimFiyat(String(fiyat.aiOneri!.onerilenFiyat));
                  if (fiyat.aiOneri!.kirilim.grupIskontosuYuzde || fiyat.aiOneri!.kirilim.miktarIskontosuYuzde) {
                    setIskonto(String(fiyat.aiOneri!.kirilim.grupIskontosuYuzde + fiyat.aiOneri!.kirilim.miktarIskontosuYuzde));
                  }
                }}
                style={{ fontSize: "11px", backgroundColor: "#2563eb", color: "#fff", padding: "2px 8px", borderRadius: "4px", border: "none", cursor: "pointer" }}
              >
                Öneriyi Uygula
              </button>
            </div>
            <div style={{ fontSize: "11px", color: "#3b82f6", display: "flex", gap: "12px", alignItems: "center" }}>
              <span>Alt Sınır (Stop-loss): {fiyat.aiOneri.altSinirFiyat.toFixed(2)}</span>
              <span>Üst Sınır: {fiyat.aiOneri.ustSinirFiyat.toFixed(2)}</span>
              <span>Net Değişim: %{fiyat.aiOneri.iskontoVeyaVadeFarkiOrani > 0 ? `+${fiyat.aiOneri.iskontoVeyaVadeFarkiOrani}` : fiyat.aiOneri.iskontoVeyaVadeFarkiOrani}</span>
              {fiyat.aiOneri.karMarjiYuzde !== undefined && (
                <span style={{ fontWeight: 600, color: fiyat.aiOneri.karMarjiYuzde < 15 ? "#dc2626" : "#16a34a" }}>
                  Marj: %{fiyat.aiOneri.karMarjiYuzde.toFixed(1)}
                </span>
              )}
            </div>
            {fiyat.aiOneri.uyarilar && fiyat.aiOneri.uyarilar.length > 0 && (
              <div style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "4px", padding: "6px 8px", marginTop: "6px" }}>
                {fiyat.aiOneri.uyarilar.map((u, i) => (
                  <div key={i} style={{ color: "#991b1b", fontSize: "11px", fontWeight: 500 }}>{u}</div>
                ))}
              </div>
            )}
            {fiyat.aiOneri.gerekceler.length > 0 && (
              <ul style={{ margin: "4px 0 0", paddingLeft: "16px", fontSize: "11px", color: "#475569" }}>
                {fiyat.aiOneri.gerekceler.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            )}
          </div>
        )}
        {kurDurumu === "yukleniyor" && <p className="product-picker__notice">TCMB döviz alış kurları yükleniyor…</p>}
        {kurDurumu === "hata" && <p className="product-picker__notice is-warning" role="alert">TCMB kurları alınamadı: {kurHatasi}. <button type="button" onClick={() => void kurlariYukle()}>Tekrar dene</button></p>}
        {kurDurumu === "hazir" && <div className="product-picker__rates">{gosterilecekKurlar.map((d) => <span key={d}>{d} alış <strong>{tcmbKurlari[d]?.toLocaleString("tr-TR", { minimumFractionDigits: 4 }) ?? "—"}</strong></span>)}<small>{kurTarihi}</small></div>}
        <div className="product-picker__grid">
          <Field label="Miktar"><div className="document-line-qty"><Input autoFocus type="number" min="0.000001" step="any" value={miktar} onChange={(e) => setMiktar(e.target.value)} /><SatirBirimi stok={seciliStok} value={birim} onChange={birimDegistir} /></div></Field>
          {varyantlar.length > 0 && <Field label="Varyant"><Select required value={varyantId} onChange={(e) => { setVaryantId(e.target.value); void fiyatGetir(urunKuru, e.target.value, fiyatListesiId); }}><option value="">Varyant seçin</option>{varyantlar.map((v) => <option value={v.id} key={v.id}>{v.kod} — {v.ad} (stok {Number(v.mevcutMiktar).toLocaleString("tr-TR")})</option>)}</Select></Field>}
          <Field label="Fiyat listesi"><Select value={fiyatListesiId} onChange={(e) => { setFiyatListesiId(e.target.value); void fiyatGetir(urunKuru, varyantId, e.target.value); }}><option value="">Cari / ürün varsayılanı</option>{listeler.map((l) => <option value={l.id} key={l.id}>{l.ad} ({l.dovizCinsi})</option>)}</Select></Field>
          <Field label="Fiyat para birimi"><Select value={fiyatDovizi} onChange={(e) => fiyatDoviziDegistir(e.target.value)}><DovizSecenekleri /></Select></Field>
          <Field label={`Ürün kuru (${fiyatDovizi} → TRY)`}><Input type="number" min="0.000001" step="0.000001" disabled={fiyatDovizi === "TRY"} value={fiyatDovizi === "TRY" ? "1" : String(tcmbKurlari[fiyatDovizi] ?? urunKuru)} onChange={(e) => { setUrunKuru(e.target.value); setTcmbKurlari((k) => ({ ...k, [fiyatDovizi]: Number(e.target.value) })); }} /></Field>
          <Field label={`Belge kuru (${belgeDovizi} → TRY)`}><Input readOnly value={belgeDovizi === "TRY" ? "1" : belgeKuru} /></Field>
          <Field label="Birim fiyat"><div className="row"><Input type="number" min="0" step="any" value={birimFiyat} onChange={(e) => setBirimFiyat(e.target.value)} /><strong>{fiyatDovizi}</strong></div></Field>
          <Field label="KDV (%)"><Input type="number" min="0" max="100" value={kdv} onChange={(e) => setKdv(e.target.value)} /></Field>
          {ekVergiler.map((v, i) => <Field key={v.kod} label={`${vergiTuru(v.kod)?.ad ?? v.kod} ${v.hesap === "oran" ? "(%)" : `(${belgeDovizi} / ${birimKisaAdi(seciliStok?.anaBirim || "adet")})`}`}>
            <Input type="number" min="0" max={v.hesap === "oran" ? 100 : undefined} step="any" value={v.deger} onChange={(e) => setEkVergiler((l) => l.map((x, j) => (j === i ? { ...x, deger: e.target.value } : x)))} />
          </Field>)}
          <Field label="İndirim (%)"><Input type="number" min="0" max="100" value={iskonto} onChange={(e) => setIskonto(e.target.value)} /></Field>
        </div>
        {hata && <p className="product-picker__notice is-warning" role="alert">{hata}</p>}
        <div className="product-picker__total"><span>TOPLAM</span><strong>{matrah.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {belgeDovizi}</strong></div>
        {ekVergiler.length > 0 && <ul className="product-picker__taxes">{ekVergiler.map((v, i) => <li key={v.kod}><span>{vergiTuru(v.kod)?.ad ?? v.kod}{vergiTuru(v.kod)?.stopaj ? " (stopaj, ödenecekten düşer)" : ""}</span><strong>{vergiTuru(v.kod)?.stopaj ? "−" : ""}{para(ekVergiTutarlari[i] || 0)} {belgeDovizi}</strong></li>)}</ul>}
        <footer><Button type="button" onClick={() => { setStokId(""); setFiyat(null); }}>Başka ürün seç</Button><Button variant="primary" type="button" disabled={Number(miktar) <= 0 || !Number.isFinite(belgeyeCevrilmisFiyat) || (varyantlar.length > 0 && !varyantId) || ekVergiler.some((v) => !(Number(v.deger) > 0))} onClick={() => onEkle({ stokId, varyantId: varyantId || undefined, miktar: Number(miktar), birim: birim || seciliStok?.anaBirim || "adet", birimFiyat: belgeyeCevrilmisFiyat, iskontoOrani: Number(iskonto), kdvOrani: Number(kdv), kaynakDoviz: fiyatDovizi, kaynakFiyat: Number(birimFiyat), urunKuru: tcmbKurlari[fiyatDovizi] ?? Number(urunKuru), ekVergiler: ekVergiler.map((v) => ({ ...v, deger: String(Number(v.deger)) })) })}>+ Ekle</Button></footer>
      </div>}
    </section>
  </div>;
}
