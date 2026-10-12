"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Sparkles, TrendingUp, AlertTriangle, ShieldCheck, HelpCircle, Send, ChevronRight, BarChart2, PieChart } from "lucide-react";

interface Metrikler {
  aylikCiro: number;
  brutKarMarji: number;
  vadesiGecmisAlacak: number;
  nakitMevcudu: number;
  enBuyukGider: string;
}

interface BrifingVerisi {
  tarih: string;
  finansalSaglikSkoru: number;
  saglikDurumu: "Mükemmel" | "Güçlü" | "Dikkat Gerektirir" | "Kritik";
  yoneticiNotu: string;
  metrikler: Metrikler;
  oncelikliRiskler: string[];
  cfoTavsiyeleri: string[];
}

interface RaporYaniti {
  soru: string;
  baslik: string;
  raporTuru: string;
  donem: string;
  metrikler: Record<string, number | string>;
  tablo?: Array<Record<string, unknown>>;
  grafikTuru?: string;
  icgoruler: string[];
  cevapMetni: string;
}

export function AiCfoBrifingKart() {
  const [brifing, setBrifing] = useState<BrifingVerisi | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [soru, setSoru] = useState("");
  const [soruCevap, setSoruCevap] = useState<RaporYaniti | null>(null);
  const [soruYukleniyor, setSoruYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [aktifSekme, setAktifSekme] = useState<"cfo_brifing" | "chat_bi">("cfo_brifing");

  useEffect(() => {
    async function brifingGetir() {
      try {
        const veri = await api<BrifingVerisi>("/ai/rapor/yonetici-brifingi");
        setBrifing(veri);
      } catch {
        // Hata durumunda sessizce geç
      } finally {
        setYukleniyor(false);
      }
    }
    brifingGetir();
  }, []);

  async function soruSor(ozelSoru?: string) {
    const s = (ozelSoru || soru).trim();
    if (!s) return;

    setSoru(s);
    setSoruYukleniyor(true);
    setAktifSekme("chat_bi");
    setHata(null);
    try {
      const yanit = await api<RaporYaniti>("/ai/rapor/sor", {
        method: "POST",
        body: JSON.stringify({ soru: s }),
      });
      setSoruCevap(yanit);
    } catch (err: any) {
      setHata(err?.message || "Rapor sorgulanırken bir hata oluştu.");
    } finally {
      setSoruYukleniyor(false);
    }
  }

  const hazirSorular = [
    "Bu ayki ciromuz ve kârlılığımız ne kadar?",
    "En çok satış yaptığımız ilk 5 müşteri kim?",
    "Vadesi geçmiş alacaklarımız ve riskli müşteriler",
    "En büyük masraf ve gider kalemlerimiz neler?",
    "Kasa ve bankalarda toplam ne kadar nakit var?",
  ];

  const skorRenk =
    (brifing?.finansalSaglikSkoru || 0) >= 80
      ? "#10b981"
      : (brifing?.finansalSaglikSkoru || 0) >= 65
      ? "#3b82f6"
      : (brifing?.finansalSaglikSkoru || 0) >= 50
      ? "#f59e0b"
      : "#ef4444";

  return (
    <div
      style={{
        backgroundColor: "#ffffff",
        borderRadius: "16px",
        boxShadow: "0 4px 20px -2px rgba(0, 0, 0, 0.05)",
        border: "1px solid #e2e8f0",
        padding: "20px",
        marginBottom: "24px",
      }}
    >
      {/* Kart Başlığı ve Sekmeler */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "12px",
          borderBottom: "1px solid #f1f5f9",
          paddingBottom: "16px",
          marginBottom: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              backgroundColor: "rgba(16, 185, 129, 0.12)",
              color: "#059669",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Sparkles size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: "16px", color: "#0f172a" }}>
              AI Finansal Analist & CFO Brifingi
            </div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              RLS korumalı Semantik BI Motoru & Doğal Dille Finansal Sorgulama (Faz 4)
            </div>
          </div>
        </div>

        {/* Sekme Butonları */}
        <div style={{ display: "flex", gap: "6px", backgroundColor: "#f1f5f9", padding: "4px", borderRadius: "10px" }}>
          <button
            onClick={() => setAktifSekme("cfo_brifing")}
            style={{
              padding: "6px 14px",
              fontSize: "13px",
              fontWeight: aktifSekme === "cfo_brifing" ? 600 : 500,
              backgroundColor: aktifSekme === "cfo_brifing" ? "#ffffff" : "transparent",
              color: aktifSekme === "cfo_brifing" ? "#0f172a" : "#64748b",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              boxShadow: aktifSekme === "cfo_brifing" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            📊 Haftalık CFO Brifingi
          </button>
          <button
            onClick={() => setAktifSekme("chat_bi")}
            style={{
              padding: "6px 14px",
              fontSize: "13px",
              fontWeight: aktifSekme === "chat_bi" ? 600 : 500,
              backgroundColor: aktifSekme === "chat_bi" ? "#ffffff" : "transparent",
              color: aktifSekme === "chat_bi" ? "#0f172a" : "#64748b",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              boxShadow: aktifSekme === "chat_bi" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            💬 Doğal Dil Rapor Sor (ChatBI)
          </button>
        </div>
      </div>

      {/* SEKME 1: HAFTALIK AI CFO BRİFİNGİ */}
      {aktifSekme === "cfo_brifing" && (
        <div>
          {yukleniyor ? (
            <div style={{ padding: "30px", textAlign: "center", color: "#64748b", fontSize: "14px" }}>
              Finansal veriler analiz ediliyor ve CFO brifingi oluşturuluyor...
            </div>
          ) : brifing ? (
            <div>
              {/* Üst Özet Kartı: Skor + Yönetici Mektubu */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: "16px",
                  marginBottom: "20px",
                }}
              >
                {/* Skor Kutusu */}
                <div
                  style={{
                    backgroundColor: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "14px",
                    padding: "16px",
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                  }}
                >
                  <div
                    style={{
                      width: "64px",
                      height: "64px",
                      borderRadius: "50%",
                      border: `4px solid ${skorRenk}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "22px",
                      fontWeight: 800,
                      color: skorRenk,
                      flexShrink: 0,
                    }}
                  >
                    {brifing.finansalSaglikSkoru}
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", textTransform: "uppercase", color: "#64748b", fontWeight: 700 }}>
                      Finansal Sağlık Skoru
                    </div>
                    <div style={{ fontSize: "18px", fontWeight: 700, color: "#0f172a" }}>
                      {brifing.saglikDurumu}
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>
                      Kârlılık, nakit ve tahsilat disiplini
                    </div>
                  </div>
                </div>

                {/* Yönetici Notu */}
                <div
                  style={{
                    backgroundColor: "rgba(16, 185, 129, 0.05)",
                    border: "1px solid rgba(16, 185, 129, 0.2)",
                    borderRadius: "14px",
                    padding: "16px",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#065f46", textTransform: "uppercase", marginBottom: "4px" }}>
                    💼 AI CFO Yönetici Değerlendirmesi
                  </div>
                  <div style={{ fontSize: "13px", color: "#1e293b", lineHeight: 1.5 }}>
                    {brifing.yoneticiNotu}
                  </div>
                </div>
              </div>

              {/* Temel KPI Göstergeleri */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "12px",
                  marginBottom: "20px",
                }}
              >
                <div style={{ padding: "12px 14px", backgroundColor: "#f8fafc", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Aylık Net Ciro</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                    {brifing.metrikler.aylikCiro.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                  </div>
                </div>
                <div style={{ padding: "12px 14px", backgroundColor: "#f8fafc", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Brüt Kâr Marjı</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: brifing.metrikler.brutKarMarji >= 20 ? "#10b981" : "#f59e0b" }}>
                    %{brifing.metrikler.brutKarMarji}
                  </div>
                </div>
                <div style={{ padding: "12px 14px", backgroundColor: "#f8fafc", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Vadesi Geçmiş Alacak</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: brifing.metrikler.vadesiGecmisAlacak > 0 ? "#ef4444" : "#10b981" }}>
                    {brifing.metrikler.vadesiGecmisAlacak.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                  </div>
                </div>
                <div style={{ padding: "12px 14px", backgroundColor: "#f8fafc", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Nakit Mevcudu (Kasa/Banka)</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#059669" }}>
                    {brifing.metrikler.nakitMevcudu.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                  </div>
                </div>
              </div>

              {/* CFO Tavsiyeleri ve Riskler */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: "16px",
                }}
              >
                {/* Riskler */}
                <div style={{ padding: "14px", borderRadius: "12px", backgroundColor: "#fff7ed", border: "1px solid #fed7aa" }}>
                  <div style={{ fontWeight: 700, fontSize: "13px", color: "#c2410c", display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                    <AlertTriangle size={16} /> Öncelikli Riskler
                  </div>
                  {brifing.oncelikliRiskler.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "#9a3412", lineHeight: 1.6 }}>
                      {brifing.oncelikliRiskler.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ fontSize: "12px", color: "#059669" }}>✅ Belirgin bir finansal risk tespit edilmedi.</div>
                  )}
                </div>

                {/* Stratejik Tavsiyeler */}
                <div style={{ padding: "14px", borderRadius: "12px", backgroundColor: "#eff6ff", border: "1px solid #bfdbfe" }}>
                  <div style={{ fontWeight: 700, fontSize: "13px", color: "#1d4ed8", display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                    <TrendingUp size={16} /> Stratejik CFO Tavsiyeleri
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "#1e40af", lineHeight: 1.6 }}>
                    {brifing.cfoTavsiyeleri.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ padding: "20px", textAlign: "center", color: "#64748b" }}>
              Brifing verisi henüz üretilemedi.
            </div>
          )}
        </div>
      )}

      {/* SEKME 2: DOĞAL DİLLE RAPOR SORMA (CHATBI) */}
      {aktifSekme === "chat_bi" && (
        <div>
          {/* Hızlı Soru Hapları */}
          <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "10px", marginBottom: "12px" }}>
            {hazirSorular.map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  setSoru(s);
                  soruSor(s);
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: "20px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#f8fafc",
                  color: "#334155",
                  fontSize: "12px",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Soru Giriş Alanı */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
            <input
              type="text"
              value={soru}
              onChange={(e) => setSoru(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") soruSor();
              }}
              placeholder="Finansal bir soru yazın (örn: 'En çok satan ilk 5 müşteri', 'Bu ayki ciromuz')..."
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: "10px",
                border: "1px solid #cbd5e1",
                fontSize: "14px",
                outline: "none",
                backgroundColor: "#f8fafc",
              }}
            />
            <button
              onClick={() => soruSor()}
              disabled={soruYukleniyor || !soru.trim()}
              style={{
                padding: "10px 20px",
                borderRadius: "10px",
                border: "none",
                backgroundColor: "#059669",
                color: "#ffffff",
                fontWeight: 600,
                fontSize: "13px",
                cursor: soru.trim() ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {soruYukleniyor ? "Sorgulanıyor..." : "Analiz Et"}
              <Send size={15} />
            </button>
          </div>

          {/* Hata Uyarısı */}
          {hata && (
            <div
              style={{
                padding: "12px 16px",
                backgroundColor: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "10px",
                color: "#991b1b",
                fontSize: "13px",
                marginBottom: "16px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <AlertTriangle size={16} />
              <span>{hata}</span>
            </div>
          )}

          {/* Yükleniyor Durumu */}
          {soruYukleniyor && (
            <div
              style={{
                padding: "24px",
                textAlign: "center",
                color: "#059669",
                fontSize: "13px",
                backgroundColor: "#f0fdf4",
                borderRadius: "12px",
                border: "1px dashed #86efac",
                marginBottom: "16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
              }}
            >
              <Sparkles size={18} style={{ animation: "pulse 1.5s infinite" }} />
              <span>Finansal veriler taranıyor ve yapay zeka analiz raporu hazırlanıyor...</span>
            </div>
          )}

          {/* Soru Yanıt Kartı */}
          {soruCevap && (
            <div
              style={{
                backgroundColor: "#f8fafc",
                borderRadius: "14px",
                padding: "18px",
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px", borderBottom: "1px solid #e2e8f0", paddingBottom: "10px" }}>
                <div style={{ fontWeight: 700, fontSize: "16px", color: "#0f172a", display: "flex", alignItems: "center", gap: "8px" }}>
                  <BarChart2 size={18} color="#059669" />
                  {soruCevap.baslik}
                </div>
                <div style={{ fontSize: "12px", color: "#64748b", backgroundColor: "#ffffff", padding: "4px 10px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                  Dönem: {soruCevap.donem}
                </div>
              </div>

              {/* Doğal Dilde AI Analiz Metni */}
              {soruCevap.cevapMetni && (
                <div
                  style={{
                    marginBottom: "16px",
                    backgroundColor: "#ffffff",
                    padding: "14px 16px",
                    borderRadius: "12px",
                    border: "1px solid #cbd5e1",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: "12px", color: "#0284c7", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <Sparkles size={15} /> Finansal Asistan Özeti & Değerlendirmesi:
                  </div>
                  <div style={{ fontSize: "13px", color: "#1e293b", lineHeight: 1.6, whiteSpace: "pre-line" }}>
                    {soruCevap.cevapMetni}
                  </div>
                </div>
              )}

              {/* Metrik Rozetleri */}
              {soruCevap.metrikler && Object.keys(soruCevap.metrikler).length > 0 && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: "10px",
                    marginBottom: "16px",
                  }}
                >
                  {Object.entries(soruCevap.metrikler).map(([k, v]) => (
                    <div
                      key={k}
                      style={{
                        padding: "10px 14px",
                        backgroundColor: "#ffffff",
                        borderRadius: "10px",
                        border: "1px solid #e2e8f0",
                      }}
                    >
                      <div style={{ fontSize: "11px", color: "#64748b", textTransform: "capitalize" }}>
                        {k.replace(/([A-Z])/g, " $1")}
                      </div>
                      <div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a", marginTop: "3px" }}>
                        {typeof v === "number" ? `${v.toLocaleString("tr-TR")} TL` : String(v)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* AI Analitik İçgörüleri */}
              {soruCevap.icgoruler && soruCevap.icgoruler.length > 0 && (
                <div style={{ marginBottom: "16px", backgroundColor: "rgba(16, 185, 129, 0.05)", padding: "14px", borderRadius: "10px", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
                  <div style={{ fontWeight: 700, fontSize: "12px", color: "#065f46", marginBottom: "6px" }}>
                    💡 AI Analitik İçgörüleri:
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "#1e293b", lineHeight: 1.5 }}>
                    {soruCevap.icgoruler.map((ic, i) => (
                      <li key={i}>{ic}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Tablo Çıktısı Varsa */}
              {soruCevap.tablo && soruCevap.tablo.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse", backgroundColor: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                    <thead>
                      <tr style={{ backgroundColor: "#f1f5f9", textAlign: "left" }}>
                        {Object.keys(soruCevap.tablo[0]).map((kolon) => (
                          <th key={kolon} style={{ padding: "10px 14px", borderBottom: "1px solid #e2e8f0", textTransform: "capitalize", fontWeight: 600 }}>
                            {kolon}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {soruCevap.tablo.map((satir, satIndex) => (
                        <tr key={satIndex} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          {Object.values(satir).map((val: any, valIndex) => (
                            <td key={valIndex} style={{ padding: "10px 14px" }}>
                              {typeof val === "number" ? val.toLocaleString("tr-TR") : String(val)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Başlangıç Yönlendirme Durumu */}
          {!soruCevap && !soruYukleniyor && !hata && (
            <div
              style={{
                padding: "36px 20px",
                textAlign: "center",
                backgroundColor: "#f8fafc",
                borderRadius: "14px",
                border: "1px dashed #cbd5e1",
              }}
            >
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "50%",
                  backgroundColor: "rgba(16, 185, 129, 0.12)",
                  color: "#059669",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 12px",
                }}
              >
                <Sparkles size={24} />
              </div>
              <div style={{ fontWeight: 700, fontSize: "15px", color: "#0f172a", marginBottom: "6px" }}>
                Doğal Dilde Finansal Raporlama (ChatBI)
              </div>
              <div style={{ fontSize: "13px", color: "#64748b", maxWidth: "480px", margin: "0 auto", lineHeight: 1.5 }}>
                Yukarıdaki hazır soru haplarından birine tıklayabilir veya serbestçe şirketin cirosunu, vadesi geçen alacaklarını, nakit likiditesini ya da masraflarını sorabilirsiniz.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
