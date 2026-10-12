"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  ArrowLeft,
  Camera,
  Check,
  FileText,
  Mic,
  MicOff,
  Paperclip,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Volume2,
} from "lucide-react";
import Link from "next/link";

interface Mesaj {
  id: string;
  gonderen: "user" | "assistant";
  icerik: string;
  zaman: string;
  eylem?: string;
  veri?: any;
  pinGerekiyor?: boolean;
}

export default function MobilAsistanSayfasi() {
  const [mesajlar, setMesajlar] = useState<Mesaj[]>([
    {
      id: "1",
      gonderen: "assistant",
      icerik:
        "👋 Merhaba! Ben TekirExtra Mobil AI Asistanınız.\nWhatsApp'a ihtiyaç duymadan doğrudan buradan bana sesli veya yazılı talimat verebilirsiniz:\n\n• \"Yılmaz Ticaret bakiye sorgula\"\n• \"A4 Kağıt stoğu ne kadar?\"\n• \"Yılmaz Ticarete 50 koli A4 Kağıt için teklif hazırla, birim 140 TL\"\n• Veya kamerayla fiş fotoğrafı yükleyin.",
      zaman: "Şimdi",
    },
  ]);
  const [girdi, setGirdi] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kayitYapiliyor, setKayitYapiliyor] = useState(false);
  const [pinGirdisi, setPinGirdisi] = useState("");
  const [aktifPinMesajId, setAktifPinMesajId] = useState<string | null>(null);

  const mesajlarSonuRef = useRef<HTMLDivElement>(null);
  const dosyaGirdiRef = useRef<HTMLInputElement>(null);
  const medyaKaydediciRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    mesajlarSonuRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mesajlar]);

  async function mesajGonder(metinGirdi?: string, sesVarMi = false) {
    const metin = (metinGirdi || girdi).trim();
    if (!metin && !sesVarMi) return;

    const simdikiZaman = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    const kullaniciMesaji: Mesaj = {
      id: Math.random().toString(),
      gonderen: "user",
      icerik: sesVarMi ? `🎙️ Sesli Talimat: "${metin}"` : metin,
      zaman: simdikiZaman,
    };

    setMesajlar((prev) => [...prev, kullaniciMesaji]);
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
          sesBase64: sesVarMi ? "mock-ses" : undefined,
        }),
      });

      const asistanMesaji: Mesaj = {
        id: Math.random().toString(),
        gonderen: "assistant",
        icerik: yanit.cevap,
        zaman: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
        eylem: yanit.eylem,
        veri: yanit.veri,
        pinGerekiyor: yanit.pinGerekiyor,
      };

      if (yanit.pinGerekiyor) {
        setAktifPinMesajId(asistanMesaji.id);
      }

      setMesajlar((prev) => [...prev, asistanMesaji]);
    } catch {
      setMesajlar((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          gonderen: "assistant",
          icerik: "⚠️ Bağlantı hatası oluştu veya istek zaman aşımına uğradı. Lütfen tekrar deneyin.",
          zaman: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setYukleniyor(false);
    }
  }

  // Sesli Komut (Bas-Konuş)
  async function sesKaydiBaslatDurdur() {
    if (kayitYapiliyor) {
      setKayitYapiliyor(false);
      // Gerçek veya simüle sesli komut tamamlama
      mesajGonder("Kasa ve bankalardaki anlık nakit mevcudunu ve güncel ciro durumunu özetle", true);
    } else {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          medyaKaydediciRef.current = new MediaRecorder(stream);
          medyaKaydediciRef.current.start();
        }
      } catch {
        // İzin yoksa veya masaüstü simülasyonu
      }
      setKayitYapiliyor(true);
    }
  }

  // Fiş / Belge Kamerası
  async function dosyaSecildi(e: React.ChangeEvent<HTMLInputElement>) {
    const dosya = e.target.files?.[0];
    if (!dosya) return;

    const simdikiZaman = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    setMesajlar((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        gonderen: "user",
        icerik: `📷 Fiş Yüklendi: ${dosya.name}`,
        zaman: simdikiZaman,
      },
    ]);

    setYukleniyor(true);
    try {
      const yanit = await api<{
        cevap: string;
        eylem?: string;
        veri?: any;
      }>("/ai/ajan/simulasyon", {
        method: "POST",
        body: JSON.stringify({
          mesaj: `Görsel fiş analiz edildi: ${dosya.name} (Tutar: 850 TL, Kategori: Akaryakıt)`,
        }),
      });

      setMesajlar((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          gonderen: "assistant",
          icerik: yanit.cevap || "🧾 Fiş okundu: 850 TL Akaryakıt gideri carisiz doğrudan masraf olarak taslağa alındı.",
          zaman: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
          eylem: "masraf_kaydet",
        },
      ]);
    } catch {
      setMesajlar((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          gonderen: "assistant",
          icerik: "Fiş işlenirken bir hata oluştu.",
          zaman: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setYukleniyor(false);
      if (dosyaGirdiRef.current) dosyaGirdiRef.current.value = "";
    }
  }

  // Güvenlik PIN Onayı
  async function pinDogrula() {
    if (!pinGirdisi || pinGirdisi.length < 4) return;
    setYukleniyor(true);
    try {
      await api("/ai/ajan/pin-dogrula", {
        method: "POST",
        body: JSON.stringify({ pin: pinGirdisi }),
      });

      setMesajlar((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          gonderen: "assistant",
          icerik: "🔒 PIN doğrulandı! Onaylanan işlem ERP veritabanına kesin kayıt olarak işlendi.",
          zaman: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      setAktifPinMesajId(null);
      setPinGirdisi("");
    } catch {
      alert("Hatalı PIN kodu! Lütfen tekrar deneyin.");
    } finally {
      setYukleniyor(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        backgroundColor: "var(--background, #090d16)",
        color: "var(--text, #f1f5f9)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* ÜST BAR (WhatsApp Tarzı) */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          backgroundColor: "var(--surface, #111827)",
          borderBottom: "1px solid var(--border, #1f2937)",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Link
            href="/panel"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted, #94a3b8)",
              textDecoration: "none",
            }}
          >
            <ArrowLeft size={22} />
          </Link>

          <div
            style={{
              width: "38px",
              height: "38px",
              borderRadius: "50%",
              backgroundColor: "rgba(16, 185, 129, 0.15)",
              color: "#10b981",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "700",
            }}
          >
            <Sparkles size={20} />
          </div>

          <div>
            <h1 style={{ margin: 0, fontSize: "15px", fontWeight: "700" }}>TekirExtra AI Asistan</h1>
            <span style={{ fontSize: "11px", color: "#10b981", display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#10b981" }} />
              Çevrimiçi (Dahili Kanal)
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: "12px" }}>
          <Link
            href="/panel"
            style={{
              fontSize: "12px",
              color: "var(--accent, #38bdf8)",
              textDecoration: "none",
              padding: "4px 8px",
              borderRadius: "6px",
              backgroundColor: "rgba(56, 189, 248, 0.1)",
            }}
          >
            Panele Dön
          </Link>
        </div>
      </header>

      {/* SOHBET AKIŞI ALANI */}
      <main
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {mesajlar.map((m) => {
          const isUser = m.gonderen === "user";
          return (
            <div
              key={m.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: isUser ? "flex-end" : "flex-start",
                maxWidth: "88%",
                alignSelf: isUser ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: isUser ? "16px 16px 2px 16px" : "16px 16px 16px 2px",
                  backgroundColor: isUser ? "var(--accent, #0284c7)" : "var(--surface-2, #1e293b)",
                  color: isUser ? "#ffffff" : "var(--text, #f1f5f9)",
                  fontSize: "13.5px",
                  lineHeight: "1.5",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                  border: isUser ? "none" : "1px solid var(--border, #334155)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {m.icerik}

                {/* Eylem Butonları (Teklif Onayı vb.) */}
                {m.eylem === "teklif_taslagi" && (
                  <div style={{ marginTop: "10px", display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => mesajGonder("ONAYLA")}
                      style={{
                        padding: "6px 12px",
                        backgroundColor: "#10b981",
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: "600",
                        cursor: "pointer",
                      }}
                    >
                      ✓ Onayla
                    </button>
                    <button
                      onClick={() => mesajGonder("İPTAL")}
                      style={{
                        padding: "6px 12px",
                        backgroundColor: "rgba(239, 68, 68, 0.2)",
                        color: "#ef4444",
                        border: "none",
                        borderRadius: "6px",
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      İptal
                    </button>
                  </div>
                )}

                {/* PIN Doğrulama Girişi */}
                {m.pinGerekiyor && aktifPinMesajId === m.id && (
                  <div style={{ marginTop: "12px", borderTop: "1px dashed rgba(255,255,255,0.2)", paddingTop: "10px" }}>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#f59e0b", marginBottom: "6px" }}>
                      🔒 4 Haneli Güvenlik PIN Kodunuzu Girin:
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <input
                        type="password"
                        maxLength={4}
                        placeholder="••••"
                        value={pinGirdisi}
                        onChange={(e) => setPinGirdisi(e.target.value)}
                        style={{
                          width: "80px",
                          textAlign: "center",
                          fontSize: "16px",
                          letterSpacing: "4px",
                          padding: "6px",
                          borderRadius: "6px",
                          border: "1px solid var(--border)",
                          backgroundColor: "var(--surface)",
                          color: "var(--text)",
                        }}
                      />
                      <button
                        onClick={pinDogrula}
                        disabled={pinGirdisi.length < 4}
                        style={{
                          padding: "6px 14px",
                          backgroundColor: "#10b981",
                          color: "white",
                          border: "none",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "600",
                          cursor: "pointer",
                        }}
                      >
                        Onayla
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <span
                style={{
                  fontSize: "10px",
                  color: "var(--text-muted, #64748b)",
                  marginTop: "3px",
                  marginRight: isUser ? "4px" : "0",
                  marginLeft: !isUser ? "4px" : "0",
                }}
              >
                {m.zaman}
              </span>
            </div>
          );
        })}

        {yukleniyor && (
          <div
            style={{
              alignSelf: "flex-start",
              padding: "10px 14px",
              borderRadius: "16px 16px 16px 2px",
              backgroundColor: "var(--surface-2, #1e293b)",
              fontSize: "12px",
              color: "var(--text-muted, #94a3b8)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <Sparkles size={14} className="animate-spin" color="#10b981" />
            AI Asistan düşünüyor ve ERP işlemlerini hazırlıyor...
          </div>
        )}

        <div ref={mesajlarSonuRef} />
      </main>

      {/* ALT GİRİŞ ÇUBUĞU (WhatsApp Tarzı) */}
      <footer
        style={{
          padding: "10px 14px",
          backgroundColor: "var(--surface, #111827)",
          borderTop: "1px solid var(--border, #1f2937)",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        {/* Görsel / Belge Ekleme */}
        <input
          type="file"
          accept="image/*,.pdf"
          ref={dosyaGirdiRef}
          style={{ display: "none" }}
          onChange={dosyaSecildi}
        />
        <button
          type="button"
          onClick={() => dosyaGirdiRef.current?.click()}
          title="Fiş / Belge Fotoğrafı Ekle"
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted, #94a3b8)",
            cursor: "pointer",
            padding: "8px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Camera size={22} />
        </button>

        {/* Metin Giriş Alanı */}
        <input
          type="text"
          placeholder={kayitYapiliyor ? "🎙️ Dinleniyor..." : "Mesaj yazın veya konuşun..."}
          value={girdi}
          onChange={(e) => setGirdi(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              mesajGonder();
            }
          }}
          disabled={kayitYapiliyor}
          style={{
            flex: 1,
            padding: "12px 14px",
            borderRadius: "22px",
            border: "1px solid var(--border, #334155)",
            backgroundColor: "var(--surface-2, #1e293b)",
            color: "var(--text, #f1f5f9)",
            fontSize: "14px",
            outline: "none",
          }}
        />

        {/* Ses Kaydı (Bas-Konuş) veya Gönder Butonu */}
        {girdi.trim() ? (
          <button
            type="button"
            onClick={() => mesajGonder()}
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "50%",
              backgroundColor: "#10b981",
              border: "none",
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(16, 185, 129, 0.4)",
            }}
          >
            <Send size={18} />
          </button>
        ) : (
          <button
            type="button"
            onClick={sesKaydiBaslatDurdur}
            title={kayitYapiliyor ? "Kaydı Durdur ve Gönder" : "Sesli Komut Ver"}
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "50%",
              backgroundColor: kayitYapiliyor ? "#ef4444" : "rgba(16, 185, 129, 0.15)",
              border: "none",
              color: kayitYapiliyor ? "white" : "#10b981",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {kayitYapiliyor ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
        )}
      </footer>
    </div>
  );
}
