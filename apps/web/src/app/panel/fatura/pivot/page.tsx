"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, tokenAl } from "@/lib/api";

interface FaturaSatirPivot {
  faturaId: string;
  faturaNo: string;
  tarih: string;
  yil: string;
  ay: string;
  vadeTarihi: string;
  yon: "satis" | "alis";
  tip: string;
  durum: string;
  cariUnvan: string;
  cariKod: string;
  depo: string;
  stokKod: string;
  stokAd: string;
  kategori: string;
  miktar: number;
  birimFiyat: number;
  iskontoTutari: number;
  matrah: number;
  kdvTutari: number;
  toplamTutar: number;
  dovizCinsi: string;
}

type GruplamaAlani = "cariUnvan" | "stokAd" | "tip" | "durum" | "yil" | "ay" | "depo";
type MetrikAlani = "toplamTutar" | "matrah" | "kdvTutari" | "miktar" | "iskontoTutari" | "ortalamaBirimFiyat";

const alanAdi: Record<GruplamaAlani, string> = {
  cariUnvan: "Müşteri / Tedarikçi (Cari)",
  stokAd: "Ürün / Hizmet",
  tip: "Fatura Tipi",
  durum: "İşlem Durumu",
  yil: "Yıl",
  ay: "Ay",
  depo: "Depo",
};

const metrikAdi: Record<MetrikAlani, string> = {
  toplamTutar: "Genel Toplam (KDV Dahil)",
  matrah: "Matrah (Net Ara Toplam)",
  ortalamaBirimFiyat: "Ortalama Birim Fiyat",
  kdvTutari: "KDV Tutari",
  miktar: "Miktar",
  iskontoTutari: "İskonto Tutari",
};

