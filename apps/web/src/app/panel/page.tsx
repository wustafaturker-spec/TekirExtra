"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiHata, tokenAl, tokenYaz } from "@/lib/api";
import { stil } from "@/lib/stil";

interface Firma {
  unvan: string;
  vkn: string;
}

interface FinansOzet {
  nakitVarliklar: string;
  envanterDegeri: string;
  toplamAlacaklar: string;
  toplamBorclar: string;
  netVarlikDegeri: string;
}

interface KarMarjiSatiri {
  grup: string;
  ciro: string;
  maliyet: string;
  kar: string;
  marj: number | null;
}

export default function PanelSayfasi() {
  const yonlendir = useRouter();
  const [firma, setFirma] = useState<Firma | null>(null);
  const [ozet, setOzet] = useState<FinansOzet | null>(null);
  const [rapor, setRapor] = useState<KarMarjiSatiri[] | null>(null);
  const [hata, setHata] = useState("");

  const yukle = useCallback(async () => {
    try {
      setFirma(await api<Firma>("/firma"));
      setOzet(await api<FinansOzet>("/rapor/ozet"));
      // Kâr marjı raporu RPR-06 araç setinden (fatura.kar-marji, ürün kırılımı)
      const karMarji = await api<{ satirlar: KarMarjiSatiri[] }>(
        "/raporlar/fatura.kar-marji/calistir",
        { method: "POST", body: JSON.stringify({ gruplama: "urun" }) },
      );
      setRapor(karMarji.satirlar);
    } catch (h) {
      if (h instanceof ApiHata && h.durum === 401) {
        tokenYaz(null);
        yonlendir.push("/giris");
      } else {
        setHata(h instanceof Error ? h.message : "Yükleme hatası");
      }
    }
  }, [yonlendir]);

  useEffect(() => {
    if (!tokenAl()) {
      yonlendir.push("/giris");
      return;
    }
    void yukle();
  }, [yonlendir, yukle]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "2rem", fontWeight: "bold", margin: 0 }}>
            {firma?.unvan ?? "Yükleniyor…"}
          </h1>
          <p style={{ color: "#a1a1aa", fontSize: "0.9rem", margin: "0.25rem 0 0" }}>
            Hoş geldiniz. Şirketinizin anlık finansal durum özeti aşağıdadır.
          </p>
        </div>
      </div>

      {hata && <p style={stil.hata}>{hata}</p>}

      {ozet && (
        <section style={{ marginBottom: "3rem" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: "600", marginBottom: "1rem", color: "#a1a1aa" }}>
            💰 Finansal Durum Özeti
          </h2>
          <div style={stil.grid}>
            <div style={stil.ozetKart}>
              <div style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>Nakit Varlıklar (Kasa/Banka)</div>
              <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#22c55e", marginTop: "0.5rem" }}>
                {Number(ozet.nakitVarliklar).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
              </div>
            </div>
            <div style={stil.ozetKart}>
              <div style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>Stok Envanter Değeri</div>
              <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#6366f1", marginTop: "0.5rem" }}>
                {Number(ozet.envanterDegeri).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
              </div>
            </div>
            <div style={stil.ozetKart}>
              <div style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>Toplam Müşteri Alacakları</div>
              <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#3b82f6", marginTop: "0.5rem" }}>
                {Number(ozet.toplamAlacaklar).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
              </div>
            </div>
            <div style={stil.ozetKart}>
              <div style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>Toplam Tedarikçi Borçları</div>
              <div style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#ef4444", marginTop: "0.5rem" }}>
                {Number(ozet.toplamBorclar).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
              </div>
            </div>
          </div>
          
          <div style={{ ...stil.ozetKart, marginTop: "1.5rem", background: "linear-gradient(90deg, rgba(124, 58, 237, 0.2) 0%, rgba(79, 70, 229, 0.2) 100%)", border: "1px solid rgba(124, 58, 237, 0.4)" }}>
            <div style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>Konsolide Net Varlık Değeri</div>
            <div style={{ fontSize: "2rem", fontWeight: "bold", color: "#fafaf9", marginTop: "0.5rem" }}>
              {Number(ozet.netVarlikDegeri).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
            </div>
          </div>
        </section>
      )}

      {rapor && (() => {
        const toplam = rapor.reduce(
          (t, u) => ({
            ciro: t.ciro + Number(u.ciro),
            maliyet: t.maliyet + Number(u.maliyet),
            kar: t.kar + Number(u.kar),
          }),
          { ciro: 0, maliyet: 0, kar: 0 },
        );
        const marj = toplam.ciro > 0 ? (toplam.kar / toplam.ciro) * 100 : 0;
        return (
          <section style={stil.genisKart}>
            <h2 style={{ fontSize: "1.2rem", fontWeight: "600", marginBottom: "1rem" }}>
              📈 Satış Kârlılık ve Kar/Zarar Analizi
            </h2>
            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "2rem", borderBottom: "1px solid #27272a", paddingBottom: "1.5rem" }}>
              <div>
                <div style={{ color: "#a1a1aa", fontSize: "0.8rem" }}>Toplam Ciro</div>
                <div style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "0.25rem" }}>
                  {toplam.ciro.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                </div>
              </div>
              <div>
                <div style={{ color: "#a1a1aa", fontSize: "0.8rem" }}>Toplam Maliyet</div>
                <div style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "0.25rem", color: "#a1a1aa" }}>
                  {toplam.maliyet.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                </div>
              </div>
              <div>
                <div style={{ color: "#a1a1aa", fontSize: "0.8rem" }}>Net Satış Kârı</div>
                <div style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "0.25rem", color: "#22c55e" }}>
                  {toplam.kar.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                </div>
              </div>
              <div>
                <div style={{ color: "#a1a1aa", fontSize: "0.8rem" }}>Kârlılık Oranı</div>
                <div style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "0.25rem", color: "#7c3aed" }}>
                  %{marj.toFixed(2)}
                </div>
              </div>
            </div>

            <h3 style={{ fontSize: "1rem", fontWeight: "600", marginBottom: "1rem", color: "#a1a1aa" }}>
              Ürün Bazlı Kârlılık Kırılımı
            </h3>
            <table style={stil.tablo}>
              <thead>
                <tr>
                  <th style={stil.tabloBaslik}>Ürün</th>
                  <th style={stil.tabloBaslik}>Toplam Ciro</th>
                  <th style={stil.tabloBaslik}>Maliyet</th>
                  <th style={stil.tabloBaslik}>Kâr/Zarar</th>
                  <th style={stil.tabloBaslik}>Kârlılık Oranı</th>
                </tr>
              </thead>
              <tbody>
                {rapor.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ ...stil.tabloHucre, textAlign: "center", color: "#a1a1aa" }}>
                      Henüz kesinleşmiş satış faturası bulunmuyor.
                    </td>
                  </tr>
                ) : (
                  rapor.map((u) => (
                    <tr key={u.grup}>
                      <td style={stil.tabloHucre}>{u.grup}</td>
                      <td style={stil.tabloHucre}>{Number(u.ciro).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL</td>
                      <td style={stil.tabloHucre}>{Number(u.maliyet).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL</td>
                      <td style={{ ...stil.tabloHucre, color: Number(u.kar) >= 0 ? "#22c55e" : "#ef4444", fontWeight: "bold" }}>
                        {Number(u.kar).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                      </td>
                      <td style={{ ...stil.tabloHucre, color: "#7c3aed", fontWeight: "bold" }}>
                        {u.marj === null ? "—" : `%${u.marj.toFixed(2)}`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        );
      })()}
    </div>
  );
}
