"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface SmmDetay {
  faturaId: string;
  faturaNo: string;
  tarih: string;
  stokKod: string;
  stokAd: string;
  cariUnvan: string;
  satilanMiktar: number;
  satisNetTutar: number;
  birimMaliyet: number;
  toplamMaliyet: number;
  karTutar: number;
  karMarjiYuzde: number;
}

interface SmmRaporu {
  yontem: "agirlikli_ortalama" | "fifo";
  toplamSatisCirosu: string;
  toplamSmmMaliyeti: string;
  brutKar: string;
  genelKarMarjiYuzde: number;
  detaylar: SmmDetay[];
}

const tl = (val: string | number) => Number(val || 0).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });

export default function SmmRaporSayfasi() {
  const [yontem, setYontem] = useState<"agirlikli_ortalama" | "fifo">("agirlikli_ortalama");
  const [rapor, setRapor] = useState<SmmRaporu | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");
  const [arama, setArama] = useState("");

  const raporYukle = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      const veri = await api<SmmRaporu>(`/rapor/smm?yontem=${yontem}`);
      setRapor(veri);
    } catch (err) {
      setHata(err instanceof Error ? err.message : "SMM raporu yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [yontem]);

  useEffect(() => {
    void raporYukle();
  }, [raporYukle]);

  const filtrelenmisDetaylar = (rapor?.detaylar || []).filter((d) => {
    if (!arama.trim()) return true;
    const q = arama.toLowerCase();
    return (
      d.faturaNo.toLowerCase().includes(q) ||
      d.stokAd.toLowerCase().includes(q) ||
      d.stokKod.toLowerCase().includes(q) ||
      d.cariUnvan.toLowerCase().includes(q)
    );
  });

  return (
    <div style={{ backgroundColor: "#f8fafc", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#0f172a" }}>
      
      {/* Header */}
      <header style={{ backgroundColor: "#0f172a", color: "#ffffff", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{ backgroundColor: "#0284c7", color: "#ffffff", width: "36px", height: "36px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "900", fontSize: "16px" }}>
            ₺
          </div>
          <div>
            <h1 style={{ fontSize: "18px", fontWeight: "700", margin: 0 }}>Satılan Malın Maliyeti (SMM) & Karlılık Analizi</h1>
            <span style={{ fontSize: "11px", opacity: 0.8 }}>Stok Maliyetlendirme Yöntemleri: FIFO & Ağırlıklı Ortalama Maliyet</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Link href="/panel/stok" style={{ padding: "6px 14px", backgroundColor: "rgba(255,255,255,0.15)", color: "#ffffff", borderRadius: "6px", textDecoration: "none", fontSize: "12px", fontWeight: "600" }}>
            ← Stoğa Dön
          </Link>
          <button onClick={() => void raporYukle()} style={{ padding: "6px 14px", backgroundColor: "#0284c7", color: "#ffffff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>
            {yukleniyor ? "Yükleniyor..." : "↻ Yenile"}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ padding: "24px", maxWidth: "1500px", margin: "0 auto" }}>

        {/* Method Selector & Filters */}
        <div style={{ backgroundColor: "#ffffff", padding: "16px 20px", borderRadius: "10px", border: "1px solid #e2e8f0", marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "13px", fontWeight: "700", color: "#475569" }}>Maliyetlendirme Yöntemi:</span>
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                onClick={() => setYontem("agirlikli_ortalama")}
                style={{
                  padding: "8px 14px",
                  borderRadius: "6px",
                  border: "1px solid",
                  borderColor: yontem === "agirlikli_ortalama" ? "#0284c7" : "#cbd5e1",
                  backgroundColor: yontem === "agirlikli_ortalama" ? "#e0f2fe" : "#ffffff",
                  color: yontem === "agirlikli_ortalama" ? "#0369a1" : "#475569",
                  fontSize: "12px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                📊 Ağırlıklı Ortalama Maliyet
              </button>
              <button
                onClick={() => setYontem("fifo")}
                style={{
                  padding: "8px 14px",
                  borderRadius: "6px",
                  border: "1px solid",
                  borderColor: yontem === "fifo" ? "#0284c7" : "#cbd5e1",
                  backgroundColor: yontem === "fifo" ? "#e0f2fe" : "#ffffff",
                  color: yontem === "fifo" ? "#0369a1" : "#475569",
                  fontSize: "12px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                🔄 FIFO (İlk Giren İlk Çıkar)
              </button>
            </div>
          </div>

          <input
            type="text"
            placeholder="🔍 Fatura, Stok veya Cari Ara..."
            value={arama}
            onChange={(e) => setArama(e.target.value)}
            style={{ padding: "8px 14px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "12px", width: "240px" }}
          />
        </div>

        {/* Executive Overview KPI Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px", marginBottom: "24px" }}>
          
          <div style={{ backgroundColor: "#ffffff", padding: "18px 20px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
            <span style={{ fontSize: "12px", fontWeight: "600", color: "#64748b" }}>Toplam Satış Cirosu</span>
            <div style={{ fontSize: "22px", fontWeight: "800", color: "#0f172a", marginTop: "4px" }}>{tl(rapor?.toplamSatisCirosu || 0)}</div>
            <span style={{ fontSize: "11px", color: "#94a3b8" }}>Net faturalandırılmış brüt satışlar</span>
          </div>

          <div style={{ backgroundColor: "#ffffff", padding: "18px 20px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
            <span style={{ fontSize: "12px", fontWeight: "600", color: "#dc2626" }}>Satılan Malın Maliyeti (SMM)</span>
            <div style={{ fontSize: "22px", fontWeight: "800", color: "#dc2626", marginTop: "4px" }}>{tl(rapor?.toplamSmmMaliyeti || 0)}</div>
            <span style={{ fontSize: "11px", color: "#94a3b8" }}>Seçilen metot ({yontem === "fifo" ? "FIFO" : "Ortalama"}) maliyeti</span>
          </div>

          <div style={{ backgroundColor: "#ffffff", padding: "18px 20px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
            <span style={{ fontSize: "12px", fontWeight: "600", color: "#16a34a" }}>Brüt Satış Karı</span>
            <div style={{ fontSize: "22px", fontWeight: "800", color: "#16a34a", marginTop: "4px" }}>{tl(rapor?.brutKar || 0)}</div>
            <span style={{ fontSize: "11px", color: "#94a3b8" }}>Ciro - SMM Maliyeti</span>
          </div>

          <div style={{ backgroundColor: "#ffffff", padding: "18px 20px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
            <span style={{ fontSize: "12px", fontWeight: "600", color: "#0284c7" }}>Genel Brüt Kar Marjı</span>
            <div style={{ fontSize: "22px", fontWeight: "800", color: "#0284c7", marginTop: "4px" }}>%{rapor?.genelKarMarjiYuzde || 0}</div>
            <span style={{ fontSize: "11px", color: "#94a3b8" }}>Kar / Toplam Ciro oranı</span>
          </div>

        </div>

        {hata && (
          <div style={{ backgroundColor: "#fee2e2", color: "#dc2626", padding: "12px 16px", borderRadius: "8px", marginBottom: "16px", fontSize: "13px" }}>
            ⚠️ {hata}
          </div>
        )}

        {/* Detailed Table */}
        <div style={{ backgroundColor: "#ffffff", borderRadius: "10px", border: "1px solid #cbd5e1", overflow: "hidden", boxShadow: "0 2px 6px rgba(0,0,0,0.04)" }}>
          <div style={{ padding: "14px 20px", backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: "13px", fontWeight: "700", color: "#334155" }}>
            📋 Satış Kalemleri Bazında Maliyet & Kar Marjı Dökümü ({filtrelenmisDetaylar.length} kayıt)
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr style={{ backgroundColor: "#f1f5f9", color: "#475569", borderBottom: "2px solid #cbd5e1" }}>
                  <th style={{ padding: "10px 14px", textAlign: "left" }}>Fatura No</th>
                  <th style={{ padding: "10px 14px", textAlign: "left" }}>Tarih</th>
                  <th style={{ padding: "10px 14px", textAlign: "left" }}>Müşteri (Cari)</th>
                  <th style={{ padding: "10px 14px", textAlign: "left" }}>Ürün / Stok Adı</th>
                  <th style={{ padding: "10px 14px", textAlign: "right" }}>Miktar</th>
                  <th style={{ padding: "10px 14px", textAlign: "right" }}>Satış Cirosu</th>
                  <th style={{ padding: "10px 14px", textAlign: "right" }}>Birim Maliyet</th>
                  <th style={{ padding: "10px 14px", textAlign: "right" }}>Toplam SMM</th>
                  <th style={{ padding: "10px 14px", textAlign: "right" }}>Kar Tutarı</th>
                  <th style={{ padding: "10px 14px", textAlign: "right" }}>Kar Marjı</th>
                </tr>
              </thead>
              <tbody>
                {filtrelenmisDetaylar.map((satir, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0", backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f8fafc" }}>
                    <td style={{ padding: "10px 14px", fontWeight: "700", color: "#0f172a" }}>{satir.faturaNo}</td>
                    <td style={{ padding: "10px 14px", color: "#64748b" }}>{satir.tarih}</td>
                    <td style={{ padding: "10px 14px", color: "#334155" }}>{satir.cariUnvan}</td>
                    <td style={{ padding: "10px 14px", fontWeight: "600", color: "#0f172a" }}>
                      {satir.stokAd} <span style={{ fontSize: "10px", color: "#94a3b8" }}>({satir.stokKod})</span>
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: "700" }}>{satir.satilanMiktar}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: "600" }}>{tl(satir.satisNetTutar)}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", color: "#64748b" }}>{tl(satir.birimMaliyet)}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", color: "#dc2626", fontWeight: "600" }}>{tl(satir.toplamMaliyet)}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", color: satir.karTutar >= 0 ? "#16a34a" : "#dc2626", fontWeight: "700" }}>
                      {tl(satir.karTutar)}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      <span style={{ padding: "2px 8px", borderRadius: "12px", backgroundColor: satir.karMarjiYuzde >= 20 ? "#dcfce7" : satir.karMarjiYuzde > 0 ? "#fef9c3" : "#fee2e2", color: satir.karMarjiYuzde >= 20 ? "#15803d" : satir.karMarjiYuzde > 0 ? "#a16207" : "#b91c1c", fontWeight: "800", fontSize: "11px" }}>
                        %{satir.karMarjiYuzde}
                      </span>
                    </td>
                  </tr>
                ))}

                {!filtrelenmisDetaylar.length && (
                  <tr>
                    <td colSpan={10} style={{ padding: "32px", textAlign: "center", color: "#94a3b8" }}>
                      Gösterilecek uygun satış maliyet kaydı bulunamadı.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </main>

    </div>
  );
}