export default function OdooPivotSayfasi() {
  const [veriler, setVeriler] = useState<FaturaSatirPivot[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");

  // Odoo Stil Filtre ve Boyut Seçimleri
  const [satirBoyutu, setSatirBoyutu] = useState<GruplamaAlani>("cariUnvan");
  const [sutunBoyutu, setSutunBoyutu] = useState<GruplamaAlani>("tip");
  const [seciliMetrik, setSeciliMetrik] = useState<MetrikAlani>("toplamTutar");

  // Filtreler
  const [yonFiltresi, setYonFiltresi] = useState<"tum" | "satis" | "alis">("tum");
  const [durumFiltresi, setDurumFiltresi] = useState<string>("tum");
  const [arama, setArama] = useState("");
  const [acikSatirlar, setAcikSatirlar] = useState<Record<string, boolean>>({});

  const veriYukle = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      const fVeri = await api<{ kayitlar: any[] }>("/fatura?adet=300");
      const duzlesmis: FaturaSatirPivot[] = [];

      fVeri.kayitlar.forEach((f) => {
        const yon = f.tip.includes("satis") ? "satis" : "alis";
        const t = f.tarih ? new Date(f.tarih) : new Date();
        const yil = t.getFullYear().toString();
        const ay = (t.getMonth() + 1).toString().padStart(2, "0") + " - " + t.toLocaleString("tr-TR", { month: "long" });

        if (f.satirlar && f.satirlar.length > 0) {
          f.satirlar.forEach((s: any) => {
            const miktar = Number(s.miktar || 0);
            const birimFiyat = Number(s.birimFiyat || 0);
            const iskontoOrani = Number(s.iskontoOrani || 0);
            const kdvOrani = Number(s.kdvOrani || 0);
            const brut = miktar * birimFiyat;
            const iskontoTutari = (brut * iskontoOrani) / 100;
            const matrah = brut - iskontoTutari;
            const kdvTutari = (matrah * kdvOrani) / 100;
            const toplamTutar = matrah + kdvTutari;

            const urunIsmi = s.stok?.ad || s.stokAd || s.aciklama || s.ad || (s.stokId ? `Ürün (${s.stokId.slice(0, 6)})` : "Genel Hizmet/Ürün");
            const urunKodu = s.stok?.kod || s.stokKod || s.kod || "—";

            duzlesmis.push({
              faturaId: f.id,
              faturaNo: f.no || "Taslak",
              tarih: f.tarih ? f.tarih.slice(0, 10) : "—",
              yil,
              ay,
              vadeTarihi: f.vadeTarihi ? f.vadeTarihi.slice(0, 10) : "—",
              yon,
              tip: f.tip === "satis" ? "Satış Faturası" : f.tip === "alis" ? "Alış Faturası" : f.tip,
              durum: f.durum === "kesin" ? "Kesinleşmiş" : f.durum === "taslak" ? "Taslak" : f.durum,
              cariUnvan: f.cari?.unvan || "Tanımsız Cari",
              cariKod: f.cari?.kod || "—",
              depo: f.depo?.ad || "Ana Depo",
              stokKod: urunKodu,
              stokAd: urunIsmi,
              kategori: s.stok?.kategori || "Kategorisiz",
              miktar,
              birimFiyat,
              iskontoTutari,
              matrah,
              kdvTutari,
              toplamTutar,
              dovizCinsi: f.dovizCinsi || "TRY",
            });
          });
        } else {
          // Satır bulunamayan faturalar için fatura üst bilgilerini ekle
          const genelToplam = Number(f.genelToplam || 0);
          const matrah = Number(f.araToplam || genelToplam);
          const kdvTutari = Number(f.kdvToplam || 0);

          duzlesmis.push({
            faturaId: f.id,
            faturaNo: f.no || "Taslak",
            tarih: f.tarih ? f.tarih.slice(0, 10) : "—",
            yil,
            ay,
            vadeTarihi: f.vadeTarihi ? f.vadeTarihi.slice(0, 10) : "—",
            yon,
            tip: f.tip === "satis" ? "Satış Faturası" : f.tip === "alis" ? "Alış Faturası" : f.tip,
            durum: f.durum === "kesin" ? "Kesinleşmiş" : f.durum === "taslak" ? "Taslak" : f.durum,
            cariUnvan: f.cari?.unvan || "Tanımsız Cari",
            cariKod: f.cari?.kod || "—",
            depo: f.depo?.ad || "Ana Depo",
            stokKod: "—",
            stokAd: "Genel Kalem",
            kategori: "Genel",
            miktar: 1,
            birimFiyat: matrah,
            iskontoTutari: 0,
            matrah,
            kdvTutari,
            toplamTutar: genelToplam,
            dovizCinsi: f.dovizCinsi || "TRY",
          });
        }
      });

      setVeriler(duzlesmis);
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Pivot verileri alınamadı");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) void veriYukle();
  }, [veriYukle]);

  // Filtrelenmiş veri seti
  const filtrelenmis = useMemo(() => {
    return veriler.filter((item) => {
      if (yonFiltresi !== "tum" && item.yon !== yonFiltresi) return false;
      if (durumFiltresi !== "tum" && item.durum !== durumFiltresi) return false;
      if (arama.trim()) {
        const q = arama.toLowerCase();
        return (
          item.faturaNo.toLowerCase().includes(q) ||
          item.cariUnvan.toLowerCase().includes(q) ||
          item.stokAd.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [veriler, yonFiltresi, durumFiltresi, arama]);

  // ─── ODOO MATRİS (PIVOT MATRIX) HESAPLAMA ──────────────────────────────
  const { sutunValuelari, satirValuelari, matris, sutunToplamlari, satirToplamlari, genelToplam } = useMemo(() => {
    const sSet = new Set<string>();
    const rSet = new Set<string>();

    filtrelenmis.forEach((item) => {
      sSet.add(String(item[sutunBoyutu] || "Bilinmeyen"));
      rSet.add(String(item[satirBoyutu] || "Bilinmeyen"));
    });

    const sutunListesi = Array.from(sSet).sort();
    const satirListesi = Array.from(rSet).sort();

    const grid: Record<string, Record<string, number>> = {};
    const gridAdet: Record<string, Record<string, number>> = {};
    const gridMiktar: Record<string, Record<string, number>> = {};
    const gridMatrah: Record<string, Record<string, number>> = {};

    const colTot: Record<string, number> = {};
    const colMiktarTot: Record<string, number> = {};
    const colMatrahTot: Record<string, number> = {};

    const rowTot: Record<string, number> = {};
    const rowMiktarTot: Record<string, number> = {};
    const rowMatrahTot: Record<string, number> = {};

    let grandTot = 0;
    let grandMiktarTot = 0;
    let grandMatrahTot = 0;

    satirListesi.forEach((r) => {
      grid[r] = {}; gridAdet[r] = {}; gridMiktar[r] = {}; gridMatrah[r] = {};
      rowTot[r] = 0; rowMiktarTot[r] = 0; rowMatrahTot[r] = 0;
      sutunListesi.forEach((c) => {
        grid[r][c] = 0; gridAdet[r][c] = 0; gridMiktar[r][c] = 0; gridMatrah[r][c] = 0;
      });
    });

    sutunListesi.forEach((c) => { colTot[c] = 0; colMiktarTot[c] = 0; colMatrahTot[c] = 0; });

    filtrelenmis.forEach((item) => {
      const rVal = String(item[satirBoyutu] || "Bilinmeyen");
      const cVal = String(item[sutunBoyutu] || "Bilinmeyen");
      
      const deger = Number(item[seciliMetrik === "ortalamaBirimFiyat" ? "matrah" : seciliMetrik] || 0);
      const miktar = item.miktar || 1;
      const matrah = item.matrah || 0;

      grid[rVal][cVal] += deger;
      gridAdet[rVal][cVal] += 1;
      gridMiktar[rVal][cVal] += miktar;
      gridMatrah[rVal][cVal] += matrah;

      rowTot[rVal] += deger;
      rowMiktarTot[rVal] += miktar;
      rowMatrahTot[rVal] += matrah;

      colTot[cVal] += deger;
      colMiktarTot[cVal] += miktar;
      colMatrahTot[cVal] += matrah;

      grandTot += deger;
      grandMiktarTot += miktar;
      grandMatrahTot += matrah;
    });

    // Eğer ortalama birim fiyat metriği seçildiyse: Matrah / Miktar (Ağırlıklı Ortalama Birim Fiyat)
    const finalGrid: Record<string, Record<string, number>> = {};
    const finalRowTot: Record<string, number> = {};
    const finalColTot: Record<string, number> = {};
    let finalGrandTot = grandTot;

    if (seciliMetrik === "ortalamaBirimFiyat") {
      satirListesi.forEach((r) => {
        finalGrid[r] = {};
        sutunListesi.forEach((c) => {
          finalGrid[r][c] = gridMiktar[r][c] > 0 ? gridMatrah[r][c] / gridMiktar[r][c] : 0;
        });
        finalRowTot[r] = rowMiktarTot[r] > 0 ? rowMatrahTot[r] / rowMiktarTot[r] : 0;
      });

      sutunListesi.forEach((c) => {
        finalColTot[c] = colMiktarTot[c] > 0 ? colMatrahTot[c] / colMiktarTot[c] : 0;
      });

      finalGrandTot = grandMiktarTot > 0 ? grandMatrahTot / grandMiktarTot : 0;
    } else {
      satirListesi.forEach((r) => {
        finalGrid[r] = grid[r];
        finalRowTot[r] = rowTot[r];
      });
      sutunListesi.forEach((c) => {
        finalColTot[c] = colTot[c];
      });
    }

    return {
      sutunValuelari: sutunListesi,
      satirValuelari: satirListesi,
      matris: finalGrid,
      sutunToplamlari: finalColTot,
      satirToplamlari: finalRowTot,
      genelToplam: finalGrandTot,
    };
  }, [filtrelenmis, satirBoyutu, sutunBoyutu, seciliMetrik]);

  const paraFormati = (deger: number) => {
    if (seciliMetrik === "miktar") return deger.toLocaleString("tr-TR") + " adet";
    return deger.toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
  };

  const satirAcsat = (satir: string) => {
    setAcikSatirlar((prev) => ({ ...prev, [satir]: !prev[satir] }));
  };

  return (
    <div style={{ backgroundColor: "#f1f5f9", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#1e293b" }}>
      
      {/* Top Navbar / Header (Odoo Style) */}
      <div style={{ backgroundColor: "#714b67", color: "#ffffff", padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ backgroundColor: "#ffffff", color: "#714b67", width: "32px", height: "32px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "900", fontSize: "16px" }}>
            O
          </div>
          <div>
            <h1 style={{ fontSize: "18px", fontWeight: "700", margin: 0 }}>Fatura Pivot Analiz Matrisi</h1>
            <span style={{ fontSize: "11px", opacity: 0.85 }}>Çapraz Satır / Sütun Boyutlandırma & Canlı Metrik Toplamları</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Link href="/panel/fatura" style={{ padding: "6px 14px", backgroundColor: "rgba(255,255,255,0.15)", color: "#ffffff", borderRadius: "6px", textDecoration: "none", fontSize: "12px", fontWeight: "600" }}>
            ← Faturaya Dön
          </Link>
          <button onClick={() => void veriYukle()} style={{ padding: "6px 14px", backgroundColor: "#00a09d", color: "#ffffff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>
            {yukleniyor ? "Yükleniyor..." : "↻ Yenile"}
          </button>
        </div>
      </div>

      {/* Control Bar (Odoo Dimension & Measure Selectors) */}
      <div style={{ backgroundColor: "#ffffff", borderBottom: "1px solid #cbd5e1", padding: "16px 24px", display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "center", justifyContent: "space-between" }}>
        
        {/* Measure Selectors (Odoo Measures Dropdown) */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "12px", fontWeight: "800", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>Metrik (Measure):</span>
          <div style={{ display: "flex", gap: "4px", backgroundColor: "#f8fafc", padding: "4px", borderRadius: "8px", border: "1px solid #cbd5e1" }}>
            {(Object.keys(metrikAdi) as MetrikAlani[]).map((mKey) => (
              <button
                key={mKey}
                onClick={() => setSeciliMetrik(mKey)}
                style={{
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: seciliMetrik === mKey ? "700" : "500",
                  backgroundColor: seciliMetrik === mKey ? "#714b67" : "transparent",
                  color: seciliMetrik === mKey ? "#ffffff" : "#475569",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  transition: "all 0.15s"
                }}
              >
                {metrikAdi[mKey]}
              </button>
            ))}
          </div>
        </div>

        {/* Row & Column Dimension Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: "700", color: "#475569" }}>Satır (Row):</span>
            <select
              value={satirBoyutu}
              onChange={(e) => setSatirBoyutu(e.target.value as GruplamaAlani)}
              style={{ padding: "6px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "12px", fontWeight: "600", color: "#0f172a", backgroundColor: "#ffffff" }}
            >
              {(Object.keys(alanAdi) as GruplamaAlani[]).map((key) => (
                <option key={key} value={key}>{alanAdi[key]}</option>
              ))}
            </select>
          </div>

          <span style={{ fontSize: "14px", color: "#94a3b8" }}>✖</span>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: "700", color: "#475569" }}>Sütun (Column):</span>
            <select
              value={sutunBoyutu}
              onChange={(e) => setSutunBoyutu(e.target.value as GruplamaAlani)}
              style={{ padding: "6px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "12px", fontWeight: "600", color: "#0f172a", backgroundColor: "#ffffff" }}
            >
              {(Object.keys(alanAdi) as GruplamaAlani[]).map((key) => (
                <option key={key} value={key}>{alanAdi[key]}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Search & Quick Filters */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <select
            value={yonFiltresi}
            onChange={(e) => setYonFiltresi(e.target.value as any)}
            style={{ padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "12px" }}
          >
            <option value="tum">Tüm Yönler</option>
            <option value="satis">Satış Faturaları</option>
            <option value="alis">Alış Faturaları</option>
          </select>

          <input
            type="text"
            placeholder="🔍 Hızlı Filtrele..."
            value={arama}
            onChange={(e) => setArama(e.target.value)}
            style={{ padding: "6px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "12px", width: "160px" }}
          />
        </div>

      </div>

      {/* Main Odoo Pivot Table Matrix */}
      <main style={{ padding: "24px", maxWidth: "1600px", margin: "0 auto" }}>
        
        {hata && (
          <div style={{ backgroundColor: "#fee2e2", color: "#dc2626", padding: "12px 16px", borderRadius: "8px", marginBottom: "16px", fontSize: "13px" }}>
            ⚠️ {hata}
          </div>
        )}

        <div style={{ backgroundColor: "#ffffff", borderRadius: "10px", border: "1px solid #cbd5e1", boxShadow: "0 4px 12px rgba(0,0,0,0.05)", overflow: "hidden" }}>
          
          {/* Matrix Header */}
          <div style={{ padding: "14px 20px", backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#334155" }}>
              Gruplama: <span style={{ color: "#714b67" }}>{alanAdi[satirBoyutu]}</span> / <span style={{ color: "#00a09d" }}>{alanAdi[sutunBoyutu]}</span>
            </div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              Toplam {filtrelenmis.length} satır veriden oluşturuldu.
            </div>
          </div>

          {/* Table Element */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "12px" }}>
              
              <thead>
                {/* Top Column Dimension Header */}
                <tr style={{ backgroundColor: "#e2e8f0", color: "#0f172a" }}>
                  <th style={{ padding: "12px 16px", borderRight: "1px solid #cbd5e1", minWidth: "220px", fontWeight: "800" }}>
                    {alanAdi[satirBoyutu]} \ {alanAdi[sutunBoyutu]}
                  </th>
                  {sutunValuelari.map((colName) => (
                    <th key={colName} style={{ padding: "12px 16px", textAlign: "right", borderRight: "1px solid #cbd5e1", fontWeight: "700", color: "#00a09d" }}>
                      {colName}
                    </th>
                  ))}
                  <th style={{ padding: "12px 16px", textAlign: "right", backgroundColor: "#cbd5e1", color: "#0f172a", fontWeight: "800" }}>
                    SATIR TOPLAMI
                  </th>
                </tr>
              </thead>

              <tbody>
                {satirValuelari.map((rowName, idx) => {
                  const isExpanded = acikSatirlar[rowName];
                  const altSatirlar = filtrelenmis.filter((item) => String(item[satirBoyutu] || "Bilinmeyen") === rowName);

                  return (
                    <Fragment key={rowName}>
                      <tr style={{ borderBottom: "1px solid #e2e8f0", backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f8fafc" }}>
                        
                        {/* Row Label Cell */}
                        <td style={{ padding: "10px 16px", borderRight: "1px solid #e2e8f0", fontWeight: "700", color: "#0f172a" }}>
                          <button
                            type="button"
                            onClick={() => satirAcsat(rowName)}
                            style={{ background: "#e2e8f0", border: "none", borderRadius: "4px", cursor: "pointer", marginRight: "8px", color: "#334155", fontSize: "11px", padding: "2px 6px", fontWeight: "bold" }}
                          >
                            {isExpanded ? "▼" : "▶"}
                          </button>
                          {rowName}
                          <span style={{ fontSize: "10px", color: "#94a3b8", marginLeft: "6px", fontWeight: "normal" }}>({altSatirlar.length} kalem)</span>
                        </td>

                        {/* Matrix Value Cells */}
                        {sutunValuelari.map((colName) => {
                          const val = matris[rowName][colName];
                          return (
                            <td key={colName} style={{ padding: "10px 16px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: val > 0 ? "#0f172a" : "#cbd5e1", fontWeight: val > 0 ? "600" : "normal" }}>
                              {val > 0 ? paraFormati(val) : "—"}
                            </td>
                          );
                        })}

                        {/* Row Total Cell */}
                        <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: "800", color: "#714b67", backgroundColor: "rgba(113, 75, 103, 0.05)" }}>
                          {paraFormati(satirToplamlari[rowName])}
                        </td>

                      </tr>

                      {/* Expanded Sub-rows (Drill-Down Sub-Items) */}
                      {isExpanded && (
                        <tr style={{ backgroundColor: "#f1f5f9" }}>
                          <td colSpan={sutunValuelari.length + 2} style={{ padding: "12px 20px" }}>
                            <div style={{ backgroundColor: "#ffffff", borderRadius: "8px", border: "1px solid #cbd5e1", padding: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                              <div style={{ fontSize: "12px", fontWeight: "700", color: "#714b67", marginBottom: "8px" }}>
                                📂 {rowName} Grubu Detay Kalemleri:
                              </div>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                                <thead>
                                  <tr style={{ borderBottom: "1px solid #e2e8f0", color: "#64748b" }}>
                                    <th style={{ padding: "6px 8px", textAlign: "left" }}>Fatura No</th>
                                    <th style={{ padding: "6px 8px", textAlign: "left" }}>Tarih</th>
                                    <th style={{ padding: "6px 8px", textAlign: "left" }}>Ürün/Hizmet</th>
                                    <th style={{ padding: "6px 8px", textAlign: "left" }}>Müşteri/Cari</th>
                                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Miktar</th>
                                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Birim Fiyat</th>
                                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Toplam Tutar</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {altSatirlar.map((item, subIdx) => (
                                    <tr key={subIdx} style={{ borderBottom: "1px solid #f8fafc" }}>
                                      <td style={{ padding: "6px 8px", fontWeight: "700", color: "#0f172a" }}>{item.faturaNo}</td>
                                      <td style={{ padding: "6px 8px", color: "#64748b" }}>{item.tarih}</td>
                                      <td style={{ padding: "6px 8px", color: "#334155" }}>{item.stokAd}</td>
                                      <td style={{ padding: "6px 8px", color: "#334155" }}>{item.cariUnvan}</td>
                                      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "600" }}>{item.miktar}</td>
                                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{paraFormati(item.birimFiyat)}</td>
                                      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "800", color: "#714b67" }}>{paraFormati(item.toplamTutar)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}

                {!satirValuelari.length && (
                  <tr>
                    <td colSpan={sutunValuelari.length + 2} style={{ padding: "32px", textAlign: "center", color: "#94a3b8" }}>
                      Gösterilecek uygun veri bulunamadı.
                    </td>
                  </tr>
                )}
              </tbody>

              {/* Column Totals Footer */}
              <tfoot>
                <tr style={{ backgroundColor: "#f1f5f9", borderTop: "2px solid #cbd5e1", fontWeight: "800", color: "#0f172a" }}>
                  <td style={{ padding: "14px 16px", borderRight: "1px solid #cbd5e1" }}>
                    SÜTUN TOPLAMLARI
                  </td>
                  {sutunValuelari.map((colName) => (
                    <td key={colName} style={{ padding: "14px 16px", textAlign: "right", borderRight: "1px solid #cbd5e1", color: "#00a09d" }}>
                      {paraFormati(sutunToplamlari[colName])}
                    </td>
                  ))}
                  <td style={{ padding: "14px 16px", textAlign: "right", backgroundColor: "#714b67", color: "#ffffff", fontSize: "13px" }}>
                    {paraFormati(genelToplam)}
                  </td>
                </tr>
              </tfoot>

            </table>
          </div>

        </div>

      </main>

    </div>
  );
}
