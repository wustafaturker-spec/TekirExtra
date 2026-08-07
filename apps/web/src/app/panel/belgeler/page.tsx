"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { kullanimOlayi } from "@/lib/kullanim";
import { AramaSecici } from "@/components/arama-secici";
import { DepoSecici } from "@/components/depo-secici";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { faturaHesapla, type FaturaHesaplaSatirGirdi } from "@tekirextra/shared";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  TableWrap,
} from "@/components/ui";

const TUR_ADI: Record<string, string> = { teklif: "Teklif", siparis: "Sipariş", irsaliye: "İrsaliye" };
const YON_ADI: Record<string, string> = { satis: "Satış", alis: "Alış" };
// Zincir: her türün dönüşebileceği hedefler (yalnız onaylı belgede)
const DONUSUM: Record<string, ("siparis" | "irsaliye" | "fatura")[]> = {
  teklif: ["siparis"],
  siparis: ["irsaliye", "fatura"],
  irsaliye: ["fatura"],
};

type Tur = "teklif" | "siparis" | "irsaliye";
type Yon = "satis" | "alis";
type TurFiltre = "tumu" | Tur;

interface BelgeGorunumu {
  id: string; ad: string; tur: TurFiltre; yon: Yon | null; durum: string | null;
}

const GORUNUM_ANAHTARI = "tekir_belge_gorunumleri";

interface Cari { id: string; kod?: string; unvan: string; vknTckn?: string | null; telefon?: string | null }
interface Stok { id: string; kod: string; ad: string; tedarikciUrunKodlari?: string[] }

interface BelgeSatirForm {
  stokId: string;
  miktar: number;
  birimFiyat: number;
  iskontoOrani: number;
  kdvOrani: number;
}

interface Belge {
  id: string;
  tur: string;
  yon: string;
  durum: string;
  no: string | null;
  tarih: string;
  genelToplam: string;
  dovizCinsi: string;
  cari: { id: string; kod: string; unvan: string };
  faturaId: string | null;
}

interface ZincirRef { id: string; tur: string; no: string | null; durum: string }
interface BelgeDetay extends Belge {
  gecerlilikTarihi: string | null;
  aciklama: string | null;
  notlar: string | null;
  kaynakBelge: ZincirRef | null;
  turetilenler: ZincirRef[];
  fatura: { id: string; no: string | null; durum: string } | null;
  satirlar: { stokId: string; miktar: string; birim: string; birimFiyat: string; iskontoOrani: string; kdvOrani: string }[];
}

const tl = (d: string | number, doviz = "TL"): string =>
  Number(d).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " " + doviz;
const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

function durumRozet(durum: string) {
  if (durum === "taslak") return <Badge variant="warning">📝 Taslak</Badge>;
  if (durum === "onaylandi") return <Badge variant="info">✅ Onaylı</Badge>;
  if (durum === "kapandi") return <Badge variant="neutral">🔗 Kapandı</Badge>;
  return <Badge variant="danger">İptal</Badge>;
}

