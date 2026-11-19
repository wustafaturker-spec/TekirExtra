"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Stat, StatGrid, TableWrap } from "@/components/ui";

type Adim = "cari" | "stok" | "acilis_stok" | "kasa_banka" | "acik_fatura";
type Sekme = Adim | "ozet";
type Durum = "yeni" | "guncelle" | "degisiklik_yok" | "hatali";
interface Alan { anahtar: string; baslik: string; aciklama: string }
interface Parti { id: string; adim: Adim; adimAdi: string; dosyaAdi: string; ozet: { toplam: number; yeni: number; guncelle: number; hatali: number }; createdAt: string; geriAlindiAt: string | null }
interface DurumYaniti { gecisTarihi: string | null; adimlar: { adim: Adim; ad: string; alanlar: Alan[] }[]; partiler: Parti[] }
interface Onizleme {
  ozet: { toplam: number; yeni: number; guncelle: number; degisiklikYok: number; hatali: number };
  basliklar: { baslik: string; anahtar: string | null; elle: boolean }[];
  taninmayanlar: string[];
  satirlar: { satir: number; durum: Durum; etiket: string; aciklama: string; hatalar: string[]; uyarilar: string[] }[];
  kirpildi: boolean;
}
interface AiOneri {
  baslik: string;
  anahtar: string | null;
  alanBaslik: string | null;
  guven: number;
  gerekce: string;
}
interface Ozet {
  tarih: string | null;
  cari: { kartSayisi: number; dovizler: { dovizCinsi: string; borc: string; alacak: string; bakiye: string }[] };
  stok: { kalemSayisi: number; deger: string; not: string };
  kasaBanka: { ad: string; dovizCinsi: string; bakiye: string }[];
}

const DURUM: Record<Durum, { ad: string; ton: "success" | "info" | "neutral" | "danger" }> = {
  yeni: { ad: "Yeni", ton: "success" },
  guncelle: { ad: "Güncellenecek", ton: "info" },
  degisiklik_yok: { ad: "Değişiklik yok", ton: "neutral" },
  hatali: { ad: "Hatalı", ton: "danger" },
};
const SIRA: Record<Durum, number> = { hatali: 0, yeni: 1, guncelle: 2, degisiklik_yok: 3 };
const ACIKLAMA: Record<Adim, string> = {
  cari: "Müşteri ve tedarikçi kartları. Satır koda, kod boşsa VKN/TCKN'ye göre eşleşir; eşleşen kartta yalnız dolu hücreler yazılır. Cari başına toplam açılış bakiyesi de girilebilir (o caride açık faturalar ayrıca girilmez).",
  stok: "Ürün ve hizmet kartları. Mevcut kod güncellenir; hareketi olan kartın birimi değişmez.",
  acilis_stok: "Geçiş tarihindeki eldeki miktar ve birim maliyet. Ortalama maliyet bununla başlar. Kartlar önce Stok kartları adımında açılmış olmalı.",
  kasa_banka: "Kasa ve banka hesaplarının geçiş tarihindeki bakiyesi. Hesaplar önce Kasa & Banka ekranında açılmış olmalı.",
  acik_fatura: "Geçiş tarihinde ödenmemiş satış ve alış faturaları, belge belge. Fatura oluşmaz; cari bakiyesine, yaşlandırmaya, vade hatırlatmasına ve vadesi geçenler raporuna girer.",
};
const tarihSaat = (s: string) => new Date(s).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
const para = (s: string, d: string) => `${Number(s).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${d === "TRY" ? "₺" : d}`;
const hataMetni = (e: unknown, varsayilan: string) => (e instanceof Error ? e.message : varsayilan);

function form(dosya: File, eslemeler: Record<string, string>) {
  const f = new FormData();
  f.append("file", dosya);
  if (Object.keys(eslemeler).length) f.append("eslemeler", JSON.stringify(eslemeler));
  return f;
}

/**
 * VAK-01…09: başka programdan geçiş. Adımlar sırayla ya da atlanarak uygulanır; her
 * uygulama bir partidir, yönetici geri alabilir. Önizleme hiçbir şey yazmaz.
 */
