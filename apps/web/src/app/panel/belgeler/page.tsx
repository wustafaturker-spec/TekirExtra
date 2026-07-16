"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
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

interface Cari { id: string; unvan: string }
interface Stok { id: string; kod: string; ad: string }

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

  // Form
  const [tur, setTur] = useState<Tur>("teklif");
  const [yon, setYon] = useState<Yon>("satis");
  const [cariId, setCariId] = useState("");
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
    if (!arama) return true;
    const q = arama.toLocaleLowerCase("tr");
    return (b.no ?? "").toLocaleLowerCase("tr").includes(q) || b.cari.unvan.toLocaleLowerCase("tr").includes(q);
  });
  // Toplu faturalanabilir: onaylı sipariş/irsaliye
  const faturalanabilir = (b: Belge) => b.durum === "onaylandi" && (b.tur === "siparis" || b.tur === "irsaliye");

  return (
    <div>
      <PageHeader
        title="Belgeler"
        subtitle="Teklif → Sipariş → İrsaliye → Fatura zinciri. Belgeleri tek tıkla bir sonraki adıma dönüştürün (FTR-12/13)."
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
        <Card style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ fontSize: "1.05rem", marginBottom: "1.25rem" }}>Yeni Belge</h3>
          <div className="row" style={{ marginBottom: "1.25rem" }}>
            <div style={{ flex: 1, minWidth: 150 }}>
              <Field label="Belge Türü"><Select value={tur} onChange={(e) => setTur(e.target.value as Tur)}><option value="teklif">Teklif</option><option value="siparis">Sipariş</option><option value="irsaliye">İrsaliye</option></Select></Field>
            </div>
            <div style={{ flex: 1, minWidth: 130 }}>
              <Field label="Yön"><Select value={yon} onChange={(e) => setYon(e.target.value as Yon)}><option value="satis">Satış</option><option value="alis">Alış</option></Select></Field>
            </div>
            <div style={{ flex: 2, minWidth: 220 }}>
              <Field label="Cari Hesap"><Select value={cariId} onChange={(e) => setCariId(e.target.value)} required><option value="">-- Cari Seçiniz --</option>{cariler.map((c) => (<option key={c.id} value={c.id}>{c.unvan}</option>))}</Select></Field>
            </div>
            <div style={{ flex: 1, minWidth: 150 }}>
              <Field label="Tarih"><Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} required /></Field>
            </div>
            {tur === "teklif" && (
              <div style={{ flex: 1, minWidth: 150 }}>
                <Field label="Geçerlilik Tarihi"><Input type="date" value={gecerlilik} onChange={(e) => setGecerlilik(e.target.value)} /></Field>
              </div>
            )}
          </div>

          <h4 className="card__title" style={{ fontSize: "0.9rem" }}>Satırlar</h4>
          <TableWrap>
            <thead>
              <tr>
                <th>Ürün/Hizmet</th>
                <th style={{ width: 90 }}>Miktar</th>
                <th style={{ width: 120 }}>Birim Fiyat</th>
                <th style={{ width: 90 }}>İskonto %</th>
                <th style={{ width: 90 }}>KDV %</th>
                <th className="num">Satır Toplamı</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {satirlar.map((s, i) => {
                const ss = sonuc.satirlar[i];
                return (
                  <tr key={i}>
                    <td>
                      <Select value={s.stokId} onChange={(e) => satirGuncelle(i, "stokId", e.target.value)} required>
                        <option value="">-- Ürün/Hizmet Seçin --</option>
                        {stoklar.map((st) => (<option key={st.id} value={st.id}>{st.ad} ({st.kod})</option>))}
                      </Select>
                    </td>
                    <td><Input type="number" min="0.01" step="any" value={s.miktar} onChange={(e) => satirGuncelle(i, "miktar", Number(e.target.value))} required /></td>
                    <td><Input type="number" min="0" step="any" value={s.birimFiyat} onChange={(e) => satirGuncelle(i, "birimFiyat", Number(e.target.value))} required /></td>
                    <td><Input type="number" min="0" max="100" value={s.iskontoOrani} onChange={(e) => satirGuncelle(i, "iskontoOrani", Number(e.target.value))} /></td>
                    <td><Input type="number" min="0" max="100" value={s.kdvOrani} onChange={(e) => satirGuncelle(i, "kdvOrani", Number(e.target.value))} required /></td>
                    <td className="num" style={{ fontWeight: 700 }}>{ss ? tl(ss.toplamTutar) : "0,00 TL"}</td>
                    <td className="center"><Button variant="danger" size="sm" type="button" onClick={() => satirSil(i)}>🗑️</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>

          <div className="between" style={{ marginTop: "1rem", alignItems: "flex-start" }}>
            <Button type="button" onClick={satirEkle}>➕ Satır Ekle</Button>
            <div style={{ width: 260, background: "var(--surface-2)", padding: "1rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
              <div className="between" style={{ fontSize: "0.9rem", marginBottom: "0.4rem" }}><span className="muted">Brüt</span><span>{tl(sonuc.toplamBrut)}</span></div>
              <div className="between" style={{ fontSize: "0.9rem", marginBottom: "0.4rem", color: "var(--info)" }}><span>KDV</span><span>{tl(sonuc.toplamKdv)}</span></div>
              <div className="between" style={{ fontWeight: 700, fontSize: "1.05rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem", marginTop: "0.5rem" }}><span>Genel Toplam</span><span>{tl(sonuc.genelToplam)}</span></div>
            </div>
          </div>

          <div style={{ marginTop: "1.5rem" }}><Button variant="primary" onClick={kaydet}>Taslak Belge Kaydet</Button></div>
        </Card>
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
              <div className="row-tight" style={{ marginTop: "0.5rem" }}>
                {detay.kaynakBelge && <Badge variant="neutral">← Kaynak: {TUR_ADI[detay.kaynakBelge.tur]} {detay.kaynakBelge.no ?? ""}</Badge>}
                {detay.turetilenler.map((t) => <Badge key={t.id} variant="neutral">→ {TUR_ADI[t.tur]} {t.no ?? ""}</Badge>)}
                {detay.fatura && <Badge variant="success">→ Fatura {detay.fatura.no ?? "(taslak)"}</Badge>}
              </div>
            </div>
            <Button size="sm" onClick={() => setDetay(null)}>✖ Kapat</Button>
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
                      <Button size="sm" onClick={() => detayAc(b.id)}>🔍</Button>
                      {b.durum === "taslak" && (
                        <>
                          <Button variant="primary" size="sm" onClick={() => eylem(b.id, "onayla", "Belge onaylandı.")}>Onayla</Button>
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
