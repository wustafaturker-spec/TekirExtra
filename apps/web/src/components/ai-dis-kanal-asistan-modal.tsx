"use client";

import { useState, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import { MessageSquare, Send, Sparkles, X, Check, ShieldCheck, FileText, ArrowRight } from "lucide-react";

interface Mesaj {
  id: string;
  gonderen: "user" | "assistant";
  icerik: string;
  zaman: string;
  eylem?: string;
  veri?: any;
}

interface Props {
  acik: boolean;
  onKapat: () => void;
}

export function AiDisKanalAsistanModal({ acik, onKapat }: Props) {
  const [mesajlar, setMesajlar] = useState<Mesaj[]>([
    {
      id: "1",
      gonderen: "assistant",
      icerik:
        "👋 Merhaba! Ben TekirExtra Kurumsal AI Asistanınız.\nBana yazılı talimat verebilirsiniz:\n\n• *\"Yılmaz Ticaret bakiye sorgula\"*\n• *\"A4 Kağıt stoğu ne kadar?\"*\n• *\"Yılmaz Ticarete 50 koli A4 Kağıt için 30 gün vadeli teklif açalım, birim fiyat 120 TL\"*\n• *\"ONAYLA\"*",
      zaman: "Şimdi",
    },
  ]);
  const [girdi, setGirdi] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);
  const mesajlarSonuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (acik) {
      mesajlarSonuRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [mesajlar, acik]);

  if (!acik) return null;

  async function mesajGonder(metinGirdi?: string) {
    const metin = (metinGirdi || girdi).trim();
    if (!metin) return;

    const simdikiZaman = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    const kullaniciMesaji: Mesaj = {
      id: Math.random().toString(),
      gonderen: "user",
      icerik: metin,
      zaman: simdikiZaman,
    };

    setMesajlar((onceki) => [...onceki, kullaniciMesaji]);
    if (!metinGirdi) setGirdi("");
    setYukleniyor(true);

    try {
      const yanit = await api<{
        cevap: string;
        eylem?: string;
        veri?: any;
        pinGerekiyor?: boolean;
      }>("/ai/ajan/simulasyon", {
        method: "POST",
        body: JSON.stringify({
          mesaj: metin,
        }),
      });

      const asistanMesaji: Mesaj = {
        id: Math.random().toString(),
        gonderen: "assistant",
        icerik: yanit.cevap,
        zaman: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
        eylem: yanit.eylem,
        veri: yanit.veri,
      };

      setMesajlar((onceki) => [...onceki, asistanMesaji]);
    } catch (hata: any) {
      setMesajlar((onceki) => [
        ...onceki,
        {
          id: Math.random().toString(),
          gonderen: "assistant",
          icerik: `⚠️ İşlem sırasında bir hata oluştu: ${hata.message || "Sunucuya bağlanılamadı"}`,
          zaman: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setYukleniyor(false);
    }
  }

  // Hızlı komut yalnız kutuyu doldurur; teklif/onay gibi kayıt yazan
  // komutlar kullanıcı göndermeden çalışmaz.
  function hizliKomut(komut: string) {
    setGirdi(komut);
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "680px",
          height: "85vh",
          maxHeight: "750px",
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid #e2e8f0",
        }}
      >
        {/* Üst Başlık (WhatsApp / AI Banner) */}
        <div
          style={{
            backgroundColor: "#065f46",
            backgroundImage: "linear-gradient(135deg, #065f46 0%, #047857 100%)",
            color: "#ffffff",
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "50%",
                backgroundColor: "#10b981",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
                boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
              }}
            >
              <Sparkles size={22} />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: "16px", display: "flex", alignItems: "center", gap: "6px" }}>
                TekirExtra AI Asistanı
              </div>
              <div style={{ fontSize: "12px", opacity: 0.85 }}>
                Sahadan teklif oluşturma, bakiye/stok sorgulama & onay ajanı
              </div>
            </div>
          </div>
          <button
            onClick={onKapat}
            style={{
              background: "transparent",
              border: "none",
              color: "#ffffff",
              cursor: "pointer",
              padding: "6px",
              borderRadius: "8px",
              opacity: 0.85,
            }}
          >
            <X size={22} />
          </button>
        </div>

        {/* Hızlı Eylem Butonları */}
        <div
          style={{
            backgroundColor: "#f8fafc",
            padding: "10px 16px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            gap: "8px",
            overflowX: "auto",
            whiteSpace: "nowrap",
          }}
        >
          <button
            onClick={() => hizliKomut("Yılmaz Ticaret bakiye sorgula")}
            style={{
              padding: "6px 12px",
              fontSize: "12px",
              borderRadius: "20px",
              border: "1px solid #cbd5e1",
              backgroundColor: "#ffffff",
              color: "#334155",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            💵 Bakiye Sorgula
          </button>
          <button
            onClick={() => hizliKomut("A4 Kağıt stoğu ne kadar?")}
            style={{
              padding: "6px 12px",
              fontSize: "12px",
              borderRadius: "20px",
              border: "1px solid #cbd5e1",
              backgroundColor: "#ffffff",
              color: "#334155",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            📦 Stok Öğren
          </button>
          <button
            onClick={() =>
              hizliKomut("Yılmaz Ticarete 50 koli A4 Kağıt için 30 gün vadeli teklif açalım, birim fiyat 120 TL")
            }
            style={{
              padding: "6px 12px",
              fontSize: "12px",
              borderRadius: "20px",
              border: "1px solid #059669",
              backgroundColor: "#ecfdf5",
              color: "#065f46",
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            📝 Teklif Aç
          </button>
          <button
            onClick={() => hizliKomut("ONAYLA")}
            style={{
              padding: "6px 12px",
              fontSize: "12px",
              borderRadius: "20px",
              border: "1px solid #16a34a",
              backgroundColor: "#dcfce7",
              color: "#15803d",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            ✅ ONAYLA
          </button>
        </div>

        {/* Mesaj Alanı (Sohbet Akışı) */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px",
            backgroundColor: "#f0f2f5",
            backgroundImage: "radial-gradient(#e2e8f0 1px, transparent 1px)",
            backgroundSize: "16px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {mesajlar.map((m) => {
            const benMiyim = m.gonderen === "user";
            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  justifyContent: benMiyim ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "82%",
                    padding: "12px 16px",
                    borderRadius: benMiyim ? "16px 16px 2px 16px" : "16px 16px 16px 2px",
                    backgroundColor: benMiyim ? "#059669" : "#ffffff",
                    color: benMiyim ? "#ffffff" : "#1e293b",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                    fontSize: "14px",
                    lineHeight: "1.5",
                    whiteSpace: "pre-wrap",
                    position: "relative",
                  }}
                >
                  <div>{m.icerik}</div>
                  <div
                    style={{
                      fontSize: "10px",
                      marginTop: "6px",
                      textAlign: "right",
                      opacity: benMiyim ? 0.75 : 0.5,
                    }}
                  >
                    {m.zaman}
                  </div>
                </div>
              </div>
            );
          })}

          {yukleniyor && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div
                style={{
                  backgroundColor: "#ffffff",
                  color: "#64748b",
                  padding: "10px 16px",
                  borderRadius: "16px 16px 16px 2px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                }}
              >
                <Sparkles size={16} />
                <span>AI komutu analiz ediyor ve ERP motorunu çalıştırıyor...</span>
              </div>
            </div>
          )}
          <div ref={mesajlarSonuRef} />
        </div>

        {/* Alt Giriş Kutusu */}
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#ffffff",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <input
            type="text"
            value={girdi}
            onChange={(e) => setGirdi(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                mesajGonder();
              }
            }}
            placeholder="Doğal dilde talimat yazın (örn: 'Yılmaz Ticarete 50 adet A4 kağıt teklifi hazırla')..."
            disabled={yukleniyor}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: "24px",
              border: "1px solid #cbd5e1",
              outline: "none",
              fontSize: "14px",
              backgroundColor: "#f8fafc",
            }}
          />

          <button
            type="button"
            onClick={() => mesajGonder()}
            disabled={yukleniyor || !girdi.trim()}
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "50%",
              backgroundColor: girdi.trim() ? "#059669" : "#e2e8f0",
              color: "#ffffff",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: girdi.trim() ? "pointer" : "default",
              transition: "all 0.2s",
              flexShrink: 0,
            }}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