export default function VeriAktarimiSayfasi() {
  const [durum, setDurum] = useState<DurumYaniti | null>(null);
  const [rol, setRol] = useState("");
  const [sekme, setSekme] = useState<Sekme>("cari");
  const [gecis, setGecis] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islemde, setIslemde] = useState("");

  const yukle = useCallback(async () => {
    try {
      const d = await api<DurumYaniti>("/veri-aktarimi");
      setDurum(d);
      setGecis((g) => g || d.gecisTarihi || "");
    } catch (e) { setHata(hataMetni(e, "Aktarım bilgileri alınamadı")); }
  }, []);
  useEffect(() => {
    void yukle();
    void api<{ rol: string }>("/auth/ben").then((b) => setRol(b.rol)).catch(() => undefined);
  }, [yukle]);

  async function gecisKaydet() {
    if (!gecis) return;
    setIslemde("gecis"); setHata(""); setBasari("");
    try { await api("/veri-aktarimi/gecis-tarihi", { method: "PUT", body: JSON.stringify({ tarih: gecis }) }); setBasari("Geçiş tarihi kaydedildi."); await yukle(); }
    catch (e) { setHata(hataMetni(e, "Geçiş tarihi kaydedilemedi")); }
    finally { setIslemde(""); }
  }

  async function geriAl(p: Parti) {
    if (!window.confirm(`"${p.dosyaAdi}" aktarımı (${p.adimAdi}) geri alınacak. Oluşturulan kartlar ve açılış kayıtları kaldırılır; güncellenen kartlar eski haline dönmez. Devam edilsin mi?`)) return;
    setIslemde(p.id); setHata(""); setBasari("");
    try {
      const r = await api<{ pasifeAlinanStok: number }>(`/veri-aktarimi/partiler/${p.id}/geri-al`, { method: "POST" });
      setBasari(`Aktarım geri alındı.${r.pasifeAlinanStok ? ` ${r.pasifeAlinanStok} stok kartında geri alınmış açılış hareketi kaldığı için kart silinmedi, pasife alındı.` : ""}`);
      await yukle();
    } catch (e) { setHata(hataMetni(e, "Aktarım geri alınamadı")); }
    finally { setIslemde(""); }
  }

  const uygulanan = useMemo(() => new Set((durum?.partiler ?? []).filter((p) => !p.geriAlindiAt).map((p) => p.adim)), [durum]);
  const adimlar = durum?.adimlar ?? [];
  const aktifAdim = adimlar.find((a) => a.adim === sekme);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <PageHeader title="Veri Aktarımı" subtitle="Başka bir programdan geçerken kartları, açılış bakiyelerini ve açık faturaları Excel'den adım adım alın. Logo, Mikro, Netsis ve Paraşüt dışa aktarımlarının başlıkları tanınır." />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <div className="stack">
        <Card title="1. Geçiş tarihi">
          <p className="subtle" style={{ marginTop: 0 }}>Eski programdaki son günün tarihi. Açılış kayıtlarında tarih boşsa bu tarih kullanılır; açık faturalar bu tarihe yazılır. Bu tarihten sonraki işlemleri TekirExtra'da girin.</p>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label="Geçiş tarihi"><Input type="date" value={gecis} onChange={(e) => setGecis(e.target.value)} /></Field>
            <Button variant="primary" disabled={!gecis || gecis === durum?.gecisTarihi || islemde === "gecis"} onClick={() => void gecisKaydet()}>{islemde === "gecis" ? "Kaydediliyor…" : "Kaydet"}</Button>
          </div>
          {durum && !durum.gecisTarihi && <p className="subtle">Geçiş tarihi seçilmedi; açık faturalar adımı bunu ister.</p>}
        </Card>

        <div className="row" role="tablist" aria-label="Aktarım adımları" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          {adimlar.map((a, i) => (
            <Button key={a.adim} role="tab" aria-selected={sekme === a.adim} variant={sekme === a.adim ? "primary" : undefined} onClick={() => setSekme(a.adim)}>
              {i + 2}. {a.ad}{uygulanan.has(a.adim) ? " ✓" : ""}
            </Button>
          ))}
          <Button role="tab" aria-selected={sekme === "ozet"} variant={sekme === "ozet" ? "primary" : undefined} onClick={() => setSekme("ozet")}>{adimlar.length + 2}. Kontrol özeti</Button>
        </div>

        {aktifAdim && <AdimPaneli key={aktifAdim.adim} adim={aktifAdim.adim} ad={aktifAdim.ad} alanlar={aktifAdim.alanlar} onUygulandi={(m) => { setBasari(m); setHata(""); void yukle(); }} />}
        {sekme === "ozet" && <KontrolOzeti />}

        <Card title="Aktarım geçmişi" pad={false}>
          <TableWrap>
            <thead><tr><th>Zaman</th><th>Adım</th><th>Dosya</th><th className="num">Yeni</th><th className="num">Güncellenen</th><th className="num">Atlanan (hatalı)</th><th>Durum</th></tr></thead>
            <tbody>
              {(durum?.partiler ?? []).map((p) => (
                <tr key={p.id}>
                  <td className="subtle">{tarihSaat(p.createdAt)}</td>
                  <td>{p.adimAdi}</td>
                  <td>{p.dosyaAdi}</td>
                  <td className="num">{p.ozet.yeni}</td>
                  <td className="num">{p.ozet.guncelle}</td>
                  <td className="num">{p.ozet.hatali}</td>
                  <td>{p.geriAlindiAt
                    ? <Badge variant="neutral">Geri alındı {tarihSaat(p.geriAlindiAt)}</Badge>
                    : rol === "yonetici"
                      ? <Button size="sm" disabled={Boolean(islemde)} onClick={() => void geriAl(p)}>{islemde === p.id ? "Geri alınıyor…" : "Geri al"}</Button>
                      : <Badge variant="success">Uygulandı</Badge>}</td>
                </tr>
              ))}
              {durum && !durum.partiler.length && <tr><td colSpan={7} className="empty">Henüz aktarım yapılmadı.</td></tr>}
            </tbody>
          </TableWrap>
          {rol && rol !== "yonetici" && <p className="subtle" style={{ padding: "0 1.25rem 1rem", margin: 0 }}>Aktarımı yalnız yönetici geri alabilir.</p>}
        </Card>
      </div>
    </div>
  );
}