export default function BelgelerSayfasi() {
  const [belgeler, setBelgeler] = useState<Belge[]>([]);
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [stoklar, setStoklar] = useState<Stok[]>([]);
  const [turFiltre, setTurFiltre] = useState<TurFiltre>("tumu");
  const [arama, setArama] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [formAcik, setFormAcik] = useState(false);
  const [detay, setDetay] = useState<BelgeDetay | null>(null);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [yonBaglami, setYonBaglami] = useState<Yon | null>(null);
  const [onayBekleyen, setOnayBekleyen] = useState<BelgeDetay | null>(null);
  const [durumFiltresi, setDurumFiltresi] = useState<string | null>(null);
  const [kayitliGorunumler, setKayitliGorunumler] = useState<BelgeGorunumu[]>([]);
  const [gorunumFormuAcik, setGorunumFormuAcik] = useState(false);
  const [gorunumAdi, setGorunumAdi] = useState("");

  // Form
  const [tur, setTur] = useState<Tur>("teklif");
  const [yon, setYon] = useState<Yon>("satis");
  const [cariId, setCariId] = useState("");
  const [depoId, setDepoId] = useState("");
  const [tarih, setTarih] = useState(new Date().toISOString().substring(0, 10));
  const [gecerlilik, setGecerlilik] = useState("");
  const [satirlar, setSatirlar] = useState<BelgeSatirForm[]>([
    { stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20 },
  ]);

  const girdiSatirlar: FaturaHesaplaSatirGirdi[] = satirlar.map((s) => ({
    stokId: s.stokId || "gecici-id",
    miktar: s.miktar,
    birimFiyat: s.birimFiyat,
    kdvOrani: s.kdvOrani,
    iskontoOrani: s.iskontoOrani,
  }));
  const sonuc = faturaHesapla({ satirlar: girdiSatirlar });

  const yukle = useCallback(async () => {
    setHata("");
    try {
      const qs = turFiltre === "tumu" ? "" : `?tur=${turFiltre}`;
      const veri = await api<{ kayitlar: Belge[] }>(`/belgeler${qs}`);
      setBelgeler(veri.kayitlar);
      setSecili(new Set());
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belgeler yüklenemedi");
    }
  }, [turFiltre]);

  useEffect(() => {
    if (!tokenAl()) return;
    void yukle();
  }, [yukle]);

  useEffect(() => {
    if (!tokenAl()) return;
    api<{ kayitlar: Cari[] }>("/cari?adet=200").then((v) => setCariler(v.kayitlar)).catch(() => undefined);
    api<{ kayitlar: Stok[] }>("/stok?adet=200").then((v) => setStoklar(v.kayitlar)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const parametreler = new URLSearchParams(window.location.search);
    const yonParametresi = parametreler.get("yon");
    const turParametresi = parametreler.get("tur");
    if (yonParametresi === "satis" || yonParametresi === "alis") {
      setYonBaglami(yonParametresi);
      setYon(yonParametresi);
    }
    if (turParametresi === "teklif" || turParametresi === "siparis" || turParametresi === "irsaliye") {
      setTur(turParametresi);
      setTurFiltre(turParametresi);
    }
    if (parametreler.get("yeni") === "1") setFormAcik(true);
    setDurumFiltresi(parametreler.get("durum"));
    try { setKayitliGorunumler(JSON.parse(localStorage.getItem(GORUNUM_ANAHTARI) ?? "[]") as BelgeGorunumu[]); }
    catch { localStorage.removeItem(GORUNUM_ANAHTARI); }
  }, []);

  function gorunumuUygula(gorunum: Omit<BelgeGorunumu, "id" | "ad">) {
    setTurFiltre(gorunum.tur); setYonBaglami(gorunum.yon); setDurumFiltresi(gorunum.durum);
    const parametreler = new URLSearchParams();
    if (gorunum.tur !== "tumu") parametreler.set("tur", gorunum.tur);
    if (gorunum.yon) parametreler.set("yon", gorunum.yon);
    if (gorunum.durum) parametreler.set("durum", gorunum.durum);
    window.history.replaceState(null, "", "/panel/belgeler" + (parametreler.size ? "?" + parametreler.toString() : ""));
  }

  function gorunumKaydet(event: React.FormEvent) {
    event.preventDefault(); const ad = gorunumAdi.trim(); if (!ad) return;
    const yeni: BelgeGorunumu = { id: Date.now().toString(), ad, tur: turFiltre, yon: yonBaglami, durum: durumFiltresi };
    const gorunumler = [...kayitliGorunumler.filter((g) => g.ad.toLocaleLowerCase("tr-TR") !== ad.toLocaleLowerCase("tr-TR")), yeni];
    setKayitliGorunumler(gorunumler); localStorage.setItem(GORUNUM_ANAHTARI, JSON.stringify(gorunumler));
    setGorunumAdi(""); setGorunumFormuAcik(false); setBasari("“" + ad + "” görünümü kaydedildi.");
    kullanimOlayi("gorunum_kaydedildi");
  }

  function gorunumSil(id: string) {
    const gorunumler = kayitliGorunumler.filter((gorunum) => gorunum.id !== id);
    setKayitliGorunumler(gorunumler); localStorage.setItem(GORUNUM_ANAHTARI, JSON.stringify(gorunumler));
  }

  function kayitliGorunumuUygula(gorunum: BelgeGorunumu) {
    gorunumuUygula(gorunum); kullanimOlayi("gorunum_kullanildi");
  }

  function satirEkle() {
    setSatirlar([...satirlar, { stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20 }]);
  }
  function satirSil(i: number) {
    if (satirlar.length === 1) return;
    setSatirlar(satirlar.filter((_, idx) => idx !== i));
  }
  async function satirGuncelle(i: number, alan: keyof BelgeSatirForm, deger: string | number) {
    const yeni = [...satirlar];
    yeni[i] = { ...yeni[i], [alan]: deger };
    if (alan === "stokId" && deger) {
      const stok = stoklar.find((s) => s.id === deger);
      void stok;
      try {
        const t = await api<{ birimFiyat: number; iskontoOrani: number }>(
          `/stok/${deger}/tavsiye-fiyat?cariId=${cariId}&tip=${yon}`,
        );
        yeni[i].birimFiyat = t.birimFiyat;
        yeni[i].iskontoOrani = t.iskontoOrani;
      } catch {
        /* tavsiye alınamazsa manuel */
      }
    }
    setSatirlar(yeni);
  }

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    if (!cariId) { setHata("Lütfen bir cari hesap seçin."); return; }
    if (satirlar.some((s) => !s.stokId)) { setHata("Lütfen tüm satırlarda ürün/hizmet seçin."); return; }
    try {
      await api("/belgeler", {
        method: "POST",
        body: JSON.stringify({
          tur,
          yon,
          tarih,
          gecerlilikTarihi: tur === "teklif" && gecerlilik ? gecerlilik : undefined,
          cariId,
          // STK-07: rezerv ve stok etkisi bu depoya işlenir
          depoId: depoId || null,
          satirlar: satirlar.map((s) => ({
            stokId: s.stokId,
            miktar: String(s.miktar),
            birim: "adet",
            birimFiyat: String(s.birimFiyat),
            iskontoOrani: String(s.iskontoOrani),
            kdvOrani: String(s.kdvOrani),
          })),
        }),
      });
      setBasari(`${TUR_ADI[tur]} taslağı oluşturuldu.`);
      setFormAcik(false);
      setCariId("");
      setGecerlilik("");
      setSatirlar([{ stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20 }]);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belge oluşturulamadı");
    }
  }

  async function eylem(id: string, yol: string, mesaj: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/belgeler/${id}/${yol}`, { method: "POST" });
      setBasari(mesaj);
      if (detay?.id === id) await detayAc(id);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem başarısız");
    }
  }

  async function onayOzetiAc(id: string) {
    setHata("");
    try {
      setOnayBekleyen(await api<BelgeDetay>(`/belgeler/${id}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Onay özeti yüklenemedi");
    }
  }

  async function onayiTamamla() {
    if (!onayBekleyen) return;
    const id = onayBekleyen.id;
    setOnayBekleyen(null);
    await eylem(id, "onayla", "Belge onaylandı.");
  }

  async function sil(id: string) {
    if (!confirm("Taslak belgeyi silmek istediğinize emin misiniz?")) return;
    setHata(""); setBasari("");
    try {
      await api(`/belgeler/${id}`, { method: "DELETE" });
      setBasari("Belge silindi.");
      if (detay?.id === id) setDetay(null);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Silme hatası");
    }
  }

  async function donustur(id: string, hedef: string) {
    setHata(""); setBasari("");
    try {
      await api(`/belgeler/${id}/donustur`, { method: "POST", body: JSON.stringify({ hedef }) });
      setBasari(hedef === "fatura" ? "Belge faturaya dönüştürüldü (taslak fatura oluştu)." : `Belge ${TUR_ADI[hedef] ?? hedef}'e dönüştürüldü.`);
      if (detay?.id === id) await detayAc(id);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Dönüştürme hatası");
    }
  }

  async function topluFatura() {
    if (secili.size === 0) return;
    setHata(""); setBasari("");
    try {
      await api("/belgeler/toplu-fatura", { method: "POST", body: JSON.stringify({ belgeIds: [...secili] }) });
      setBasari(`${secili.size} belge tek taslak faturada birleştirildi.`);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Toplu faturalama hatası");
    }
  }

  async function detayAc(id: string) {
    setHata("");
    try {
      setDetay(await api<BelgeDetay>(`/belgeler/${id}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belge detayı yüklenemedi");
    }
  }

  async function pdfAc(id: string) {
    try {
      const res = await fetch(`${apiBase()}/belgeler/${id}/pdf`, {
        headers: { Authorization: `Bearer ${tokenAl()}` },
      });
      if (!res.ok) throw new Error("PDF alınamadı");
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "PDF açılamadı");
    }
  }

  function seciliDegistir(id: string) {
    setSecili((eski) => {
      const y = new Set(eski);
      if (y.has(id)) y.delete(id); else y.add(id);
      return y;
    });
  }

  const gorunen = belgeler.filter((b) => {
    if (yonBaglami && b.yon !== yonBaglami) return false;
    if (durumFiltresi && b.durum !== durumFiltresi) return false;
    if (!arama) return true;
    const q = arama.toLocaleLowerCase("tr");
    return (b.no ?? "").toLocaleLowerCase("tr").includes(q) || b.cari.unvan.toLocaleLowerCase("tr").includes(q);
  });
  // Toplu faturalanabilir: onaylı sipariş/irsaliye
  const faturalanabilir = (b: Belge) => b.durum === "onaylandi" && (b.tur === "siparis" || b.tur === "irsaliye");

  return (
    <div>
      <PageHeader
        title={
          yonBaglami === "satis"
            ? "Satış Belgeleri"
            : yonBaglami === "alis"
              ? "Satın Alma Belgeleri"
              : "Tüm Belgeler"
        }
        subtitle={
          yonBaglami
            ? "Teklif, sipariş ve irsaliyeleri iş akışına göre yönetin ve faturaya dönüştürün."
            : "Satış ve satın alma belge zincirlerini tek görünümde inceleyin."
        }
        actions={
          <>
            {secili.size > 0 && (
              <Button variant="primary" onClick={topluFatura}>🧾 Seçilenleri Faturala ({secili.size})</Button>
            )}
            <Button variant={secili.size > 0 ? "ghost" : "primary"} onClick={() => setFormAcik(!formAcik)}>
              {formAcik ? "Vazgeç" : "➕ Yeni Belge"}
            </Button>
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {formAcik && (
        <div className="document-editor">
          <div className="document-editor__head">
            <h3>Yeni {TUR_ADI[tur].toLocaleLowerCase("tr")}</h3>
            <span className="badge badge--warning">Taslak</span>
          </div>

          <div className="document-editor__section">
            <h4 className="document-editor__section-title">Cari ve belge bilgileri</h4>
            <div className="document-fields document-fields--belge">
              <div>
              <Field label={yon === "satis" ? "Müşteri" : "Tedarikçi"}>
                <AramaSecici
                  ariaLabel={yon === "satis" ? "Müşteri ara" : "Tedarikçi ara"}
                  deger={cariId}
                  onChange={setCariId}
                  placeholder="Ünvan, cari kodu veya VKN ile ara"
                  secenekler={cariler.map((cari) => ({
                    deger: cari.id,
                    baslik: cari.unvan,
                    aciklama: [cari.kod, cari.vknTckn, cari.telefon].filter(Boolean).join(" · ") || "Cari hesap",
                    aramaMetni: [cari.kod, cari.vknTckn, cari.telefon].filter(Boolean).join(" "),
                  }))}
                />
              </Field>
              </div>
              <Field label="Belge Türü"><Select value={tur} onChange={(e) => setTur(e.target.value as Tur)}><option value="teklif">Teklif</option><option value="siparis">Sipariş</option><option value="irsaliye">İrsaliye</option></Select></Field>
              <Field label="Yön"><Select value={yon} onChange={(e) => setYon(e.target.value as Yon)}><option value="satis">Satış</option><option value="alis">Alış</option></Select></Field>
              <Field label="Tarih"><Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} required /></Field>
              <div><DepoSecici deger={depoId} onChange={setDepoId} /></div>
            {tur === "teklif" && (
                <Field label="Geçerlilik Tarihi"><Input type="date" value={gecerlilik} onChange={(e) => setGecerlilik(e.target.value)} /></Field>
            )}
            </div>
          </div>

          <div className="document-editor__section document-lines">
            <h4 className="document-editor__section-title">Belge kalemleri</h4>
            <TableWrap>
            <colgroup>
              <col className="document-line-col--product" />
              <col className="document-line-col--quantity" />
              <col className="document-line-col--price" />
              <col className="document-line-col--rate" />
              <col className="document-line-col--rate" />
              <col className="document-line-col--total" />
              <col className="document-line-col--action" />
            </colgroup>
            <thead>
              <tr>
                <th>Ürün/Hizmet</th>
                <th className="num">Miktar</th>
                <th className="num">Birim fiyat</th>
                <th className="num">İsk. %</th>
                <th className="num">KDV %</th>
                <th className="num">Tutar</th>
                <th><span className="sr-only">İşlem</span></th>
              </tr>
            </thead>
            <tbody>
              {satirlar.map((s, i) => {
                const ss = sonuc.satirlar[i];
                return (
                  <tr key={i}>
                    <td>
                      <AramaSecici
                        ariaLabel={`${i + 1}. satır ürün veya hizmet seçimi`}
                        deger={s.stokId}
                        onChange={(deger) => void satirGuncelle(i, "stokId", deger)}
                        placeholder="Kod veya ürün adıyla ara"
                        secenekler={stoklar.map((stok) => ({
                          deger: stok.id,
                          baslik: stok.ad,
                          aciklama: stok.kod,
                          aramaMetni: [stok.kod, ...(stok.tedarikciUrunKodlari ?? [])].join(" "),
                        }))}
                      />
                    </td>
                    <td><Input className="document-line-number" aria-label="Miktar" type="number" min="0.01" step="any" inputMode="decimal" value={s.miktar} onChange={(e) => satirGuncelle(i, "miktar", Number(e.target.value))} required /></td>
                    <td><Input className="document-line-number" aria-label="Birim fiyat" type="number" min="0" step="any" inputMode="decimal" value={s.birimFiyat} onChange={(e) => satirGuncelle(i, "birimFiyat", Number(e.target.value))} required /></td>
                    <td><Input className="document-line-number" aria-label="İskonto yüzdesi" type="number" min="0" max="100" inputMode="decimal" value={s.iskontoOrani} onChange={(e) => satirGuncelle(i, "iskontoOrani", Number(e.target.value))} /></td>
                    <td><Input className="document-line-number" aria-label="KDV yüzdesi" type="number" min="0" max="100" inputMode="decimal" value={s.kdvOrani} onChange={(e) => satirGuncelle(i, "kdvOrani", Number(e.target.value))} required /></td>
                    <td className="num document-line-total">{ss ? tl(ss.toplamTutar) : "0,00 TL"}</td>
                    <td className="center"><Button aria-label="Satırı sil" title="Satırı sil" variant="danger" size="sm" type="button" onClick={() => satirSil(i)}>×</Button></td>
                  </tr>
                );
              })}
            </tbody>
            </TableWrap>

            <div className="document-summary-row">
              <Button type="button" onClick={satirEkle}>+ Satır ekle</Button>
              <div className="document-totals">
                <div className="document-total-line"><span>Brüt toplam</span><span>{tl(sonuc.toplamBrut)}</span></div>
                <div className="document-total-line is-tax"><span>KDV toplamı</span><span>{tl(sonuc.toplamKdv)}</span></div>
                <div className="document-total-line is-grand"><span>Genel toplam</span><span>{tl(sonuc.genelToplam)}</span></div>
              </div>
            </div>
          </div>

          <div className="document-editor__actions"><Button variant="primary" onClick={kaydet}>Taslak belgeyi kaydet</Button></div>
        </div>
      )}

      {detay && (
        <Card style={{ marginBottom: "1.5rem", borderColor: "var(--accent)" }}>
          <div className="between" style={{ alignItems: "flex-start" }}>
            <div>
              <h3 style={{ fontSize: "1.15rem", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {TUR_ADI[detay.tur]} {detay.no || "(Taslak)"} · {YON_ADI[detay.yon]} {durumRozet(detay.durum)}
              </h3>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
                {detay.cari.unvan} · {detay.tarih}{detay.gecerlilikTarihi ? ` · Geçerlilik: ${detay.gecerlilikTarihi}` : ""} · {tl(detay.genelToplam, detay.dovizCinsi)}
              </p>
            </div>
            <Button size="sm" onClick={() => setDetay(null)}>✖ Kapat</Button>
          </div>
          <div className="document-timeline" aria-label="Belge yaşam döngüsü">
            {(["teklif", "siparis", "irsaliye"] as const).map((adim) => {
              const kayit = detay.tur === adim
                ? { id: detay.id, tur: detay.tur, no: detay.no, durum: detay.durum }
                : detay.kaynakBelge?.tur === adim
                  ? detay.kaynakBelge
                  : detay.turetilenler.find((t) => t.tur === adim);
              const mevcut = detay.tur === adim;
              return (
                <button
                  className={`document-timeline__step${kayit ? " is-complete" : ""}${mevcut ? " is-current" : ""}`}
                  disabled={!kayit || mevcut}
                  key={adim}
                  onClick={() => kayit && void detayAc(kayit.id)}
                  type="button"
                >
                  <span>{kayit ? "✓" : ""}</span>
                  <strong>{TUR_ADI[adim]}</strong>
                  <small>{mevcut ? "Mevcut" : kayit?.no ?? (kayit ? "Taslak" : "Bekliyor")}</small>
                </button>
              );
            })}
            <a className={`document-timeline__step${detay.fatura ? " is-complete" : ""}`} href={detay.fatura ? "/panel/fatura" : undefined} aria-disabled={!detay.fatura}>
              <span>{detay.fatura ? "✓" : ""}</span>
              <strong>Fatura</strong>
              <small>{detay.fatura?.no ?? (detay.fatura ? "Taslak" : "Bekliyor")}</small>
            </a>
            <div className="document-timeline__step" aria-disabled="true"><span /><strong>e-Belge</strong><small>Bekliyor</small></div>
            <div className="document-timeline__step" aria-disabled="true"><span /><strong>Tahsilat/Ödeme</strong><small>Bekliyor</small></div>
          </div>
          <TableWrap>
            <thead>
              <tr><th>Ürün</th><th className="num">Miktar</th><th className="num">Birim Fiyat</th><th className="num">İskonto %</th><th className="num">KDV %</th></tr>
            </thead>
            <tbody>
              {detay.satirlar.map((s, i) => {
                const st = stoklar.find((x) => x.id === s.stokId);
                return (
                  <tr key={i}>
                    <td>{st ? `${st.ad} (${st.kod})` : s.stokId}</td>
                    <td className="num">{Number(s.miktar).toLocaleString("tr-TR")} {s.birim}</td>
                    <td className="num">{tl(s.birimFiyat)}</td>
                    <td className="num">%{Number(s.iskontoOrani)}</td>
                    <td className="num">%{Number(s.kdvOrani)}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {onayBekleyen && (
        <HizliKayitPaneli baslik="Belgeyi onayla" onKapat={() => setOnayBekleyen(null)}>
          <div className="approval-summary">
            <div className="approval-summary__identity">
              <strong>{TUR_ADI[onayBekleyen.tur]} · {YON_ADI[onayBekleyen.yon]}</strong>
              <span>{onayBekleyen.cari.unvan}</span>
            </div>
            <dl>
              <div><dt>Kalem</dt><dd>{onayBekleyen.satirlar.length}</dd></div>
              <div><dt>Toplam miktar</dt><dd>{onayBekleyen.satirlar.reduce((toplam, satir) => toplam + Number(satir.miktar), 0).toLocaleString("tr-TR")}</dd></div>
              <div><dt>Genel toplam</dt><dd>{tl(onayBekleyen.genelToplam, onayBekleyen.dovizCinsi)}</dd></div>
            </dl>
            <div className="approval-impact">
              {onayBekleyen.tur === "siparis" && onayBekleyen.yon === "satis" && "Onayla birlikte ürün miktarları seçilen depoda rezerve edilecek."}
              {onayBekleyen.tur === "siparis" && onayBekleyen.yon === "alis" && "Onayla birlikte ürün miktarları seçilen depo için yoldaki stok olarak işaretlenecek."}
              {onayBekleyen.tur === "teklif" && "Teklif numara alacak; stok ve cari bakiyesi değişmeyecek."}
              {onayBekleyen.tur === "irsaliye" && "İrsaliye numara alacak; stok ve cari etkisi fatura kesinleştiğinde oluşacak."}
            </div>
            <div className="quick-panel__actions">
              <Button type="button" onClick={() => setOnayBekleyen(null)}>Vazgeç</Button>
              <Button type="button" variant="primary" onClick={() => void onayiTamamla()}>Onayla</Button>
            </div>
          </div>
        </HizliKayitPaneli>
      )}

      <section className="saved-view-bar" aria-label="Belge görünümü ve filtreleri">
        <div className="saved-view-filters">
          <Field label="Yön"><Select value={yonBaglami ?? ""} onChange={(e) => gorunumuUygula({ tur: turFiltre, yon: (e.target.value || null) as Yon | null, durum: durumFiltresi })}><option value="">Tümü</option><option value="satis">Satış</option><option value="alis">Satın alma</option></Select></Field>
          <Field label="Belge durumu"><Select value={durumFiltresi ?? ""} onChange={(e) => gorunumuUygula({ tur: turFiltre, yon: yonBaglami, durum: e.target.value || null })}><option value="">Tümü</option><option value="taslak">Taslak</option><option value="onaylandi">Onaylı</option><option value="kapandi">Kapandı</option><option value="iptal">İptal</option></Select></Field>
          <Field label="Kaydedilmiş görünüm"><Select value="" onChange={(e) => { const gorunum = kayitliGorunumler.find((g) => g.id === e.target.value); if (gorunum) kayitliGorunumuUygula(gorunum); }}><option value="">Görünüm seçin</option>{kayitliGorunumler.map((g) => <option value={g.id} key={g.id}>{g.ad}</option>)}</Select></Field>
        </div>
        <div className="saved-view-actions">
          {(turFiltre !== "tumu" || yonBaglami || durumFiltresi) && <Button size="sm" type="button" onClick={() => gorunumuUygula({ tur: "tumu", yon: null, durum: null })}>Filtreleri temizle</Button>}
          <Button size="sm" type="button" onClick={() => setGorunumFormuAcik((acik) => !acik)}>Görünümü kaydet</Button>
        </div>
        {gorunumFormuAcik && <form className="saved-view-form" onSubmit={gorunumKaydet}><Input autoFocus aria-label="Görünüm adı" value={gorunumAdi} onChange={(e) => setGorunumAdi(e.target.value)} placeholder="Örn. Onay bekleyen satış siparişleri" required /><Button size="sm" variant="primary" type="submit">Kaydet</Button><Button size="sm" type="button" onClick={() => setGorunumFormuAcik(false)}>Vazgeç</Button></form>}
        {kayitliGorunumler.length > 0 && <div className="saved-view-list" aria-label="Kaydedilmiş görünümleri yönet">{kayitliGorunumler.map((g) => <span key={g.id}><button type="button" onClick={() => kayitliGorunumuUygula(g)}>{g.ad}</button><button aria-label={g.ad + " görünümünü sil"} title="Görünümü sil" type="button" onClick={() => gorunumSil(g.id)}>×</button></span>)}</div>}
      </section>

      <div className="toolbar">
        <SearchInput className="grow" value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Belge no veya cari ile ara..." />
        <Segmented<TurFiltre>
          value={turFiltre}
          onChange={setTurFiltre}
          items={[
            { deger: "tumu", baslik: "Tümü" },
            { deger: "teklif", baslik: "Teklif" },
            { deger: "siparis", baslik: "Sipariş" },
            { deger: "irsaliye", baslik: "İrsaliye" },
          ]}
        />
      </div>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th style={{ width: 36 }}></th>
              <th>Belge No</th>
              <th>Tür / Yön</th>
              <th>Cari</th>
              <th>Tarih</th>
              <th className="num">Genel Toplam</th>
              <th>Durum</th>
              <th className="center">Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {gorunen.length === 0 ? (
              <tr><td colSpan={8} className="empty">Kayıtlı belge bulunmuyor.</td></tr>
            ) : (
              gorunen.map((b) => (
                <tr key={b.id}>
                  <td className="center">
                    {faturalanabilir(b) && (
                      <input type="checkbox" checked={secili.has(b.id)} onChange={() => seciliDegistir(b.id)} title="Toplu faturalama için seç" />
                    )}
                  </td>
                  <td style={{ fontWeight: 700 }}>{b.no || "(Taslak)"}</td>
                  <td>{TUR_ADI[b.tur]} · {YON_ADI[b.yon]}</td>
                  <td>{b.cari.unvan}</td>
                  <td>{b.tarih}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{tl(b.genelToplam, b.dovizCinsi)}</td>
                  <td>{durumRozet(b.durum)}</td>
                  <td className="center">
                    <div className="row-tight" style={{ flexWrap: "nowrap", justifyContent: "center" }}>
                      <Button aria-label="Belge detayını aç" title="Belge detayını aç" size="sm" onClick={() => detayAc(b.id)}>🔍</Button>
                      {b.durum === "taslak" && (
                        <>
                          <Button variant="primary" size="sm" onClick={() => void onayOzetiAc(b.id)}>Onayla</Button>
                          <Button variant="danger" size="sm" onClick={() => sil(b.id)}>Sil</Button>
                        </>
                      )}
                      {b.durum === "onaylandi" && (
                        <>
                          {DONUSUM[b.tur]?.map((h) => (
                            <Button key={h} size="sm" onClick={() => donustur(b.id, h)}>→ {h === "fatura" ? "Fatura" : TUR_ADI[h]}</Button>
                          ))}
                          <Button size="sm" onClick={() => eylem(b.id, "iptal", "Belge iptal edildi.")}>İptal</Button>
                        </>
                      )}
                      <Button size="sm" onClick={() => pdfAc(b.id)}>🖨</Button>
                      <Button size="sm" onClick={() => eylem(b.id, "kopyala", "Belge kopyalandı (taslak).")}>📋</Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
