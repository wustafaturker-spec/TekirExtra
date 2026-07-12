"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiHata, tokenAl } from "@/lib/api";
import { stil } from "@/lib/stil";
import { faturaHesapla, type FaturaHesaplaSatirGirdi } from "@tekirextra/shared";

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
    { stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20 },
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
    setSatirlar([...satirlar, { stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20 }]);
  }

  function satirSil(index: number) {
    if (satirlar.length === 1) return;
    setSatirlar(satirlar.filter((_, i) => i !== index));
  }

  function satirGuncelle(index: number, alan: keyof FaturaSatir, deger: any) {
    const yeni = [...satirlar];
    yeni[index] = { ...yeni[index], [alan]: deger };

    // Eğer stok seçildiyse varsayılan fiyatları yükleyelim
    if (alan === "stokId") {
      const stok = stoklar.find((s) => s.id === deger);
      if (stok) {
        yeni[index].birimFiyat = Number(tip === "satis" ? stok.satisFiyati ?? 0 : stok.alisFiyati ?? 0);
        yeni[index].kdvOrani = Number(stok.kdvOrani || 20);
      }
    }
    setSatirlar(yeni);
  }

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
          })),
        }),
      });

      setBasari("Fatura taslağı başarıyla oluşturuldu.");
      setFormAcik(false);
      setCariId("");
      setSatirlar([{ stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20 }]);
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
    const url = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1"}/fatura/${id}/pdf?token=${token ?? ""}`;
    window.open(url, "_blank");
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "2rem", fontWeight: "bold", margin: 0 }}>📄 Fatura Yönetimi</h1>
          <p style={{ color: "#a1a1aa", fontSize: "0.9rem", margin: "0.25rem 0 0" }}>
            Alış ve satış faturalarınızı oluşturun, kesinleştirin ve GİB entegratör kuyruk durumlarını takip edin.
          </p>
        </div>
        <button onClick={() => setFormAcik(!formAcik)} style={{ ...stil.dugme, width: "auto", padding: "0.5rem 1.25rem" }}>
          {formAcik ? "Vazgeç" : "➕ Yeni Fatura"}
        </button>
      </div>

      {hata && <p style={stil.hata}>{hata}</p>}
      {basari && <p style={stil.basari}>{basari}</p>}

      {formAcik && (
        <form onSubmit={kaydet} style={{ ...stil.genisKart, marginBottom: "2rem" }}>
          <h3 style={{ margin: "0 0 1.5rem", fontSize: "1.1rem", fontWeight: "bold" }}>Yeni Fatura Düzenle</h3>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
            <div style={{ flex: 2, minWidth: "220px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Cari Hesap Seçimi</label>
              <select value={cariId} onChange={(e) => setCariId(e.target.value)} style={stil.girdi} required>
                <option value="">-- Cari Seçiniz --</option>
                {cariler.map((c) => (
                  <option key={c.id} value={c.id}>{c.unvan}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: "150px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Fatura Tipi</label>
              <select value={tip} onChange={(e) => { setTip(e.target.value); setSatirlar([{ stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20 }]); }} style={stil.girdi}>
                <option value="satis">Satış Faturası</option>
                <option value="alis">Alış Faturası</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: "150px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Fatura Tarihi</label>
              <input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} style={stil.girdi} required />
            </div>
          </div>

          <h4 style={{ margin: "1.5rem 0 0.5rem", fontSize: "0.95rem", color: "#a1a1aa" }}>Fatura Satırları</h4>
          <table style={stil.tablo}>
            <thead>
              <tr>
                <th style={stil.tabloBaslik}>Ürün/Hizmet</th>
                <th style={{ ...stil.tabloBaslik, width: "90px" }}>Miktar</th>
                <th style={{ ...stil.tabloBaslik, width: "120px" }}>Birim Fiyat</th>
                <th style={{ ...stil.tabloBaslik, width: "90px" }}>İskonto %</th>
                <th style={{ ...stil.tabloBaslik, width: "90px" }}>KDV %</th>
                <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Satır Toplamı</th>
                <th style={{ ...stil.tabloBaslik, textAlign: "center", width: "50px" }}></th>
              </tr>
            </thead>
            <tbody>
              {satirlar.map((s, index) => {
                const satirSonuc = sonuc.satirlar[index];
                return (
                  <tr key={index}>
                    <td style={stil.tabloHucre}>
                      <select value={s.stokId} onChange={(e) => satirGuncelle(index, "stokId", e.target.value)} style={{ ...stil.girdi, margin: 0 }} required>
                        <option value="">-- Ürün/Hizmet Seçin --</option>
                        {stoklar.map((st) => (
                          <option key={st.id} value={st.id}>{st.ad} ({st.kod})</option>
                        ))}
                      </select>
                    </td>
                    <td style={stil.tabloHucre}>
                      <input type="number" min="0.01" step="any" value={s.miktar} onChange={(e) => satirGuncelle(index, "miktar", Number(e.target.value))} style={{ ...stil.girdi, margin: 0 }} required />
                    </td>
                    <td style={stil.tabloHucre}>
                      <input type="number" min="0" step="any" value={s.birimFiyat} onChange={(e) => satirGuncelle(index, "birimFiyat", Number(e.target.value))} style={{ ...stil.girdi, margin: 0 }} required />
                    </td>
                    <td style={stil.tabloHucre}>
                      <input type="number" min="0" max="100" value={s.iskontoOrani} onChange={(e) => satirGuncelle(index, "iskontoOrani", Number(e.target.value))} style={{ ...stil.girdi, margin: 0 }} />
                    </td>
                    <td style={stil.tabloHucre}>
                      <input type="number" min="0" max="100" value={s.kdvOrani} onChange={(e) => satirGuncelle(index, "kdvOrani", Number(e.target.value))} style={{ ...stil.girdi, margin: 0 }} required />
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", fontWeight: "bold" }}>
                      {satirSonuc ? `${satirSonuc.toplamTutar.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL` : "0.00 TL"}
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "center" }}>
                      <button type="button" onClick={() => satirSil(index)} style={{ ...stil.dugmeMuted, padding: "0.25rem 0.5rem", color: "#ef4444", borderColor: "#ef4444" }}>🗑️</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem" }}>
            <button type="button" onClick={satirEkle} style={stil.dugmeMuted}>➕ Satır Ekle</button>
            <div style={{ width: "300px", background: "rgba(24, 24, 27, 0.4)", padding: "1rem", borderRadius: 8, border: "1px solid #27272a" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
                <span>Brüt Toplam:</span>
                <span>{sonuc.toplamBrut.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", marginBottom: "0.5rem", color: "#ef4444" }}>
                <span>Toplam İskonto:</span>
                <span>-{sonuc.toplamSatirIskontosu.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", marginBottom: "0.5rem", color: "#6366f1" }}>
                <span>KDV Toplamı:</span>
                <span>{sonuc.toplamKdv.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "1.1rem", borderTop: "1px solid #27272a", paddingTop: "0.5rem", marginTop: "0.5rem" }}>
                <span>Genel Toplam:</span>
                <span>{sonuc.genelToplam.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL</span>
              </div>
            </div>
          </div>

          <button type="submit" style={{ ...stil.dugme, marginTop: "1.5rem" }}>Taslak Fatura Kaydet</button>
        </form>
      )}

      <div style={stil.genisKart}>
        <table style={stil.tablo}>
          <thead>
            <tr>
              <th style={stil.tabloBaslik}>Fatura No</th>
              <th style={stil.tabloBaslik}>Firma / Cari</th>
              <th style={stil.tabloBaslik}>Tarih</th>
              <th style={stil.tabloBaslik}>Fatura Tipi</th>
              <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Net Tutar</th>
              <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Genel Toplam</th>
              <th style={stil.tabloBaslik}>Durum</th>
              <th style={stil.tabloBaslik}>e-Belge Durumu</th>
              <th style={{ ...stil.tabloBaslik, textAlign: "center" }}>Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {faturalar.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ ...stil.tabloHucre, textAlign: "center", color: "#a1a1aa" }}>
                  Sistemde henüz kayıtlı fatura bulunmuyor.
                </td>
              </tr>
            ) : (
              faturalar.map((f) => (
                <tr key={f.id}>
                  <td style={{ ...stil.tabloHucre, fontWeight: "bold" }}>{f.faturaNo || "(Taslak)"}</td>
                  <td style={stil.tabloHucre}>{f.cari.unvan}</td>
                  <td style={stil.tabloHucre}>{f.tarih}</td>
                  <td style={stil.tabloHucre}>
                    {f.tip === "satis" ? "📤 Satış" : "📥 Alış"}
                  </td>
                  <td style={{ ...stil.tabloHucre, textAlign: "right" }}>
                    {Number(f.netTutar).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                  </td>
                  <td style={{ ...stil.tabloHucre, textAlign: "right", fontWeight: "bold" }}>
                    {Number(f.genelToplam).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                  </td>
                  <td style={stil.tabloHucre}>
                    {f.durum === "taslak" ? (
                      <span style={{ color: "#eab308", fontWeight: "bold" }}>📝 Taslak</span>
                    ) : (
                      <span style={{ color: "#22c55e", fontWeight: "bold" }}>🔒 Kesinleşti</span>
                    )}
                  </td>
                  <td style={stil.tabloHucre}>
                    {f.durum === "taslak" ? (
                      "-"
                    ) : (
                      <div>
                        {f.ebelgeGonderimDurumu === "basarili" && (
                          <span style={{ color: "#22c55e" }}>✓ Tamamlandı</span>
                        )}
                        {f.ebelgeGonderimDurumu === "kuyrukta" && (
                          <span style={{ color: "#6366f1" }}>⚙ Kuyrukta</span>
                        )}
                        {f.ebelgeGonderimDurumu === "hatali" && (
                          <span style={{ color: "#ef4444" }}>⚠ Hata: {f.ebelgeHataMesaji || "Gönderilemedi"}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ ...stil.tabloHucre, textAlign: "center" }}>
                    <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
                      {f.durum === "taslak" ? (
                        <>
                          <button onClick={() => kesinlestir(f.id)} style={{ ...stil.dugme, width: "auto", padding: "0.35rem 0.65rem", fontSize: "0.8rem" }}>
                            🔒 Kesinleştir
                          </button>
                          <button onClick={() => sil(f.id)} style={{ ...stil.dugmeMuted, color: "#ef4444", borderColor: "#ef4444", padding: "0.35rem 0.65rem", fontSize: "0.8rem" }}>
                            Sil
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => pdfAc(f.id)} style={{ ...stil.dugmeMuted, padding: "0.35rem 0.65rem", fontSize: "0.8rem" }}>
                            🖨 PDF Görüntüle
                          </button>
                          {f.ebelgeGonderimDurumu !== "basarili" && (
                            <button onClick={() => ebelgeSorgula(f.id)} style={{ ...stil.dugmeMuted, padding: "0.35rem 0.65rem", fontSize: "0.8rem", color: "#6366f1", borderColor: "#6366f1" }}>
                              Sorgula
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