function AdimPaneli({ adim, ad, alanlar, onUygulandi }: { adim: Adim; ad: string; alanlar: Alan[]; onUygulandi: (mesaj: string) => void }) {
  const [dosya, setDosya] = useState<File | null>(null);
  const [eslemeler, setEslemeler] = useState<Record<string, string>>({});
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null);
  const [aiOnerileri, setAiOnerileri] = useState<AiOneri[]>([]);
  const [aiYukleniyor, setAiYukleniyor] = useState(false);
  const [yalnizSorunlu, setYalnizSorunlu] = useState(false);
  const [hata, setHata] = useState("");
  const [islemde, setIslemde] = useState(false);

  async function onizle(d: File, e: Record<string, string>) {
    setHata(""); setIslemde(true);
    try {
      const o = await api<Onizleme>(`/veri-aktarimi/${adim}/onizle`, { method: "POST", body: form(d, e) });
      setOnizleme(o); setYalnizSorunlu(o.ozet.hatali > 0);
    } catch (err) { setOnizleme(null); setHata(hataMetni(err, "Dosya okunamadı")); }
    finally { setIslemde(false); }
  }

  function sec(e: React.ChangeEvent<HTMLInputElement>) {
    const secilen = e.target.files?.[0];
    e.target.value = "";
    if (!secilen) return;
    setDosya(secilen); setEslemeler({}); setOnizleme(null); setAiOnerileri([]);
    void onizle(secilen, {});
  }

  function esle(baslik: string, anahtar: string) {
    const yeni = { ...eslemeler, [baslik]: anahtar };
    setEslemeler(yeni);
    if (dosya) void onizle(dosya, yeni);
  }

  async function aiOnerileriGetir() {
    if (!dosya) return;
    setHata(""); setAiYukleniyor(true);
    try {
      const r = await api<{ oneriler: AiOneri[]; taninmayanSayisi: number; onerilenSayisi: number }>(
        `/veri-aktarimi/${adim}/ai-kolon-onerisi`,
        { method: "POST", body: form(dosya, eslemeler) }
      );
      setAiOnerileri(r.oneriler);
    } catch (err) {
      setHata(hataMetni(err, "Yapay zekâ önerileri alınamadı"));
    } finally {
      setAiYukleniyor(false);
    }
  }

  function tumAiOnerileriniUygula() {
    if (!dosya || !aiOnerileri.length) return;
    const yeni = { ...eslemeler };
    for (const o of aiOnerileri) {
      if (o.anahtar) {
        yeni[o.baslik] = o.anahtar;
      }
    }
    setEslemeler(yeni);
    void onizle(dosya, yeni);
  }

  async function uygula() {
    if (!dosya || !onizleme) return;
    const yazilacak = onizleme.ozet.yeni + onizleme.ozet.guncelle;
    if (!window.confirm(`${yazilacak} satır yazılacak${onizleme.ozet.hatali ? `, ${onizleme.ozet.hatali} hatalı satır atlanacak` : ""}. Devam edilsin mi?`)) return;
    setHata(""); setIslemde(true);
    try {
      const r = await api<{ ozet: Onizleme["ozet"] }>(`/veri-aktarimi/${adim}/uygula`, { method: "POST", body: form(dosya, eslemeler) });
      onUygulandi(`${ad}: ${r.ozet.yeni} yeni${r.ozet.guncelle ? `, ${r.ozet.guncelle} güncellenen` : ""} kayıt yazıldı${r.ozet.hatali ? `; ${r.ozet.hatali} hatalı satır atlandı` : ""}.`);
      setDosya(null); setOnizleme(null); setEslemeler({});
    } catch (err) { setHata(hataMetni(err, "Aktarım uygulanamadı")); }
    finally { setIslemde(false); }
  }

  // Elle eşlenebilir alanlar: dosyada henüz kullanılmayanlar (bir alana tek sütun).
  const kullanilan = new Set((onizleme?.basliklar ?? []).map((b) => b.anahtar).filter(Boolean));
  const elleBasliklar = (onizleme?.basliklar ?? []).filter((b) => b.elle || onizleme?.taninmayanlar.includes(b.baslik));
  const satirlar = (onizleme?.satirlar ?? [])
    .filter((s) => !yalnizSorunlu || s.durum === "hatali" || s.uyarilar.length > 0)
    .sort((a, b) => SIRA[a.durum] - SIRA[b.durum] || a.satir - b.satir);
  const yazilacak = onizleme ? onizleme.ozet.yeni + onizleme.ozet.guncelle : 0;

  return (
    <Card title={ad}>
      <p className="subtle" style={{ marginTop: 0 }}>{ACIKLAMA[adim]}</p>
      <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <Button onClick={() => void apiDosyaIndir(`/veri-aktarimi/${adim}/sablon`, `${adim.replace("_", "-")}-sablonu.xlsx`).catch((e) => setHata(hataMetni(e, "Şablon indirilemedi")))}>Şablonu indir</Button>
        <label className="btn btn--primary">
          {dosya ? "Başka dosya seç" : "Excel dosyası seç (.xlsx)"}
          <input type="file" accept=".xlsx" onChange={sec} disabled={islemde} style={{ display: "none" }} />
        </label>
        {dosya && <span className="muted">{dosya.name}</span>}
      </div>
      {hata && <div style={{ marginTop: "0.75rem" }}><Alert tone="error">{hata}</Alert></div>}
      {islemde && !onizleme && <p className="subtle">Dosya denetleniyor…</p>}

      {onizleme && (
        <div className="stack" style={{ marginTop: "1rem" }}>
          {elleBasliklar.length > 0 && (
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "1rem" }}>
              <div className="row" style={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <strong>Tanınmayan sütunlar ({elleBasliklar.length})</strong>
                  <p className="subtle" style={{ margin: "0.25rem 0 0" }}>Bu başlıklar bir alanla eşleşmedi. Doğru alanı seçin ya da yapay zekâdan öneri isteyin.</p>
                </div>
                <div className="row" style={{ gap: "0.5rem" }}>
                  <Button size="sm" variant="primary" disabled={aiYukleniyor || islemde} onClick={() => void aiOnerileriGetir()}>
                    {aiYukleniyor ? "✨ Öneriler Hazırlanıyor…" : "✨ Yapay Zekâ ile Eşle"}
                  </Button>
                  {aiOnerileri.length > 0 && (
                    <Button size="sm" onClick={tumAiOnerileriniUygula} disabled={islemde}>
                      Tüm AI Önerilerini Uygula
                    </Button>
                  )}
                </div>
              </div>

              {aiOnerileri.length > 0 && (
                <div style={{ marginTop: "0.75rem", marginBottom: "0.5rem", padding: "0.5rem 0.75rem", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: "0.875rem", color: "#166534" }}>
                  ✨ Yapay zekâ <strong>{aiOnerileri.filter((o) => Boolean(o.anahtar)).length}</strong> sütun için eşleme önerdi. Önerilen alanları aşağıda inceleyip onaylayabilirsiniz.
                </div>
              )}

              <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem", marginTop: "0.75rem" }}>
                {elleBasliklar.map((b) => {
                  const oneri = aiOnerileri.find((o) => o.baslik === b.baslik);
                  return (
                    <div key={b.baslik} style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6, padding: "0.5rem 0.75rem", minWidth: 240, flex: "1 1 240px" }}>
                      <Field label={b.baslik}>
                        <Select value={eslemeler[b.baslik] ?? "__sec"} onChange={(e) => esle(b.baslik, e.target.value)} disabled={islemde}>
                          <option value="__sec" disabled>Seçin…</option>
                          <option value="">Yok say</option>
                          {alanlar.filter((a) => !kullanilan.has(a.anahtar) || eslemeler[b.baslik] === a.anahtar).map((a) => (
                            <option key={a.anahtar} value={a.anahtar}>{a.baslik}</option>
                          ))}
                        </Select>
                      </Field>
                      {oneri && oneri.anahtar && (
                        <div style={{ marginTop: "0.35rem", fontSize: "0.75rem", color: "#334155" }}>
                          <span style={{ fontWeight: 600, color: "#16a34a" }}>✨ Öneri: {oneri.alanBaslik}</span>
                          <span style={{ marginLeft: "0.35rem", color: "#64748b" }}>({oneri.guven}% güven)</span>
                          {oneri.gerekce && <div style={{ color: "#64748b", marginTop: 2 }}>{oneri.gerekce}</div>}
                          {eslemeler[b.baslik] !== oneri.anahtar && (
                            <button
                              type="button"
                              className="btn btn--sm"
                              style={{ marginTop: 4, padding: "0.15rem 0.4rem", fontSize: "0.75rem" }}
                              onClick={() => esle(b.baslik, oneri.anahtar!)}
                            >
                              Bu Öneriyi Seç
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <StatGrid>
            <Stat label="Yeni" value={onizleme.ozet.yeni} tone="success" />
            <Stat label="Güncellenecek" value={onizleme.ozet.guncelle} />
            <Stat label="Değişiklik yok" value={onizleme.ozet.degisiklikYok} />
            <Stat label="Hatalı (atlanır)" value={onizleme.ozet.hatali} tone={onizleme.ozet.hatali ? "danger" : "default"} />
          </StatGrid>
          <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
            <label className="check-row"><input type="checkbox" checked={yalnizSorunlu} onChange={(e) => setYalnizSorunlu(e.target.checked)} /> Yalnız hatalı ve uyarılı satırlar</label>
            {onizleme.ozet.hatali > 0 && dosya && (
              <Button size="sm" onClick={() => void apiDosyaIndir(`/veri-aktarimi/${adim}/hatali-satirlar`, `${adim.replace("_", "-")}-hatali-satirlar.xlsx`, { method: "POST", body: form(dosya, eslemeler) }).catch((e) => setHata(hataMetni(e, "İndirilemedi")))}>Hatalı satırları indir</Button>
            )}
          </div>
          <TableWrap>
            <thead><tr><th className="num">Satır</th><th>Durum</th><th>Kayıt</th><th>Açıklama</th><th>Ayrıntı</th></tr></thead>
            <tbody>
              {satirlar.map((s) => (
                <tr key={s.satir}>
                  <td className="num">{s.satir}</td>
                  <td><Badge variant={DURUM[s.durum].ton}>{DURUM[s.durum].ad}</Badge></td>
                  <td className="mono">{s.etiket || "—"}</td>
                  <td>{s.aciklama || "—"}</td>
                  <td>
                    {s.hatalar.map((h) => <div key={h} className="is-danger">{h}</div>)}
                    {s.uyarilar.map((u) => <div key={u} className="muted">⚠ {u}</div>)}
                  </td>
                </tr>
              ))}
              {satirlar.length === 0 && <tr><td colSpan={5} className="muted">Gösterilecek satır yok.</td></tr>}
            </tbody>
          </TableWrap>
          {onizleme.kirpildi && <p className="subtle">İlk 1.000 satır gösteriliyor; özet bütün dosyadandır.</p>}
          <div className="row" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
            <Button onClick={() => { setDosya(null); setOnizleme(null); setEslemeler({}); }}>Vazgeç</Button>
            <Button variant="primary" disabled={islemde || yazilacak === 0} onClick={() => void uygula()}>
              {islemde ? "Uygulanıyor…" : yazilacak ? `${yazilacak} satırı uygula` : "Yazılacak satır yok"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function KontrolOzeti() {
  const [o, setO] = useState<Ozet | null>(null);
  const [hata, setHata] = useState("");
  useEffect(() => { void api<Ozet>("/veri-aktarimi/kontrol-ozeti").then(setO).catch((e) => setHata(hataMetni(e, "Özet alınamadı"))); }, []);
  return (
    <Card title="Kontrol özeti" actions={<Button size="sm" onClick={() => void apiDosyaIndir("/veri-aktarimi/kontrol-ozeti/excel", "veri-aktarimi-kontrol-ozeti.xlsx").catch((e) => setHata(hataMetni(e, "İndirilemedi")))}>Excel indir</Button>}>
      <p className="subtle" style={{ marginTop: 0 }}>Toplamları eski programın geçiş tarihindeki mizanıyla karşılaştırın. Fark varsa ilgili adımın dosyasını düzeltip yeniden yükleyin ya da aktarımı geri alın.</p>
      {hata && <Alert tone="error">{hata}</Alert>}
      {!o && !hata && <p className="subtle">Özet hazırlanıyor…</p>}
      {o && (
        <div className="stack">
          <StatGrid>
            <Stat label="Geçiş tarihi" value={o.tarih ? new Date(o.tarih).toLocaleDateString("tr-TR") : "Seçilmedi"} />
            <Stat label="Cari kart" value={o.cari.kartSayisi} />
            <Stat label="Stoklu kalem" value={o.stok.kalemSayisi} />
            <Stat label="Stok değeri" value={para(o.stok.deger, "TRY")} />
          </StatGrid>
          <TableWrap>
            <thead><tr><th>Cari (döviz)</th><th className="num">Borç</th><th className="num">Alacak</th><th className="num">Bakiye</th></tr></thead>
            <tbody>
              {o.cari.dovizler.map((d) => <tr key={d.dovizCinsi}><td>{d.dovizCinsi}</td><td className="num">{para(d.borc, d.dovizCinsi)}</td><td className="num">{para(d.alacak, d.dovizCinsi)}</td><td className="num">{para(d.bakiye, d.dovizCinsi)}</td></tr>)}
              {!o.cari.dovizler.length && <tr><td colSpan={4} className="empty">Cari hareketi yok.</td></tr>}
            </tbody>
          </TableWrap>
          <TableWrap>
            <thead><tr><th>Kasa / banka hesabı</th><th className="num">Bakiye</th></tr></thead>
            <tbody>
              {o.kasaBanka.map((h) => <tr key={h.ad}><td>{h.ad}</td><td className="num">{para(h.bakiye, h.dovizCinsi)}</td></tr>)}
              {!o.kasaBanka.length && <tr><td colSpan={2} className="empty">Kasa/banka hareketi yok.</td></tr>}
            </tbody>
          </TableWrap>
          <p className="subtle" style={{ margin: 0 }}>{o.stok.not}.</p>
        </div>
      )}
    </Card>
  );
}
