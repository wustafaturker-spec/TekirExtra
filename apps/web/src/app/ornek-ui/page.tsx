"use client";

import Link from "next/link";
import { useState } from "react";

export default function UIOrnekSayfasi() {
  const [activeTab, setActiveTab] = useState("ozet");

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f8fafc", color: "#0f172a", fontFamily: "system-ui, sans-serif" }}>
      {/* Header / Navigation Bar */}
      <header style={{ backgroundColor: "#ffffff", borderBottom: "1px solid #e2e8f0", padding: "16px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "linear-gradient(135deg, #e8792b 0%, #d76c1f 100%)", display: "flex", alignItems: "center", justifyContent: "center", color: "#ffffff", fontWeight: "bold", fontSize: "18px" }}>
            T
          </div>
          <div>
            <h1 style={{ fontSize: "18px", fontWeight: "700", margin: 0, lineHeight: 1.2 }}>TekirExtra <span style={{ fontSize: "11px", backgroundColor: "#fef3c7", color: "#b45309", padding: "2px 8px", borderRadius: "12px", fontWeight: "600" }}>PRO UI DEMO</span></h1>
            <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>Gelişmiş Ön Muhasebe & Finans Paneli</p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ position: "relative" }}>
            <input 
              type="text" 
              placeholder="Hızlı Arama (⌘K)..." 
              style={{ backgroundColor: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px 14px 8px 32px", fontSize: "13px", width: "240px", outline: "none" }}
            />
            <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", fontSize: "14px", color: "#94a3b8" }}>🔍</span>
          </div>
          <Link href="/panel" style={{ padding: "8px 16px", backgroundColor: "#e8792b", color: "#ffffff", borderRadius: "8px", textDecoration: "none", fontSize: "13px", fontWeight: "600", boxShadow: "0 2px 4px rgba(232, 121, 43, 0.2)" }}>
            Mevcut Panele Dön →
          </Link>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ maxWidth: "1280px", margin: "0 auto", padding: "32px 24px" }}>
        
        {/* Page Title & Quick Actions */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "24px" }}>
          <div>
            <h2 style={{ fontSize: "24px", fontWeight: "800", margin: "0 0 4px 0" }}>Finansal Durum & Analiz</h2>
            <p style={{ fontSize: "14px", color: "#64748b", margin: 0 }}>Bugünün canlı nakit akışı ve fatura operasyon özetiniz</p>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button style={{ padding: "10px 16px", backgroundColor: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "8px", fontSize: "13px", fontWeight: "600", cursor: "pointer", color: "#334155" }}>
              📥 Rapor Dışa Aktar
            </button>
            <button style={{ padding: "10px 16px", backgroundColor: "#0f172a", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: "600", cursor: "pointer", color: "#ffffff" }}>
              + Yeni Fatura Oluştur
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid #e2e8f0", marginBottom: "24px" }}>
          {["ozet", "tahsilatlar", "odemeler", "nakit-akisi"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "10px 16px",
                fontSize: "14px",
                fontWeight: activeTab === tab ? "700" : "500",
                color: activeTab === tab ? "#e8792b" : "#64748b",
                borderBottom: activeTab === tab ? "2px solid #e8792b" : "2px solid transparent",
                background: "none",
                border: "none",
                cursor: "pointer",
                textTransform: "capitalize"
              }}
            >
              {tab === "ozet" ? "Genel Özet" : tab === "tahsilatlar" ? "Bekleyen Tahsilatlar" : tab === "odemeler" ? "Gelecek Ödemeler" : "Nakit Akışı"}
            </button>
          ))}
        </div>

        {/* Top Metric Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "20px", marginBottom: "32px" }}>
          
          <div style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "13px", fontWeight: "500", marginBottom: "8px" }}>
              <span>Nakit & Banka Varlıkları</span>
              <span style={{ backgroundColor: "#dcfce7", color: "#15803d", padding: "2px 6px", borderRadius: "6px", fontSize: "11px", fontWeight: "700" }}>+12.4%</span>
            </div>
            <div style={{ fontSize: "26px", fontWeight: "800", color: "#0f172a", marginBottom: "4px" }}>₺1.428.500,00</div>
            <div style={{ fontSize: "12px", color: "#94a3b8" }}>3 farklı banka hesabında aktif bakiyeler</div>
          </div>

          <div style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "13px", fontWeight: "500", marginBottom: "8px" }}>
              <span>Beklenen Alacaklar</span>
              <span style={{ backgroundColor: "#fef3c7", color: "#b45309", padding: "2px 6px", borderRadius: "6px", fontSize: "11px", fontWeight: "700" }}>5 Vadesi Geçen</span>
            </div>
            <div style={{ fontSize: "26px", fontWeight: "800", color: "#0f172a", marginBottom: "4px" }}>₺342.180,50</div>
            <div style={{ fontSize: "12px", color: "#94a3b8" }}>Bu ay tahsil edilecek 14 adet fatura</div>
          </div>

          <div style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "13px", fontWeight: "500", marginBottom: "8px" }}>
              <span>Ödenecek Borçlar</span>
              <span style={{ backgroundColor: "#fee2e2", color: "#dc2626", padding: "2px 6px", borderRadius: "6px", fontSize: "11px", fontWeight: "700" }}>Bu Hafta</span>
            </div>
            <div style={{ fontSize: "26px", fontWeight: "800", color: "#0f172a", marginBottom: "4px" }}>₺189.400,00</div>
            <div style={{ fontSize: "12px", color: "#94a3b8" }}>Tedarikçilere ödenmesi gereken tutar</div>
          </div>

          <div style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "13px", fontWeight: "500", marginBottom: "8px" }}>
              <span>Net Stok Değeri</span>
              <span style={{ backgroundColor: "#f1f5f9", color: "#475569", padding: "2px 6px", borderRadius: "6px", fontSize: "11px", fontWeight: "700" }}>84 SKU</span>
            </div>
            <div style={{ fontSize: "26px", fontWeight: "800", color: "#0f172a", marginBottom: "4px" }}>₺895.000,00</div>
            <div style={{ fontSize: "12px", color: "#94a3b8" }}>Kritik stok seviyesinde 3 ürün var</div>
          </div>

        </div>

        {/* Content Section: Modern Table & Chart Placeholder */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "24px" }}>
          
          {/* Table Card */}
          <div style={{ backgroundColor: "#ffffff", borderRadius: "12px", border: "1px solid #e2e8f0", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "700", margin: 0 }}>Son Fatura İşlemleri</h3>
              <button style={{ fontSize: "13px", color: "#e8792b", fontWeight: "600", background: "none", border: "none", cursor: "pointer" }}>Tümünü Gör →</button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e2e8f0", color: "#64748b" }}>
                    <th style={{ padding: "10px 8px", fontWeight: "600" }}>Fatura No</th>
                    <th style={{ padding: "10px 8px", fontWeight: "600" }}>Müşteri / Cari</th>
                    <th style={{ padding: "10px 8px", fontWeight: "600" }}>Vade Tarihi</th>
                    <th style={{ padding: "10px 8px", fontWeight: "600" }}>Durum</th>
                    <th style={{ padding: "10px 8px", fontWeight: "600", textAlign: "right" }}>Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { no: "FTR-2026-00412", cari: "ACME Lojistik A.Ş.", vade: "24 Ağu 2026", durum: "Tahsil Edildi", durumRenk: "#dcfce7", durumYazi: "#15803d", tutar: "₺45.200,00" },
                    { no: "FTR-2026-00411", cari: "TeknoSoft Yazılım Ltd.", vade: "28 Ağu 2026", durum: "Bekliyor", durumRenk: "#fef3c7", durumYazi: "#b45309", tutar: "₺18.900,00" },
                    { no: "FTR-2026-00410", cari: "Kutup Gıda Tedarik", vade: "18 Ağu 2026", durum: "Gecikmede", durumRenk: "#fee2e2", durumYazi: "#dc2626", tutar: "₺128.450,00" },
                    { no: "FTR-2026-00409", cari: "Bosphorus Mimarlık", vade: "02 Eylül 2026", durum: "Taslak", durumRenk: "#f1f5f9", durumYazi: "#475569", tutar: "₺9.600,00" },
                  ].map((row, index) => (
                    <tr key={index} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "12px 8px", fontWeight: "600", color: "#0f172a" }}>{row.no}</td>
                      <td style={{ padding: "12px 8px", color: "#334155" }}>{row.cari}</td>
                      <td style={{ padding: "12px 8px", color: "#64748b" }}>{row.vade}</td>
                      <td style={{ padding: "12px 8px" }}>
                        <span style={{ backgroundColor: row.durumRenk, color: row.durumYazi, padding: "3px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: "700" }}>
                          {row.durum}
                        </span>
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: "700", color: "#0f172a" }}>{row.tutar}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Info / Action Card */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ backgroundColor: "#ffffff", borderRadius: "12px", border: "1px solid #e2e8f0", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <h3 style={{ fontSize: "15px", fontWeight: "700", margin: "0 0 12px 0" }}>Hızlı İşlemler</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <button style={{ padding: "10px 12px", backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", textAlign: "left", fontSize: "13px", fontWeight: "600", cursor: "pointer", color: "#334155" }}>
                  📄 e-Fatura / e-Arşiv Gönder
                </button>
                <button style={{ padding: "10px 12px", backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", textAlign: "left", fontSize: "13px", fontWeight: "600", cursor: "pointer", color: "#334155" }}>
                  💳 Banka Ekstresi İçe Aktar (Excel)
                </button>
                <button style={{ padding: "10px 12px", backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", textAlign: "left", fontSize: "13px", fontWeight: "600", cursor: "pointer", color: "#334155" }}>
                  👥 Yeni Cari Müşteri Ekle
                </button>
              </div>
            </div>

            <div style={{ backgroundColor: "#fff7ed", borderRadius: "12px", border: "1px solid #ffedd5", padding: "20px" }}>
              <div style={{ fontSize: "12px", color: "#ea580c", fontWeight: "700", textTransform: "uppercase", marginBottom: "4px" }}>AI İpucu</div>
              <h4 style={{ fontSize: "14px", fontWeight: "700", color: "#9a3412", margin: "0 0 6px 0" }}>Tahsilat Gecikme Uyarısı</h4>
              <p style={{ fontSize: "12px", color: "#c2410c", margin: 0, lineHeight: 1.5 }}>
                Kutup Gıda Tedarik firmasına ait ₺128.450,00 tutarındaki faturanın vadesi 5 gün geçti. Otomatik hatırlatma e-postası gönderebilirsiniz.
              </p>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
