"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Select,
  TableWrap,
} from "@/components/ui";

interface StokKart {
  id: string;
  kod: string;
  ad: string;
  tip: string;
  barkod: string | null;
  anaBirim: string;
  kdvOrani: string;
  alisFiyati: string | null;
  satisFiyati: string | null;
  alisFiyatiDoviz: string;
  satisFiyatiDoviz: string;
  mevcutMiktar: string;
  ortalamaMaliyet: string;
}

interface ExcelOnizleme {
  toplam: number; eklenecek: number; guncellenecek: number; kirpildi: boolean;
  satirlar: Array<{ kod: string; ad: string; tip: string; barkod: string | null; kdvOrani: number; alisFiyati: number | null; satisFiyati: number | null; islem: "ekle" | "guncelle" }>;
}

const tl = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";

const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export default function StokSayfasi() {
  const [stoklar, setStoklar] = useState<StokKart[]>([]);
  const [arama, setArama] = useState("");
  const [aramaSorgusu, setAramaSorgusu] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [formAcik, setFormAcik] = useState(false);
  const [sonrakiStokImleci, setSonrakiStokImleci] = useState<string | null>(null);
  const [stokListesiYukleniyor, setStokListesiYukleniyor] = useState(false);
  const stokYuklemeSirasi = useRef(0);
  const [excelDosyasi, setExcelDosyasi] = useState<File | null>(null);
  const [excelOnizleme, setExcelOnizleme] = useState<ExcelOnizleme | null>(null);
  const [excelYukleniyor, setExcelYukleniyor] = useState(false);

  // Form alanları
  const [kod, setKod] = useState("");
  const [ad, setAd] = useState("");
  const [tip, setTip] = useState("urun");
  const [barkod, setBarkod] = useState("");
  const [kdvOrani, setKdvOrani] = useState("20");
  const [alisFiyati, setAlisFiyati] = useState("");
  const [satisFiyati, setSatisFiyati] = useState("");
  const [alisFiyatiDoviz, setAlisFiyatiDoviz] = useState("TRY");
  const [satisFiyatiDoviz, setSatisFiyatiDoviz] = useState("TRY");

  const yukle = useCallback(async (imlec?: string) => {
    const istekSirasi = ++stokYuklemeSirasi.current;
    setStokListesiYukleniyor(true);
    try {
      const parametreler = new URLSearchParams();
      if (aramaSorgusu) parametreler.set("arama", aramaSorgusu);
      if (imlec) parametreler.set("imlec", imlec);
      const qs = parametreler.size ? `?${parametreler.toString()}` : "";
      const veri = await api<{ kayitlar: StokKart[]; sonrakiImlec: string | null }>(`/stok${qs}`);
      if (istekSirasi !== stokYuklemeSirasi.current) return;
      setStoklar((eskiler) => imlec ? [...eskiler, ...veri.kayitlar] : veri.kayitlar);
      setSonrakiStokImleci(veri.sonrakiImlec);
    } catch (h) {
      if (istekSirasi === stokYuklemeSirasi.current) setHata(h instanceof Error ? h.message : "Yükleme hatası");
    } finally {
      if (istekSirasi === stokYuklemeSirasi.current) setStokListesiYukleniyor(false);
    }
  }, [aramaSorgusu]);

  useEffect(() => {
    const zamanlayici = window.setTimeout(() => setAramaSorgusu(arama.trim()), 300);
    return () => window.clearTimeout(zamanlayici);
  }, [arama]);

  useEffect(() => {
    if (tokenAl()) {
      void yukle();
    }
  }, [yukle]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    try {
      await api("/stok", {
        method: "POST",
        body: JSON.stringify({
          kod,
          ad,
          tip,
          barkod: barkod || null,
          kdvOrani: kdvOrani || "20",
          alisFiyati: alisFiyati || null,
          satisFiyati: satisFiyati || null,
          alisFiyatiDoviz,
          satisFiyatiDoviz,
        }),
      });
      setBasari("Stok kartı başarıyla oluşturuldu.");
      setFormAcik(false);
      setKod("");
      setAd("");
      setBarkod("");
      setKdvOrani("20");
      setAlisFiyati("");
      setSatisFiyati("");
      setAlisFiyatiDoviz("TRY"); setSatisFiyatiDoviz("TRY");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kayıt hatası");
    }
  }

  async function excelYukle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setHata(""); setBasari(""); setExcelYukleniyor(true);
    try {
      const formData = new FormData(); formData.append("file", file);
      const res = await fetch(`${apiBase()}/stok/excel-onizle`, { method: "POST", headers: { Authorization: `Bearer ${tokenAl()}` }, body: formData });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || "Excel yükleme hatası"); }
      setExcelDosyasi(file); setExcelOnizleme(await res.json());
    } catch (h) { setHata(h instanceof Error ? h.message : "Excel yükleme hatası"); }
    finally { setExcelYukleniyor(false); }
  }

  async function excelAktar() {
    if (!excelDosyasi) return; setExcelYukleniyor(true); setHata("");
    try {
      const formData = new FormData(); formData.append("file", excelDosyasi);
      const res = await fetch(`${apiBase()}/stok/excel-aktar`, { method: "POST", headers: { Authorization: `Bearer ${tokenAl()}` }, body: formData });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || "Excel aktarma hatası"); }
      const sonuc = await res.json(); setBasari(`${sonuc.eklenen} ürün başarıyla eklendi/güncellendi.`); setExcelDosyasi(null); setExcelOnizleme(null); void yukle();
    } catch (h) { setHata(h instanceof Error ? h.message : "Excel aktarma hatası"); } finally { setExcelYukleniyor(false); }
  }

  async function excelSablonIndir() {
    setHata("");
    try {
      const res = await fetch(`${apiBase()}/stok/excel-sablon`, { headers: { Authorization: `Bearer ${tokenAl()}` } });
      if (!res.ok) throw new Error("Örnek şablon indirilemedi");
      const url = URL.createObjectURL(await res.blob()); const baglanti = document.createElement("a"); baglanti.href = url; baglanti.download = "stok-ice-aktarma-sablonu.xlsx"; baglanti.click(); URL.revokeObjectURL(url);
    } catch (h) { setHata(h instanceof Error ? h.message : "Şablon indirme hatası"); }
  }

  async function kopyala(id: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/stok/${id}/kopyala`, { method: "POST" });
      setBasari("Stok kartı başarıyla kopyalandı.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kopyalama hatası");
    }
  }

  return (
    <div>
      <PageHeader
        title="Stok Kartları"
        subtitle="Ürünlerinizi, hizmetlerinizi, envanter miktarlarını ve maliyetlerini takip edin."
        actions={
          <>
            <ButtonLabel as="a" href="/panel/stok/smm">₺ SMM & Karlılık</ButtonLabel>
            <ButtonLabel as="a" href="/panel/stok/raporlar">📈 Raporlar</ButtonLabel>
            <Button onClick={() => void excelSablonIndir()}>📄 Örnek Şablon</Button>
            <ButtonLabel>
              {excelYukleniyor ? "İşleniyor..." : "📥 Excel’den İçe Aktar"}
              <input aria-label="Stok Excel dosyası" type="file" accept=".xlsx" onChange={excelYukle} disabled={excelYukleniyor} style={{ display: "none" }} />
            </ButtonLabel>
            <Button variant="primary" onClick={() => setFormAcik(!formAcik)}>
              {formAcik ? "Vazgeç" : "➕ Yeni Ürün/Hizmet"}
            </Button>
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {excelOnizleme && (
        <Card>
          <div className="document-editor__head">
            <div><h3>Excel önizleme</h3><p>{excelDosyasi?.name} · {excelOnizleme.toplam} satır</p></div>
            <div><Badge variant="success">{excelOnizleme.eklenecek} yeni</Badge> <Badge variant="warning">{excelOnizleme.guncellenecek} güncelleme</Badge></div>
          </div>
          <TableWrap>
            <thead><tr><th>İşlem</th><th>Kod</th><th>Ad</th><th>Tip</th><th>KDV</th><th className="num">Alış</th><th className="num">Satış</th></tr></thead>
            <tbody>{excelOnizleme.satirlar.map((satir, index) => (
              <tr key={`${satir.kod}-${index}`}><td><Badge variant={satir.islem === "ekle" ? "success" : "warning"}>{satir.islem === "ekle" ? "Yeni" : "Güncelle"}</Badge></td><td className="mono">{satir.kod}</td><td>{satir.ad}</td><td>{satir.tip}</td><td>%{satir.kdvOrani}</td><td className="num">{satir.alisFiyati == null ? "—" : tl(satir.alisFiyati)}</td><td className="num">{satir.satisFiyati == null ? "—" : tl(satir.satisFiyati)}</td></tr>
            ))}</tbody>
          </TableWrap>
          {excelOnizleme.kirpildi && <p className="muted">İlk 20 satır gösteriliyor.</p>}
          <div className="document-editor__actions"><Button onClick={() => { setExcelDosyasi(null); setExcelOnizleme(null); }}>Vazgeç</Button><Button variant="primary" disabled={excelYukleniyor} onClick={() => void excelAktar()}>{excelYukleniyor ? "Aktarılıyor..." : `${excelOnizleme.toplam} ürünü içe aktar`}</Button></div>
        </Card>
      )}

      {formAcik && (
        <form className="document-editor record-editor--compact" onSubmit={kaydet}>
          <div className="document-editor__head">
            <h3>Yeni ürün veya hizmet</h3>
            <span className="badge badge--warning">Yeni</span>
          </div>

          <div className="document-editor__section">
            <h4 className="document-editor__section-title">Temel bilgiler</h4>
            <div className="record-fields record-fields--stock-main">
              <Field label="Ürün/Hizmet adı"><Input value={ad} onChange={(e) => setAd(e.target.value)} required placeholder="Örn. Taşınabilir monitör" /></Field>
              <Field label="Stok kodu"><Input value={kod} onChange={(e) => setKod(e.target.value)} required placeholder="STK-001" /></Field>
              <Field label="Tür"><Select value={tip} onChange={(e) => setTip(e.target.value)}><option value="urun">Ürün</option><option value="hizmet">Hizmet</option></Select></Field>
              <Field label="Barkod"><Input value={barkod} onChange={(e) => setBarkod(e.target.value)} placeholder="8690..." /></Field>
            </div>
          </div>

          <div className="document-editor__section">
            <h4 className="document-editor__section-title">Fiyat ve vergi</h4>
            <div className="record-fields record-fields--stock-price">
              <Field label="Alış fiyatı"><div className="row"><Input className="record-number" type="number" min="0" step="0.0001" inputMode="decimal" value={alisFiyati} onChange={(e) => setAlisFiyati(e.target.value)} placeholder="0,00" /><Select aria-label="Alış fiyatı dövizi" value={alisFiyatiDoviz} onChange={(e) => setAlisFiyatiDoviz(e.target.value)}><option>TRY</option><option>USD</option><option>EUR</option></Select></div></Field>
              <Field label="Satış fiyatı"><div className="row"><Input className="record-number" type="number" min="0" step="0.0001" inputMode="decimal" value={satisFiyati} onChange={(e) => setSatisFiyati(e.target.value)} placeholder="0,00" /><Select aria-label="Satış fiyatı dövizi" value={satisFiyatiDoviz} onChange={(e) => setSatisFiyatiDoviz(e.target.value)}><option>TRY</option><option>USD</option><option>EUR</option></Select></div></Field>
              <Field label="KDV (%)"><Input className="record-number" type="number" min="0" max="100" inputMode="decimal" value={kdvOrani} onChange={(e) => setKdvOrani(e.target.value)} required /></Field>
            </div>
          </div>

          <div className="document-editor__actions"><Button variant="primary" type="submit">Stok kartını kaydet</Button></div>
        </form>
      )}

      <div className="toolbar">
        <SearchInput
          className="grow"
          value={arama}
          onChange={(e) => setArama(e.target.value)}
          placeholder="Stok adına, koduna, barkoduna veya tedarikçi koduna göre ara..."
        />
      </div>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Kod</th>
              <th>Ürün/Hizmet Adı</th>
              <th>Tip</th>
              <th>KDV</th>
              <th className="num">Mevcut Stok</th>
              <th className="num">Ort. Maliyet</th>
              <th className="num">Alış Fiyatı</th>
              <th className="num">Satış Fiyatı</th>
              <th className="center">Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {stoklar.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty">Arama kriterlerinize uygun stok kartı bulunamadı.</td>
              </tr>
            ) : (
              stoklar.map((s) => {
                const miktar = Number(s.mevcutMiktar);
                const maliyet = Number(s.ortalamaMaliyet);
                return (
                  <tr key={s.id}>
                    <td className="mono">{s.kod}</td>
                    <td>
                      <div className="cell-entity__name">{s.ad}</div>
                      {s.barkod && <div className="cell-entity__meta">Barkod: {s.barkod}</div>}
                    </td>
                    <td>
                      <Badge variant={s.tip === "urun" ? "info" : "neutral"}>
                        {s.tip === "urun" ? "📦 Ürün" : "🛠️ Hizmet"}
                      </Badge>
                    </td>
                    <td>%{Number(s.kdvOrani).toFixed(0)}</td>
                    <td className="num" style={{ fontWeight: 700, color: miktar > 0 ? "var(--text)" : "var(--text-subtle)" }}>
                      {miktar.toLocaleString("tr-TR", { minimumFractionDigits: 0 })} {s.anaBirim}
                    </td>
                    <td className="num" style={{ color: "var(--info)" }}>{maliyet > 0 ? tl(maliyet) : "—"}</td>
                    <td className="num">{s.alisFiyati ? `${Number(s.alisFiyati).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${s.alisFiyatiDoviz}` : "—"}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{s.satisFiyati ? `${Number(s.satisFiyati).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${s.satisFiyatiDoviz}` : "—"}</td>
                    <td className="center">
                      <div className="row-tight" style={{ justifyContent: "center" }}>
                        <ButtonLabel as="a" size="sm" href={`/panel/stok/${s.id}`}>🔍 Detay</ButtonLabel>
                        <Button size="sm" onClick={() => kopyala(s.id)}>📋 Kopyala</Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
        {sonrakiStokImleci && (
          <div style={{ padding: "1rem", textAlign: "center" }}>
            <Button type="button" onClick={() => void yukle(sonrakiStokImleci)} disabled={stokListesiYukleniyor}>
              {stokListesiYukleniyor ? "Stoklar yükleniyor…" : "Daha fazla stok yükle"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
