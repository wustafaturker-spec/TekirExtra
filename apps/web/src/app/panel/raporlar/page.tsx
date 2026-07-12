"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { stil } from "@/lib/stil";

interface EnvanterRapor {
  id: string;
  kod: string;
  ad: string;
  anaBirim: string;
  mevcutMiktar: string;
  ortalamaMaliyet: string;
  envanterDegeri: string;
  kritikSeviye: string | null;
  kritikAsimi: boolean;
}

interface YaslandirmaRapor {
  cari: { id: string; kod: string; unvan: string };
  yaslandirma: {
    guncel: number;
    gun0_30: number;
    gun31_60: number;
    gun61_90: number;
    gun90Ustu: number;
    toplam: number;
  };
}

interface KarZararRapor {
  genelCiro: string;
  genelMaliyet: string;
  genelKar: string;
  genelKarlilikYuzdesi: string;
  urunAnalizleri: {
    kod: string;
    ad: string;
    satilanMiktar: number;
    toplamCiro: string;
    toplamMaliyet: string;
    kar: string;
    karlilikYuzdesi: string;
  }[];
}

export default function RaporlarSayfasi() {
  const [sekme, setSekme] = useState<"envanter" | "yaslandirma" | "kar-zarar">("envanter");
  const [envanter, setEnvanter] = useState<EnvanterRapor[]>([]);
  const [yaslandirma, setYaslandirma] = useState<YaslandirmaRapor[]>([]);
  const [karZarar, setKarZarar] = useState<KarZararRapor | null>(null);
  const [hata, setHata] = useState("");

  const yukle = useCallback(async () => {
    try {
      if (sekme === "envanter") {
        setEnvanter(await api<EnvanterRapor[]>("/stok/rapor/envanter"));
      } else if (sekme === "yaslandirma") {
        setYaslandirma(await api<YaslandirmaRapor[]>("/cari/rapor/yaslandirma"));
      } else if (sekme === "kar-zarar") {
        setKarZarar(await api<KarZararRapor>("/rapor/kar-zarar"));
      }
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Rapor yüklenemedi");
    }
  }, [sekme]);

  useEffect(() => {
    if (tokenAl()) {
      void yukle();
    }
  }, [yukle]);

  return (
    <div>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: "bold", margin: 0 }}>📈 Raporlar & Analiz</h1>
        <p style={{ color: "#a1a1aa", fontSize: "0.9rem", margin: "0.25rem 0 0" }}>
          Şirketinizin güncel stok envanteri değerlerini, cari borç yaşlandırmalarını ve satış kârlılıklarını takip edin.
        </p>
      </div>

      {hata && <p style={stil.hata}>{hata}</p>}

      {/* ─── SEKME SEÇİCİ ───────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem", borderBottom: "1px solid #27272a", paddingBottom: "1rem" }}>
        <button
          onClick={() => setSekme("envanter")}
          style={{
            ...stil.dugmeMuted,
            color: sekme === "envanter" ? "#fafaf9" : "#a1a1aa",
            background: sekme === "envanter" ? "rgba(124, 58, 237, 0.15)" : "#27272a",
            borderColor: sekme === "envanter" ? "#7c3aed" : "#3f3f46",
          }}
        >
          📦 Envanter Değer Raporu
        </button>
        <button
          onClick={() => setSekme("yaslandirma")}
          style={{
            ...stil.dugmeMuted,
            color: sekme === "yaslandirma" ? "#fafaf9" : "#a1a1aa",
            background: sekme === "yaslandirma" ? "rgba(124, 58, 237, 0.15)" : "#27272a",
            borderColor: sekme === "yaslandirma" ? "#7c3aed" : "#3f3f46",
          }}
        >
          ⏳ Cari Borç Yaşlandırma (Aging)
        </button>
        <button
          onClick={() => setSekme("kar-zarar")}
          style={{
            ...stil.dugmeMuted,
            color: sekme === "kar-zarar" ? "#fafaf9" : "#a1a1aa",
            background: sekme === "kar-zarar" ? "rgba(124, 58, 237, 0.15)" : "#27272a",
            borderColor: sekme === "kar-zarar" ? "#7c3aed" : "#3f3f46",
          }}
        >
          📈 Kâr/Zarar Analizi
        </button>
      </div>

      {/* ─── ENVANTER TABLOSU ────────────────────────────────────────────────── */}
      {sekme === "envanter" && (
        <div style={stil.genisKart}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: "600", marginBottom: "1rem" }}>📦 Depodaki Ürünlerin Envanter Değerleri</h2>
          <table style={stil.tablo}>
            <thead>
              <tr>
                <th style={stil.tabloBaslik}>Ürün Kodu</th>
                <th style={stil.tabloBaslik}>Ürün Adı</th>
                <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Mevcut Miktar</th>
                <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Ort. Birim Maliyet</th>
                <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Toplam Envanter Değeri</th>
                <th style={stil.tabloBaslik}>Durum</th>
              </tr>
            </thead>
            <tbody>
              {envanter.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...stil.tabloHucre, textAlign: "center", color: "#a1a1aa" }}>Envanterde ürün bulunmuyor.</td>
                </tr>
              ) : (
                envanter.map((e) => (
                  <tr key={e.id}>
                    <td style={stil.tabloHucre}>{e.kod}</td>
                    <td style={{ ...stil.tabloHucre, fontWeight: "bold" }}>{e.ad}</td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right" }}>
                      {Number(e.mevcutMiktar).toLocaleString("tr-TR", { minimumFractionDigits: 0 })} {e.anaBirim}
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", color: "#6366f1" }}>
                      {Number(e.ortalamaMaliyet).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", fontWeight: "bold", color: "#22c55e" }}>
                      {Number(e.envanterDegeri).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                    </td>
                    <td style={stil.tabloHucre}>
                      {e.kritikAsimi ? (
                        <span style={{ color: "#ef4444", fontWeight: "bold", fontSize: "0.8rem", background: "rgba(239, 68, 68, 0.15)", padding: "0.25rem 0.5rem", borderRadius: 4 }}>
                          ⚠️ Kritik Stok
                        </span>
                      ) : (
                        <span style={{ color: "#22c55e", fontWeight: "bold", fontSize: "0.8rem", background: "rgba(34, 197, 94, 0.15)", padding: "0.25rem 0.5rem", borderRadius: 4 }}>
                          Normal
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── YASLANDIRMA TABLOSU ─────────────────────────────────────────────── */}
      {sekme === "yaslandirma" && (
        <div style={stil.genisKart}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: "600", marginBottom: "1rem" }}>⏳ Cari Vade Yaşlandırma Raporu</h2>
          <table style={stil.tablo}>
            <thead>
              <tr>
                <th style={stil.tabloBaslik}>Cari Ünvan</th>
                <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Vadesi Gelmemiş</th>
                <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>0 - 30 Gün</th>
                <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>31 - 60 Gün</th>
                <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>61 - 90 Gün</th>
                <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>90+ Gün</th>
                <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Toplam Bakiye</th>
              </tr>
            </thead>
            <tbody>
              {yaslandirma.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...stil.tabloHucre, textAlign: "center", color: "#a1a1aa" }}>Vadesi geçmiş borç bakiyesi olan cari bulunmuyor.</td>
                </tr>
              ) : (
                yaslandirma.map((y) => (
                  <tr key={y.cari.id}>
                    <td style={{ ...stil.tabloHucre, fontWeight: "bold" }}>
                      {y.cari.unvan}
                      <span style={{ display: "block", fontSize: "0.75rem", color: "#a1a1aa", fontWeight: "normal" }}>{y.cari.kod}</span>
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right" }}>
                      {y.yaslandirma.guncel.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", color: y.yaslandirma.gun0_30 > 0 ? "#eab308" : "#fafaf9" }}>
                      {y.yaslandirma.gun0_30.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", color: y.yaslandirma.gun31_60 > 0 ? "#f97316" : "#fafaf9" }}>
                      {y.yaslandirma.gun31_60.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", color: y.yaslandirma.gun61_90 > 0 ? "#f43f5e" : "#fafaf9" }}>
                      {y.yaslandirma.gun61_90.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", color: y.yaslandirma.gun90Ustu > 0 ? "#ef4444" : "#fafaf9", fontWeight: y.yaslandirma.gun90Ustu > 0 ? "bold" : "normal" }}>
                      {y.yaslandirma.gun90Ustu.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", fontWeight: "bold", color: "#6366f1" }}>
                      {y.yaslandirma.toplam.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── KAR/ZARAR TABLOSU ───────────────────────────────────────────────── */}
      {sekme === "kar-zarar" && karZarar && (
        <div style={stil.genisKart}>
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "2rem", borderBottom: "1px solid #27272a", paddingBottom: "1.5rem" }}>
            <div>
              <div style={{ color: "#a1a1aa", fontSize: "0.8rem" }}>Toplam Satış Cirosu</div>
              <div style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "0.25rem" }}>
                {Number(karZarar.genelCiro).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
              </div>
            </div>
            <div>
              <div style={{ color: "#a1a1aa", fontSize: "0.8rem" }}>Toplam Maliyet</div>
              <div style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "0.25rem", color: "#a1a1aa" }}>
                {Number(karZarar.genelMaliyet).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
              </div>
            </div>
            <div>
              <div style={{ color: "#a1a1aa", fontSize: "0.8rem" }}>Brüt Satış Kârı</div>
              <div style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "0.25rem", color: "#22c55e" }}>
                {Number(karZarar.genelKar).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
              </div>
            </div>
            <div>
              <div style={{ color: "#a1a1aa", fontSize: "0.8rem" }}>Karlılık Oranı</div>
              <div style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "0.25rem", color: "#7c3aed" }}>
                %{Number(karZarar.genelKarlilikYuzdesi).toFixed(2)}
              </div>
            </div>
          </div>

          <h3 style={{ fontSize: "1rem", fontWeight: "600", marginBottom: "1rem", color: "#a1a1aa" }}>Ürün Bazlı Kârlılık Kırılımı</h3>
          <table style={stil.tablo}>
            <thead>
              <tr>
                <th style={stil.tabloBaslik}>Ürün Kodu</th>
                <th style={stil.tabloBaslik}>Ürün Adı</th>
                <th style={stil.tabloBaslik}>Satılan Adet</th>
                <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Ciro</th>
                <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Maliyet</th>
                <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Kâr/Zarar</th>
                <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Karlılık Oranı</th>
              </tr>
            </thead>
            <tbody>
              {karZarar.urunAnalizleri.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...stil.tabloHucre, textAlign: "center", color: "#a1a1aa" }}>Satışı kesinleşmiş ürün bulunmuyor.</td>
                </tr>
              ) : (
                karZarar.urunAnalizleri.map((u) => (
                  <tr key={u.kod}>
                    <td style={stil.tabloHucre}>{u.kod}</td>
                    <td style={{ ...stil.tabloHucre, fontWeight: "bold" }}>{u.ad}</td>
                    <td style={stil.tabloHucre}>{u.satilanMiktar}</td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right" }}>
                      {Number(u.toplamCiro).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", color: "#a1a1aa" }}>
                      {Number(u.toplamMaliyet).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", color: Number(u.kar) >= 0 ? "#22c55e" : "#ef4444", fontWeight: "bold" }}>
                      {Number(u.kar).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", color: "#7c3aed", fontWeight: "bold" }}>
                      %{Number(u.karlilikYuzdesi).toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
