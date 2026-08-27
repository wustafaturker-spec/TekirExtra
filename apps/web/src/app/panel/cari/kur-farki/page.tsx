"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface KurFarkiSonuc {
  cariId: string;
  cariKod: string;
  cariUnvan: string;
  dovizCinsi: string;
  dovizBakiye: number;
  kayitliTryBakiye: number;
  guncelKur: number;
  guncelTryDegeri: number;
  kurFarkiTutari: number;
  faturaTipi: "satis" | "alis";
  aciklama: string;
}

interface KurFarkiRaporu {
  degerlemeTarihi: string;
  guncelKurlar: Record<string, number>;
  toplamCariSayisi: number;
  sonuclar: KurFarkiSonuc[];
}

const tl = (val: number) => val.toLocaleString("tr-TR", { style: "currency", currency: "TRY" });

export default function KurFarkiSayfasi() {
  const [rapor, setRapor] = useState<KurFarkiRaporu | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");
  const [islenenCariId, setIslenenCariId] = useState<string | null>(null);
  const [basariMesaji, setBasariMesaji] = useState("");

  const raporYukle = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      const veri = await api<KurFarkiRaporu>("/cari/kur-farki-analizi");
      setRapor(veri);
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Kur farkı analizi alınamadı");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    void raporYukle();
  }, [raporYukle]);

  const faturaOlustur = async (satir: KurFarkiSonuc) => {
    setIslenenCariId(satir.cariId);
    setBasariMesaji("");
    try {
      const res = await api<{ mesaj: string; faturaId: string }>(`/cari/kur-farki-faturasi-olustur`, {
        method: "POST",
        body: JSON.stringify({
          cariId: satir.cariId,
          dovizCinsi: satir.dovizCinsi,
          kurFarkiTutari: satir.kurFarkiTutari,
          aciklama: satir.aciklama,
        }),
      });
      setBasariMesaji(`✅ ${satir.cariUnvan} için Kur Farkı Faturası (Taslak) başarıyla oluşturuldu.`);
      await raporYukle();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Fatura oluşturulamadı");
    } finally {
      setIslenenCariId(null);
    }
  };

  return (
    <div style={{ backgroundColor: "#f8fafc", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#0f172a", padding: "24px" }}>
      
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: "800", margin: 0, color: "#0f172a" }}>💱 Dönem Sonu Kur Farkı (Revalüasyon) Otomasyonu</h1>
          <p style={{ fontSize: "12px", color: "#64748b", margin: "4px 0 0 0" }}>
            Dövizli cari hesaplarınızın güncel TCMB kurlarına göre kur farkı kar/zararını analiz edin ve tek tıkla otomatik Kur Farkı Faturası kesin.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <Link href="/panel/cari" style={{ padding: "8px 16px", backgroundColor: "#e2e8f0", color: "#334155", borderRadius: "6px", textDecoration: "none", fontSize: "12px", fontWeight: "700" }}>
            ← Carilere Dön
          </Link>
          <button onClick={() => void raporYukle()} style={{ padding: "8px 16px", backgroundColor: "#0284c7", color: "#ffffff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>
            {yukleniyor ? "Hesaplanıyor..." : "↻ Değerlemeyi Yenile"}
          </button>
        </div>
      </div>

      {/* KPI Cards & TCMB Exchange Rates */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px", marginBottom: "24px" }}>
        <div style={{ backgroundColor: "#ffffff", padding: "18px 20px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
          <span style={{ fontSize: "12px", fontWeight: "600", color: "#64748b" }}>Güncel TCMB Kurları</span>
          <div style={{ fontSize: "14px", fontWeight: "800", color: "#0f172a", marginTop: "6px", display: "flex", gap: "16px" }}>
            <span>🇺🇸 USD: <strong style={{ color: "#0284c7" }}>{rapor?.guncelKurlar.USD || "—"} TL</strong></span>
            <span>🇪🇺 EUR: <strong style={{ color: "#0284c7" }}>{rapor?.guncelKurlar.EUR || "—"} TL</strong></span>
          </div>
        </div>

        <div style={{ backgroundColor: "#ffffff", padding: "18px 20px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
          <span style={{ fontSize: "12px", fontWeight: "600", color: "#64748b" }}>Fark Oluşan Cari Sayısı</span>
          <div style={{ fontSize: "22px", fontWeight: "800", color: "#0f172a", marginTop: "4px" }}>{rapor?.toplamCariSayisi || 0} Firma</div>
        </div>

        <div style={{ backgroundColor: "#ffffff", padding: "18px 20px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
          <span style={{ fontSize: "12px", fontWeight: "600", color: "#64748b" }}>Değerleme Tarihi</span>
          <div style={{ fontSize: "18px", fontWeight: "800", color: "#0284c7", marginTop: "4px" }}>{rapor?.degerlemeTarihi || "—"}</div>
        </div>
      </div>

      {basariMesaji && (
        <div style={{ backgroundColor: "#dcfce7", color: "#166534", padding: "12px 16px", borderRadius: "8px", marginBottom: "16px", fontSize: "13px", fontWeight: "700" }}>
          {basariMesaji}
        </div>
      )}

      {hata && (
        <div style={{ backgroundColor: "#fee2e2", color: "#dc2626", padding: "12px 16px", borderRadius: "8px", marginBottom: "16px", fontSize: "13px" }}>
          ⚠️ {hata}
        </div>
      )}

      {/* Main Table */}
      <div style={{ backgroundColor: "#ffffff", borderRadius: "10px", border: "1px solid #cbd5e1", overflow: "hidden", boxShadow: "0 2px 6px rgba(0,0,0,0.04)" }}>
        <div style={{ padding: "14px 20px", backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: "13px", fontWeight: "700", color: "#334155" }}>
          📊 Kur Farkı Oluşan Cari Hesaplar ve Revalüasyon Tablosu
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
            <thead>
              <tr style={{ backgroundColor: "#f1f5f9", color: "#475569", borderBottom: "2px solid #cbd5e1" }}>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Cari Kodu / Ünvan</th>
                <th style={{ padding: "10px 14px", textAlign: "center" }}>Döviz</th>
                <th style={{ padding: "10px 14px", textAlign: "right" }}>Döviz Bakiyesi</th>
                <th style={{ padding: "10px 14px", textAlign: "right" }}>Kayıtlı TRY Bakiyesi</th>
                <th style={{ padding: "10px 14px", textAlign: "right" }}>Güncel TCMB Kuru</th>
                <th style={{ padding: "10px 14px", textAlign: "right" }}>Güncel TRY Değeri</th>
                <th style={{ padding: "10px 14px", textAlign: "right" }}>Kur Farkı (Kar/Zarar)</th>
                <th style={{ padding: "10px 14px", textAlign: "center" }}>Otomatik Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {(rapor?.sonuclar || []).map((satir, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0", backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f8fafc" }}>
                  <td style={{ padding: "10px 14px", fontWeight: "700", color: "#0f172a" }}>
                    {satir.cariUnvan} <br />
                    <span style={{ fontSize: "10px", color: "#94a3b8" }}>{satir.cariKod}</span>
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "center", fontWeight: "800", color: "#0284c7" }}>{satir.dovizCinsi}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: "700" }}>
                    {satir.dovizBakiye.toLocaleString("tr-TR")} {satir.dovizCinsi}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: "#64748b" }}>{tl(satir.kayitliTryBakiye)}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: "700" }}>{satir.guncelKur} TL</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: "700" }}>{tl(satir.guncelTryDegeri)}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: "800", color: satir.kurFarkiTutari > 0 ? "#16a34a" : "#dc2626" }}>
                    {satir.kurFarkiTutari > 0 ? `+${tl(satir.kurFarkiTutari)} (Gelir)` : `${tl(satir.kurFarkiTutari)} (Gider)`}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}>
                    <button
                      disabled={islenenCariId === satir.cariId}
                      onClick={() => void faturaOlustur(satir)}
                      style={{
                        padding: "6px 12px",
                        backgroundColor: satir.faturaTipi === "satis" ? "#16a34a" : "#dc2626",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "6px",
                        fontSize: "11px",
                        fontWeight: "700",
                        cursor: "pointer",
                      }}
                    >
                      {islenenCariId === satir.cariId ? "Kesiliyor..." : `🧾 ${satir.faturaTipi === "satis" ? "Satış" : "Alış"} Kur Farkı Faturası Kes`}
                    </button>
                  </td>
                </tr>
              ))}

              {!(rapor?.sonuclar || []).length && (
                <tr>
                  <td colSpan={8} style={{ padding: "32px", textAlign: "center", color: "#94a3b8" }}>
                    Dövizli carilerinizde değerleme gerektiren kur farkı bulunamadı.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
