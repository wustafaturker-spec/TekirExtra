"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { faturaHesapla, type FaturaHesaplaSatirGirdi } from "@tekirextra/shared";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  TableWrap,
} from "@/components/ui";

interface Cari {
  id: string;
  unvan: string;
}

interface Stok {
  id: string;
  kod: string;
  ad: string;
  alisFiyati: string | null;
  satisFiyati: string | null;
  kdvOrani: string;
}

interface FaturaSatir {
  stokId: string;
  miktar: number;
  birimFiyat: number;
  iskontoOrani: number;
  kdvOrani: number;
  gibIstisnaKodu?: string;
}

interface Fatura {
  id: string;
  faturaNo: string | null;
  tip: string;
  tarih: string;
  durum: string;
  netTutar: string;
  kdvTutari: string;
  genelToplam: string;
  cari: { unvan: string };
  ebelgeGonderimDurumu?: string;
  ebelgeHataMesaji?: string;
}

const tl = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";

const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export default function FaturaSayfasi() {
  const [faturalar, setFaturalar] = useState<Fatura[]>([]);
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [stoklar, setStoklar] = useState<Stok[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [formAcik, setFormAcik] = useState(false);

  // Form alanları
  const [cariId, setCariId] = useState("");
  const [tip, setTip] = useState("satis");
  const [tarih, setTarih] = useState(new Date().toISOString().substring(0, 10));
  const [satirlar, setSatirlar] = useState<FaturaSatir[]>([
    { stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20, gibIstisnaKodu: "" },
  ]);

  // Önizleme hesaplamaları
  const girdiSatirlar: FaturaHesaplaSatirGirdi[] = satirlar.map((s) => ({
    stokId: s.stokId || "gecici-id",
    miktar: s.miktar,
    birimFiyat: s.birimFiyat,
    kdvOrani: s.kdvOrani,
    iskontoOrani: s.iskontoOrani,
  }));
  const sonuc = faturaHesapla({ satirlar: girdiSatirlar });

  const yukle = useCallback(async () => {
    try {
      const fVeri = await api<{ kayitlar: Fatura[] }>("/fatura");
      setFaturalar(fVeri.kayitlar);

      const cVeri = await api<{ kayitlar: Cari[] }>("/cari?adet=100");
      setCariler(cVeri.kayitlar);

      const sVeri = await api<{ kayitlar: Stok[] }>("/stok?adet=100");
      setStoklar(sVeri.kayitlar);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Yükleme hatası");
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) {
      void yukle();
    }
  }, [yukle]);

  function satirEkle() {
    setSatirlar([...satirlar, { stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20, gibIstisnaKodu: "" }]);
  }

  function satirSil(index: number) {
    if (satirlar.length === 1) return;
    setSatirlar(satirlar.filter((_, i) => i !== index));
  }

  async function satirGuncelle(index: number, alan: keyof FaturaSatir, deger: string | number) {
    const yeni = [...satirlar];
    yeni[index] = { ...yeni[index], [alan]: deger };

    // Eğer stok seçildiyse varsayılan fiyatları yükleyelim
    if (alan === "stokId") {
      const stok = stoklar.find((s) => s.id === deger);
      if (stok) {
        yeni[index].kdvOrani = Number(stok.kdvOrani || 20);
      }
      if (deger) {
        try {
          const tavsiye = await api<{ birimFiyat: number; iskontoOrani: number }>(
            `/stok/${deger}/tavsiye-fiyat?cariId=${cariId}&tip=${tip}`
          );
          yeni[index].birimFiyat = tavsiye.birimFiyat;
          yeni[index].iskontoOrani = tavsiye.iskontoOrani;
        } catch (err) {
          console.error("Tavsiye fiyat alınamadı", err);
        }
      }
    }
    setSatirlar(yeni);
  }

  useEffect(() => {
    if (cariId && satirlar.some((s) => s.stokId)) {
      const guncelleFiyatlar = async () => {
        const yeni = [...satirlar];
        for (let i = 0; i < yeni.length; i++) {
          if (yeni[i].stokId) {
            try {
              const tavsiye = await api<{ birimFiyat: number; iskontoOrani: number }>(
                `/stok/${yeni[i].stokId}/tavsiye-fiyat?cariId=${cariId}&tip=${tip}`
              );
              yeni[i].birimFiyat = tavsiye.birimFiyat;
              yeni[i].iskontoOrani = tavsiye.iskontoOrani;
            } catch (err) {
              console.error(err);
            }
          }
        }
        setSatirlar(yeni);
      };
      void guncelleFiyatlar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cariId, tip]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");

    if (!cariId) {
      setHata("Lütfen bir cari hesap seçin.");
      return;
    }

    const eksikStok = satirlar.some((s) => !s.stokId);
    if (eksikStok) {
      setHata("Lütfen tüm satırlarda ürün/hizmet seçimi yapın.");
      return;
    }

    try {
      await api("/fatura", {
        method: "POST",
        body: JSON.stringify({
          cariId,
          tip,
          tarih,
          satirlar: satirlar.map((s) => ({
            stokId: s.stokId,
            miktar: String(s.miktar),
            birim: "adet",
            birimFiyat: String(s.birimFiyat),
            iskontoOrani: String(s.iskontoOrani),
            kdvOrani: String(s.kdvOrani),
            gibIstisnaKodu: s.gibIstisnaKodu || undefined,
          })),
        }),
      });

      setBasari("Fatura taslağı başarıyla oluşturuldu.");
      setFormAcik(false);
      setCariId("");
      setSatirlar([{ stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20, gibIstisnaKodu: "" }]);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Fatura oluşturulamadı");
    }
  }

  async function kesinlestir(id: string) {
    if (!confirm("Bu faturayı kesinleştirmek istediğinize emin misiniz? Bu işlem geri alınamaz ve e-Belge kuyruğuna gönderilir.")) return;
    setHata("");
    setBasari("");
    try {
      await api(`/fatura/${id}/kesinlestir`, { method: "POST" });
      setBasari("Fatura başarıyla kesinleştirildi ve e-Belge süreci başlatıldı.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kesinleştirme hatası");
    }
  }

  async function sil(id: string) {
    if (!confirm("Taslak faturayı silmek istediğinize emin misiniz?")) return;
    setHata("");
    setBasari("");
    try {
      await api(`/fatura/${id}`, { method: "DELETE" });
      setBasari("Fatura başarıyla silindi.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Silme hatası");
    }
  }

  async function kopyala(id: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/fatura/${id}/kopyala`, { method: "POST" });
      setBasari("Fatura başarıyla kopyalandı ve taslak olarak kaydedildi.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kopyalama hatası");
    }
  }

  async function ebelgeSorgula(id: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/ebelge/sorgula/${id}`, { method: "POST" });
      setBasari("e-Belge durumu sorgulandı ve güncellendi.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Sorgulama hatası");
    }
  }

  function pdfAc(id: string) {
    const token = tokenAl();
    const url = `${apiBase()}/fatura/${id}/pdf?token=${token ?? ""}`;
    window.open(url, "_blank");
  }

  return (
    <div>
      <PageHeader
        title="Fatura Yönetimi"
        subtitle="Alış ve satış faturalarınızı oluşturun, kesinleştirin ve GİB entegratör kuyruk durumlarını takip edin."
        actions={
          <>
            <ButtonLabel as="a" href="/panel/fatura/raporlar">📈 Raporlar</ButtonLabel>
            <Button variant="primary" onClick={() => setFormAcik(!formAcik)}>
              {formAcik ? "Vazgeç" : "➕ Yeni Fatura"}
            </Button>
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {formAcik && (
        <Card style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ fontSize: "1.05rem", marginBottom: "1.25rem" }}>Yeni Fatura Düzenle</h3>

          <div className="row" style={{ marginBottom: "1.25rem" }}>
            <div style={{ flex: 2, minWidth: 220 }}>
              <Field label="Cari Hesap Seçimi">
                <Select value={cariId} onChange={(e) => setCariId(e.target.value)} required>
                  <option value="">-- Cari Seçiniz --</option>
                  {cariler.map((c) => (<option key={c.id} value={c.id}>{c.unvan}</option>))}
                </Select>
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 150 }}>
              <Field label="Fatura Tipi">
                <Select value={tip} onChange={(e) => { setTip(e.target.value); setSatirlar([{ stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20 }]); }}>
                  <option value="satis">Satış Faturası</option>
                  <option value="alis">Alış Faturası</option>
                </Select>
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 150 }}>
              <Field label="Fatura Tarihi"><Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} required /></Field>
            </div>
          </div>

          <h4 className="card__title" style={{ fontSize: "0.9rem" }}>Fatura Satırları</h4>
          <TableWrap>
            <thead>
              <tr>
                <th>Ürün/Hizmet</th>
                <th style={{ width: 90 }}>Miktar</th>
                <th style={{ width: 120 }}>Birim Fiyat</th>
                <th style={{ width: 90 }}>İskonto %</th>
                <th style={{ width: 90 }}>KDV %</th>
                <th style={{ width: 110 }}>GİB İstisna</th>
                <th className="num">Satır Toplamı</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {satirlar.map((s, index) => {
                const satirSonuc = sonuc.satirlar[index];
                return (
                  <tr key={index}>
                    <td>
                      <Select value={s.stokId} onChange={(e) => satirGuncelle(index, "stokId", e.target.value)} required>
                        <option value="">-- Ürün/Hizmet Seçin --</option>
                        {stoklar.map((st) => (<option key={st.id} value={st.id}>{st.ad} ({st.kod})</option>))}
                      </Select>
                    </td>
                    <td><Input type="number" min="0.01" step="any" value={s.miktar} onChange={(e) => satirGuncelle(index, "miktar", Number(e.target.value))} required /></td>
                    <td><Input type="number" min="0" step="any" value={s.birimFiyat} onChange={(e) => satirGuncelle(index, "birimFiyat", Number(e.target.value))} required /></td>
                    <td><Input type="number" min="0" max="100" value={s.iskontoOrani} onChange={(e) => satirGuncelle(index, "iskontoOrani", Number(e.target.value))} /></td>
                    <td><Input type="number" min="0" max="100" value={s.kdvOrani} onChange={(e) => satirGuncelle(index, "kdvOrani", Number(e.target.value))} required /></td>
                    <td><Input type="text" placeholder="351 vb." value={s.gibIstisnaKodu || ""} onChange={(e) => satirGuncelle(index, "gibIstisnaKodu", e.target.value)} /></td>
                    <td className="num" style={{ fontWeight: 700 }}>{satirSonuc ? tl(satirSonuc.toplamTutar) : "0,00 TL"}</td>
                    <td className="center">
                      <Button variant="danger" size="sm" type="button" onClick={() => satirSil(index)}>🗑️</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>

          <div className="between" style={{ marginTop: "1rem", alignItems: "flex-start" }}>
            <Button type="button" onClick={satirEkle}>➕ Satır Ekle</Button>
            <div style={{ width: 300, background: "var(--surface-2)", padding: "1rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
              <div className="between" style={{ fontSize: "0.9rem", marginBottom: "0.4rem" }}>
                <span className="muted">Brüt Toplam</span><span>{tl(sonuc.toplamBrut)}</span>
              </div>
              <div className="between" style={{ fontSize: "0.9rem", marginBottom: "0.4rem", color: "var(--danger)" }}>
                <span>Toplam İskonto</span><span>-{tl(sonuc.toplamSatirIskontosu)}</span>
              </div>
              <div className="between" style={{ fontSize: "0.9rem", marginBottom: "0.4rem", color: "var(--info)" }}>
                <span>KDV Toplamı</span><span>{tl(sonuc.toplamKdv)}</span>
              </div>
              <div className="between" style={{ fontWeight: 700, fontSize: "1.05rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem", marginTop: "0.5rem" }}>
                <span>Genel Toplam</span><span>{tl(sonuc.genelToplam)}</span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "1.5rem" }}><Button variant="primary" onClick={kaydet}>Taslak Fatura Kaydet</Button></div>
        </Card>
      )}

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Fatura No</th>
              <th>Firma / Cari</th>
              <th>Tarih</th>
              <th>Tip</th>
              <th className="num">Net Tutar</th>
              <th className="num">Genel Toplam</th>
              <th>Durum</th>
              <th>e-Belge</th>
              <th className="center">Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {faturalar.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty">Sistemde henüz kayıtlı fatura bulunmuyor.</td>
              </tr>
            ) : (
              faturalar.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontWeight: 700 }}>{f.faturaNo || "(Taslak)"}</td>
                  <td>{f.cari.unvan}</td>
                  <td>{f.tarih}</td>
                  <td>{f.tip === "satis" ? "📤 Satış" : "📥 Alış"}</td>
                  <td className="num">{tl(f.netTutar)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{tl(f.genelToplam)}</td>
                  <td>
                    {f.durum === "taslak"
                      ? <Badge variant="warning">📝 Taslak</Badge>
                      : <Badge variant="success">🔒 Kesinleşti</Badge>}
                  </td>
                  <td>
                    {f.durum === "taslak" ? <span className="subtle">—</span> : (
                      <>
                        {f.ebelgeGonderimDurumu === "basarili" && <Badge variant="success">✓ Tamamlandı</Badge>}
                        {f.ebelgeGonderimDurumu === "kuyrukta" && <Badge variant="info">⚙ Kuyrukta</Badge>}
                        {f.ebelgeGonderimDurumu === "hatali" && <Badge variant="danger">⚠ {f.ebelgeHataMesaji || "Gönderilemedi"}</Badge>}
                      </>
                    )}
                  </td>
                  <td className="center">
                    <div className="row-tight" style={{ flexWrap: "nowrap", justifyContent: "center" }}>
                      {f.durum === "taslak" ? (
                        <>
                          <Button variant="primary" size="sm" onClick={() => kesinlestir(f.id)}>🔒 Kesinleştir</Button>
                          <Button variant="danger" size="sm" onClick={() => sil(f.id)}>Sil</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" onClick={() => pdfAc(f.id)}>🖨 PDF</Button>
                          {f.ebelgeGonderimDurumu !== "basarili" && (
                            <Button size="sm" onClick={() => ebelgeSorgula(f.id)}>Sorgula</Button>
                          )}
                        </>
                      )}
                      <Button size="sm" onClick={() => kopyala(f.id)}>📋 Kopyala</Button>
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
