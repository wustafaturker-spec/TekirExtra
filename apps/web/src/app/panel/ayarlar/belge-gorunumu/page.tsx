"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiDosyaBlob } from "@/lib/api";
import { Alert, Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { BELGE_DILLERI, BELGE_DILI_ADLARI, ciftDilGecerli, type BelgeDili } from "@tekirextra/shared";

/**
 * FTR-42: Belge Görünümü. Kullanıcı kurumsal düzeni (FTR-37/38) serbest
 * çizmez; ayarlanabilir yerlerini değiştirir. Önizleme sunucudaki gerçek PDF
 * üretecinden gelir ve kaydedilmemiş seçimi de gösterir. Renk, yazı ve düzen
 * tüm belgelerde ortaktır; bölümler türe, metinler tür + dile göredir.
 */

const TURLER = [
  ["teklif", "Teklif"], ["siparis", "Sipariş"], ["proforma", "Proforma"],
  ["irsaliye", "İrsaliye"], ["makbuz", "Makbuz"], ["fatura", "Fatura"],
] as const;
type Tur = (typeof TURLER)[number][0];

interface Bolumler { banka: boolean; yaziyla: boolean; imza: boolean; kodSutunu: boolean; kase: boolean }
interface Metinler { kapanis?: string; kosullar?: string; altNot?: string; imzalar?: string }
interface Gorunum {
  anaRenk: string;
  ikincilRenk: string;
  yaziTipi: "dejavu" | "noto-sans" | "noto-serif" | "liberation";
  yaziBoyutu: "kucuk" | "normal" | "buyuk";
  logoYeri: "sol" | "orta";
  logoBoyutu: "kucuk" | "orta" | "buyuk";
  tabloBaslik: "dolu" | "cizgi" | "sade";
  zebra: boolean;
  kose: "yuvarlak" | "keskin";
  taslakFiligrani: boolean;
  bolumler: Record<Tur, Bolumler>;
  metinler: Partial<Record<Tur, Partial<Record<BelgeDili, Metinler>>>>;
}

/** Hazır kurumsal paletler: ana renk + ikincil (metin) rengi. */
const PALETLER: { ad: string; ana: string; ikincil: string }[] = [
  { ad: "Petrol", ana: "#0f766e", ikincil: "#1f2937" },
  { ad: "Lacivert", ana: "#1e3a8a", ikincil: "#1f2937" },
  { ad: "Gece mavisi", ana: "#0c4a6e", ikincil: "#0f172a" },
  { ad: "Bordo", ana: "#9f1239", ikincil: "#1f2937" },
  { ad: "Orman", ana: "#166534", ikincil: "#1f2937" },
  { ad: "Kiremit", ana: "#c2410c", ikincil: "#292524" },
  { ad: "Mor", ana: "#6d28d9", ikincil: "#1f2937" },
  { ad: "Antrasit", ana: "#374151", ikincil: "#111827" },
];

const BOLUM_ADLARI: [keyof Bolumler, string][] = [
  ["banka", "Banka bilgileri"], ["yaziyla", "Yazıyla tutar"], ["imza", "İmza alanları"],
  ["kodSutunu", "Kod sütunu"], ["kase", "Kaşe/imza görseli"],
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** WCAG kontrast oranı; ana renk beyaz zeminde başlık olarak okunmalı. */
function kontrast(a: string, b: string): number {
  const p = (hex: string) => {
    const k = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
  };
  const [l1, l2] = [p(a), p(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export default function BelgeGorunumuSayfasi() {
  const [gorunum, setGorunum] = useState<Gorunum | null>(null);
  const [firmaId, setFirmaId] = useState<string | null>(null);
  const [kase, setKase] = useState<{ id: string; dosyaAdi: string } | null>(null);
  const [tur, setTur] = useState<Tur>("teklif");
  const [dil, setDil] = useState<BelgeDili>("tr");
  const [ciftDil, setCiftDil] = useState(false);
  const [metinDili, setMetinDili] = useState<BelgeDili>("tr");
  const [onizleme, setOnizleme] = useState<string | null>(null);
  const [onizlemeYukleniyor, setOnizlemeYukleniyor] = useState(false);
  const [degisti, setDegisti] = useState(false);
  const [islemde, setIslemde] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const adresRef = useRef<string | null>(null);
  const siraRef = useRef(0);

  const yukle = useCallback(async () => {
    try {
      const yanit = await api<{ gorunum: Gorunum; firmaId: string; kase: { id: string; dosyaAdi: string } | null }>("/belge-gorunumu");
      setGorunum(yanit.gorunum); setFirmaId(yanit.firmaId); setKase(yanit.kase); setDegisti(false);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belge görünümü okunamadı");
    }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  // Seçim değişince önizleme kısa bir beklemeyle tazelenir; eski yanıt yenisini ezmez.
  useEffect(() => {
    if (!gorunum) return;
    const sira = ++siraRef.current;
    const zamanlayici = setTimeout(async () => {
      setOnizlemeYukleniyor(true);
      try {
        const blob = await apiDosyaBlob("/belge-gorunumu/onizleme", {
          method: "POST",
          body: JSON.stringify({ gorunum, tur, dil, ciftDil: ciftDilGecerli(dil, ciftDil) }),
        });
        if (sira !== siraRef.current) return;
        if (adresRef.current) URL.revokeObjectURL(adresRef.current);
        adresRef.current = URL.createObjectURL(blob);
        setOnizleme(adresRef.current);
        setHata("");
      } catch (h) {
        if (sira === siraRef.current) setHata(h instanceof Error ? h.message : "Önizleme üretilemedi");
      } finally {
        if (sira === siraRef.current) setOnizlemeYukleniyor(false);
      }
    }, 500);
    return () => clearTimeout(zamanlayici);
  }, [gorunum, tur, dil, ciftDil, kase]);
  useEffect(() => () => { if (adresRef.current) URL.revokeObjectURL(adresRef.current); }, []);

  function degistir(yeni: Partial<Gorunum>) {
    setGorunum((g) => (g ? { ...g, ...yeni } : g));
    setDegisti(true); setBasari("");
  }
  function bolumDegistir(alan: keyof Bolumler, deger: boolean) {
    setGorunum((g) => (g ? { ...g, bolumler: { ...g.bolumler, [tur]: { ...g.bolumler[tur], [alan]: deger } } } : g));
    setDegisti(true); setBasari("");
  }
  function metinDegistir(alan: keyof Metinler, deger: string) {
    setGorunum((g) => {
      if (!g) return g;
      const turMetinleri = { ...(g.metinler[tur] ?? {}) };
      const mevcut = { ...(turMetinleri[metinDili] ?? {}) };
      // Boş alan "varsayılanı kullan" demektir; anahtar silinir.
      if (deger === "") delete mevcut[alan]; else mevcut[alan] = deger;
      turMetinleri[metinDili] = mevcut;
      return { ...g, metinler: { ...g.metinler, [tur]: turMetinleri } };
    });
    setDegisti(true); setBasari("");
  }

  async function kaydet() {
    if (!gorunum) return;
    setIslemde(true); setHata(""); setBasari("");
    try {
      await api("/ayarlar/belgeGorunumu", { method: "PUT", body: JSON.stringify(gorunum) });
      setBasari("Belge görünümü kaydedildi; yeni basılan bütün belgeler bu görünümle çıkar.");
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kaydedilemedi");
    } finally { setIslemde(false); }
  }

  async function varsayilanaDon() {
    if (!confirm("Bütün görünüm ayarları ve hazır metinler varsayılana dönsün mü?")) return;
    setIslemde(true); setHata(""); setBasari("");
    try {
      await api("/ayarlar/belgeGorunumu", { method: "PUT", body: JSON.stringify({}) });
      setBasari("Varsayılan görünüme dönüldü.");
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Varsayılana dönülemedi");
    } finally { setIslemde(false); }
  }

  async function kaseYukle(e: React.ChangeEvent<HTMLInputElement>) {
    const dosya = e.target.files?.[0];
    e.target.value = "";
    if (!dosya || !firmaId) return;
    setIslemde(true); setHata(""); setBasari("");
    try {
      const form = new FormData();
      form.append("dosya", dosya);
      await api(`/ekler?sahipTur=firma_kase&sahipId=${firmaId}`, { method: "POST", body: form });
      // Yeni dosya güvenle yüklendikten sonra önceki görseli kaldır.
      let eskiKaseKorundu = false;
      if (kase) {
        try { await api(`/ekler/${kase.id}`, { method: "DELETE" }); }
        catch { eskiKaseKorundu = true; }
      }
      setBasari(eskiKaseKorundu
        ? "Yeni kaşe/imza görseli yüklendi. Önceki görsel silinemedi ve ekte korunuyor."
        : "Kaşe/imza görseli yüklendi. Basılacağı belgelerde \"Kaşe/imza görseli\" bölümünü açın.");
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kaşe görseli yüklenemedi");
    } finally { setIslemde(false); }
  }

  async function kaseSil() {
    if (!kase || !confirm("Kaşe/imza görseli silinsin mi?")) return;
    setIslemde(true);
    try {
      await api(`/ekler/${kase.id}`, { method: "DELETE" });
      setKase(null); setBasari("Kaşe/imza görseli silindi.");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Silinemedi");
    } finally { setIslemde(false); }
  }

  if (!gorunum) {
    return (
      <div className="stack">
        <PageHeader title="Belge Görünümü" subtitle="Teklif, sipariş, proforma, irsaliye, makbuz ve faturanın kurumsal görünümü" />
        <Alert tone="error">{hata}</Alert>
        {!hata && <p className="muted">Yükleniyor…</p>}
      </div>
    );
  }

  const bolum = gorunum.bolumler[tur];
  const metin = gorunum.metinler[tur]?.[metinDili] ?? {};
  const zayifKontrast = HEX.test(gorunum.anaRenk) && kontrast(gorunum.anaRenk, "#ffffff") < 3;

  return (
    <div className="stack">
      <PageHeader
        title="Belge Görünümü"
        subtitle="Teklif, sipariş, proforma, irsaliye, makbuz ve kâğıt faturanın kurumsal görünümü. e-Fatura/e-Arşiv/e-İrsaliye'nin resmî görünümünü entegratör basar."
      />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <div className="belge-gorunum">
        <div className="belge-gorunum__ayarlar stack">
          <Card title="Renk ve yazı">
            <div className="belge-gorunum__paletler" role="group" aria-label="Hazır paletler">
              {PALETLER.map((p) => (
                <button type="button" key={p.ad} className={`belge-gorunum__palet${gorunum.anaRenk === p.ana ? " is-secili" : ""}`} onClick={() => degistir({ anaRenk: p.ana, ikincilRenk: p.ikincil })} title={p.ad}>
                  <span style={{ background: p.ana }} />{p.ad}
                </button>
              ))}
            </div>
            <div className="belge-gorunum__izgara">
              <Field label="Ana renk">
                <div className="row" style={{ gap: "0.4rem" }}>
                  <input type="color" aria-label="Ana renk seçici" value={HEX.test(gorunum.anaRenk) ? gorunum.anaRenk : "#0f766e"} onChange={(e) => degistir({ anaRenk: e.target.value })} />
                  <Input aria-label="Ana renk" value={gorunum.anaRenk} maxLength={7} onChange={(e) => degistir({ anaRenk: e.target.value })} />
                </div>
              </Field>
              <Field label="Metin rengi">
                <div className="row" style={{ gap: "0.4rem" }}>
                  <input type="color" aria-label="Metin rengi seçici" value={HEX.test(gorunum.ikincilRenk) ? gorunum.ikincilRenk : "#1f2937"} onChange={(e) => degistir({ ikincilRenk: e.target.value })} />
                  <Input aria-label="Metin rengi" value={gorunum.ikincilRenk} maxLength={7} onChange={(e) => degistir({ ikincilRenk: e.target.value })} />
                </div>
              </Field>
              <Field label="Yazı tipi">
                <Select value={gorunum.yaziTipi} onChange={(e) => degistir({ yaziTipi: e.target.value as Gorunum["yaziTipi"] })}>
                  <option value="dejavu">DejaVu Sans (varsayılan)</option>
                  <option value="noto-sans">Noto Sans</option>
                  <option value="noto-serif">Noto Serif</option>
                  <option value="liberation">Liberation Sans (Arial benzeri)</option>
                </Select>
              </Field>
              <Field label="Yazı boyutu">
                <Select value={gorunum.yaziBoyutu} onChange={(e) => degistir({ yaziBoyutu: e.target.value as Gorunum["yaziBoyutu"] })}>
                  <option value="kucuk">Küçük</option><option value="normal">Normal</option><option value="buyuk">Büyük</option>
                </Select>
              </Field>
            </div>
            {zayifKontrast && <Alert tone="warning">Ana renk çok açık: başlıklar beyaz kâğıtta zor okunur. Daha koyu bir ton seçin.</Alert>}
          </Card>

          <Card title="Düzen">
            <div className="belge-gorunum__izgara">
              <Field label="Logo yeri">
                <Select value={gorunum.logoYeri} onChange={(e) => degistir({ logoYeri: e.target.value as Gorunum["logoYeri"] })}>
                  <option value="sol">Solda, firma bilgisinin üstünde</option><option value="orta">Ortada, sayfanın başında</option>
                </Select>
              </Field>
              <Field label="Logo boyutu">
                <Select value={gorunum.logoBoyutu} onChange={(e) => degistir({ logoBoyutu: e.target.value as Gorunum["logoBoyutu"] })}>
                  <option value="kucuk">Küçük</option><option value="orta">Orta</option><option value="buyuk">Büyük</option>
                </Select>
              </Field>
              <Field label="Tablo başlığı">
                <Select value={gorunum.tabloBaslik} onChange={(e) => degistir({ tabloBaslik: e.target.value as Gorunum["tabloBaslik"] })}>
                  <option value="dolu">Dolu renk</option><option value="cizgi">Renkli çizgi</option><option value="sade">Sade</option>
                </Select>
              </Field>
              <Field label="Köşeler">
                <Select value={gorunum.kose} onChange={(e) => degistir({ kose: e.target.value as Gorunum["kose"] })}>
                  <option value="yuvarlak">Yuvarlak</option><option value="keskin">Keskin</option>
                </Select>
              </Field>
            </div>
            <label className="check-row"><input type="checkbox" checked={gorunum.zebra} onChange={(e) => degistir({ zebra: e.target.checked })} /> Satırlar zebra desenli</label>
            <label className="check-row"><input type="checkbox" checked={gorunum.taslakFiligrani} onChange={(e) => degistir({ taslakFiligrani: e.target.checked })} /> Taslak belgede "TASLAK" filigranı</label>
            <small className="muted">"KOPYA" damgası belge basılırken seçilir (PDF bağlantısına <code>?kopya=1</code>).</small>
          </Card>

          <Card title="Belge türüne göre">
            <div className="belge-gorunum__turler" role="tablist" aria-label="Belge türü">
              {TURLER.map(([deger, ad]) => (
                <button key={deger} type="button" role="tab" aria-selected={tur === deger} className={`vade-cipi${tur === deger ? " is-active" : ""}`} onClick={() => setTur(deger)}>{ad}</button>
              ))}
            </div>
            <strong className="belge-gorunum__altbaslik">Basılacak bölümler</strong>
            {BOLUM_ADLARI.map(([alan, ad]) => (
              <label key={alan} className="check-row">
                <input type="checkbox" checked={bolum[alan]} onChange={(e) => bolumDegistir(alan, e.target.checked)} disabled={alan === "kase" && !kase} /> {ad}
                {alan === "kase" && !kase && <small className="muted"> — önce aşağıdan görsel yükleyin</small>}
              </label>
            ))}
            <small className="muted">İskonto sütunu belgede iskonto yoksa kendiliğinden gizlenir.</small>

            <div className="row" style={{ alignItems: "end", gap: "0.6rem", marginTop: "0.6rem" }}>
              <strong className="belge-gorunum__altbaslik" style={{ flex: 1 }}>Hazır metinler</strong>
              <Field label="Metin dili">
                <Select aria-label="Metin dili" value={metinDili} onChange={(e) => setMetinDili(e.target.value as BelgeDili)}>
                  {BELGE_DILLERI.map((d) => <option key={d} value={d}>{BELGE_DILI_ADLARI[d]}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Kapanış cümlesi">
              <small className="muted">Boş bırakılırsa hazır cümle basılır.</small>
              <textarea className="textarea" dir={metinDili === "ar" ? "rtl" : undefined} rows={2} maxLength={600} value={metin.kapanis ?? ""} onChange={(e) => metinDegistir("kapanis", e.target.value)} />
            </Field>
            <Field label="Varsayılan koşullar">
              <small className="muted">Her satır ayrı madde olarak basılır.</small>
              <textarea className="textarea" dir={metinDili === "ar" ? "rtl" : undefined} rows={3} maxLength={2000} value={metin.kosullar ?? ""} onChange={(e) => metinDegistir("kosullar", e.target.value)} />
            </Field>
            <Field label="Sayfa altı notu">
              <small className="muted">Ör. KEP adresi, ticaret sicil bilgisi.</small>
              <Input dir={metinDili === "ar" ? "rtl" : undefined} maxLength={300} value={metin.altNot ?? ""} onChange={(e) => metinDegistir("altNot", e.target.value)} />
            </Field>
            <Field label="İmza alanı adları">
              <small className="muted">Her satır bir imza alanı; boşsa türün hazır alanları.</small>
              <textarea className="textarea" dir={metinDili === "ar" ? "rtl" : undefined} rows={2} maxLength={300} value={metin.imzalar ?? ""} onChange={(e) => metinDegistir("imzalar", e.target.value)} />
            </Field>
          </Card>

          <Card title="Kaşe / imza görseli">
            <p className="muted" style={{ margin: 0 }}>Şeffaf zeminli PNG önerilir. İmza alanının üstüne basılır; hangi belgelerde basılacağını "Belge türüne göre" bölümünden seçin.</p>
            <div className="row" style={{ gap: "0.6rem", alignItems: "center" }}>
              {kase ? <span>📎 {kase.dosyaAdi}</span> : <span className="muted">Yüklenmiş görsel yok</span>}
              <label className="btn btn--ghost btn--sm" style={{ cursor: "pointer" }}>
                {kase ? "Değiştir" : "Görsel yükle"}
                <input type="file" accept="image/png,image/jpeg" hidden onChange={kaseYukle} disabled={islemde} />
              </label>
              {kase && <Button size="sm" variant="ghost" onClick={kaseSil} disabled={islemde}>Sil</Button>}
            </div>
          </Card>

          <div className="row belge-gorunum__eylemler">
            <Button variant="ghost" onClick={varsayilanaDon} disabled={islemde}>Varsayılana dön</Button>
            <Button variant="primary" onClick={kaydet} disabled={islemde || !degisti}>{islemde ? "Kaydediliyor…" : "Kaydet"}</Button>
          </div>
        </div>

        <div className="belge-gorunum__onizleme">
          <div className="row" style={{ gap: "0.5rem", alignItems: "end", flexWrap: "wrap" }}>
            <Field label="Önizleme">
              <Select aria-label="Önizlenen belge" value={tur} onChange={(e) => setTur(e.target.value as Tur)}>
                {TURLER.map(([deger, ad]) => <option key={deger} value={deger}>{ad}</option>)}
              </Select>
            </Field>
            <Field label="Dil">
              <Select aria-label="Önizleme dili" value={dil} onChange={(e) => setDil(e.target.value as BelgeDili)}>
                {BELGE_DILLERI.map((d) => <option key={d} value={d}>{BELGE_DILI_ADLARI[d]}</option>)}
              </Select>
            </Field>
            <label className="check-row" style={{ marginBottom: "0.5rem" }}>
              <input type="checkbox" checked={ciftDilGecerli(dil, ciftDil)} disabled={dil === "tr"} onChange={(e) => setCiftDil(e.target.checked)} /> Çift dil
            </label>
            {onizleme && <a className="muted" href={onizleme} target="_blank" rel="noreferrer" style={{ marginBottom: "0.5rem" }}>Yeni sekmede aç ↗</a>}
          </div>
          <div className={`belge-gorunum__cerceve${onizlemeYukleniyor ? " is-yukleniyor" : ""}`}>
            {onizleme ? <iframe title="Belge önizlemesi" src={`${onizleme}#toolbar=0&view=FitH`} /> : <p className="muted">Önizleme hazırlanıyor…</p>}
          </div>
          {degisti && <small className="muted">Önizleme kaydedilmemiş seçimleri gösteriyor.</small>}
        </div>
      </div>
    </div>
  );
}
