"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader, Card, Button, Input, Select, Alert, Badge } from "@/components/ui";
import { YzVeriOnayiKart } from "@/components/yz-veri-onayi-kart";
import { YzKullanimKart } from "@/components/yz-kullanim-kart";
import { YzKaliteKart } from "@/components/yz-kalite-kart";
import { YzTahminIsabetiKart } from "@/components/yz-tahmin-isabeti-kart";
import { YzGorevlerKart } from "@/components/yz-gorevler-kart";
import { YzGucluSaglayiciKart } from "@/components/yz-guclu-saglayici-kart";
import { Sparkles, Shield, Clock, CheckCircle2, AlertTriangle, Play, Trash2, Plus, RefreshCw, Key, Server, Cpu } from "lucide-react";

interface AiAyari {
  saglayici: string;
  apiKey: string | null;
  hasApiKey?: boolean;
  modelAdi: string | null;
  ekonomikModelAdi?: string | null;
  gucluModelAdi?: string | null;
  /** AI-81: ayrı güçlü sağlayıcı tanımlıysa güçlü model onun kartında yönetilir. */
  guclu?: { saglayici: string; modelAdi: string | null } | null;
  baseUrl: string | null;
  ozelTalimatlar: string | null;
  ozelliklerEtkin: boolean;
}


export default function YapayZekaAyarlariSayfasi() {
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [testEdiliyor, setTestEdiliyor] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [testSonucu, setTestSonucu] = useState<{ basarili: boolean; mesaj?: string; yanit?: string } | null>(null);

  // Form State
  const [saglayici, setSaglayici] = useState("varsayilan");
  const [apiKey, setApiKey] = useState("");
  const [modelAdi, setModelAdi] = useState("");
  const [ekonomikModelAdi, setEkonomikModelAdi] = useState("");
  const [gucluModelAdi, setGucluModelAdi] = useState("");
  const [ayriGuclu, setAyriGuclu] = useState<AiAyari["guclu"]>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [ozelTalimatlar, setOzelTalimatlar] = useState("");
  const [ozelliklerEtkin, setOzelliklerEtkin] = useState(true);

  async function verileriYukle() {
    setYukleniyor(true);
    setHata("");
    try {
      const ayarData = await api<AiAyari>("/ai/ayarlar");

      setSaglayici(ayarData.saglayici || "varsayilan");
      setApiKey(ayarData.apiKey || "");
      setModelAdi(ayarData.modelAdi || "");
      setEkonomikModelAdi(ayarData.ekonomikModelAdi || "");
      setGucluModelAdi(ayarData.gucluModelAdi || "");
      setAyriGuclu(ayarData.guclu ?? null);
      setBaseUrl(ayarData.baseUrl || "");
      setOzelTalimatlar(ayarData.ozelTalimatlar || "");
      setOzelliklerEtkin(ayarData.ozelliklerEtkin !== false);
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Yapay zeka ayarları yüklenemedi.");
    } finally {
      setYukleniyor(false);
    }
  }

  useEffect(() => {
    verileriYukle();
  }, []);

  async function ayarlariKaydet() {
    setKaydediliyor(true);
    setHata("");
    setBasari("");
    try {
      await api("/ai/ayarlar", {
        method: "PUT",
        body: JSON.stringify({
          saglayici,
          apiKey: apiKey || null,
          modelAdi: modelAdi || null,
          ekonomikModelAdi: ekonomikModelAdi || null,
          gucluModelAdi: gucluModelAdi || null,
          baseUrl: baseUrl || null,
          ozelTalimatlar: ozelTalimatlar || null,
          ozelliklerEtkin,
        }),
      });
      setBasari("Yapay zeka yapılandırması ve şirket kuralları başarıyla kaydedildi.");
      await verileriYukle();
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Ayarlar kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  }

  async function baglantiSina() {
    setTestEdiliyor(true);
    setTestSonucu(null);
    setHata("");
    try {
      const res = await api<{ basarili: boolean; saglayici?: string; yanit?: string; mesaj?: string }>("/ai/ayarlar/test-et", {
        method: "POST",
        body: JSON.stringify({
          saglayici,
          apiKey,
          modelAdi,
          baseUrl,
        }),
      });
      setTestSonucu(res);
    } catch (err) {
      setTestSonucu({
        basarili: false,
        mesaj: err instanceof Error ? err.message : "Bağlantı hatası",
      });
    } finally {
      setTestEdiliyor(false);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", paddingBottom: "60px" }}>
      <PageHeader
        title="Yapay Zeka & Ajan Yönetimi"
        subtitle="Kendi AI modelinizi bağlayın (BYOK), şirketinizin kırmızı çizgilerini ve otonom raporlama görevlerini yönetin."
      />

      {hata && <div style={{ marginBottom: 16 }}><Alert tone="error">{hata}</Alert></div>}
      {basari && <div style={{ marginBottom: 16 }}><Alert tone="success">{basari}</Alert></div>}

      <div style={{ display: "grid", gap: "24px" }}>
        {/* AI-14/15 */}
        <YzVeriOnayiKart />
        <YzKullanimKart />
        <YzKaliteKart />
        <YzTahminIsabetiKart />
        {/* AI-81 */}
        <YzGucluSaglayiciKart />

        {/* KART 1: AI Sağlayıcı ve Model Entegrasyonu (BYOK) */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px", borderBottom: "1px solid var(--border)", paddingBottom: "12px" }}>
            <Cpu size={22} color="var(--accent)" />
            <div>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700" }}>AI Modeli & API Entegrasyonu (BYOK)</h3>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
                Firmanızın kendi OpenAI, Anthropic, Gemini veya yerel Ollama API anahtarını tanımlayın.
              </p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px", marginBottom: "16px" }}>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>Tenant yayılım durumu</label>
              <Select value={ozelliklerEtkin ? "acik" : "kapali"} onChange={(e) => setOzelliklerEtkin(e.target.value === "acik")}>
                <option value="acik">AI özellikleri açık</option>
                <option value="kapali">AI özellikleri kapalı</option>
              </Select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>
                Yapay Zeka Sağlayıcısı
              </label>
              <Select value={saglayici} onChange={(e) => setSaglayici(e.target.value)}>
                <option value="varsayilan">TekirExtra Varsayılanı (Platform Paylaşımlı)</option>
                <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="gemini">Google Gemini (Gemini 2.5 Flash / Pro)</option>
                <option value="ollama">Ollama (platformun sunucusu)</option>
              </Select>
            </div>

            {saglayici !== "varsayilan" && saglayici !== "ollama" && (
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>
                  API Anahtarı (API Key)
                </label>
                <Input
                  type="password"
                  placeholder="sk-... veya AI anahtarınız"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
            )}

            {saglayici !== "varsayilan" && (
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>
                  Model Adı (İsteğe bağlı)
                </label>
                <Input
                  placeholder={
                    saglayici === "openai" ? "gpt-4o-mini" :
                    saglayici === "anthropic" ? "claude-sonnet-5-5" :
                    saglayici === "ollama" ? "llama3.2" : "gemini-2.5-flash"
                  }
                  value={modelAdi}
                  onChange={(e) => setModelAdi(e.target.value)}
                />
              </div>
            )}

            {saglayici === "openai" && (
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>
                  Özel Endpoint / Base URL (Azure vb.; yalnız kendi API anahtarınızla, https)
                </label>
                <Input
                  placeholder="https://api.openai.com/v1"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>
            )}
          </div>

          {testSonucu && (
            <div style={{
              padding: "12px 16px",
              borderRadius: "8px",
              marginBottom: "16px",
              backgroundColor: testSonucu.basarili ? "var(--success-soft, #f0fdf4)" : "var(--danger-soft, #fef2f2)",
              border: `1px solid ${testSonucu.basarili ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"}`,
              fontSize: "13px",
              color: testSonucu.basarili ? "var(--success, #15803d)" : "var(--danger, #b91c1c)",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}>
              {testSonucu.basarili ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              <div>
                <strong>{testSonucu.basarili ? "Bağlantı Başarılı!" : "Bağlantı Başarısız:"}</strong>{" "}
                {testSonucu.basarili ? `Model yanıt verdi (${testSonucu.yanit})` : testSonucu.mesaj}
              </div>
            </div>
          )}

          {saglayici !== "varsayilan" && (
            <div style={{ gridColumn: "1 / -1", padding: 14, border: "1px solid var(--border)", borderRadius: 10 }}>
              <strong style={{ fontSize: 13 }}>İş karmaşıklığına göre model yönlendirme</strong>
              <p className="muted" style={{ margin: "6px 0 12px", fontSize: 12 }}>
                Özet, görev, hatırlatma, e-Belge ön denetimi ve asistan sohbeti ekonomik modele; tarama, teklif, ekstre ve asistandaki “Derin analiz” güçlü modele gider; asistanın finans açıklaması düzeltmesi ana modelde yapılır. Boş bırakılan alan ana model adını kullanır. Yavaş bir ana modelde kısa işler için hızlı bir model seçin (ör. EVREN&apos;de gemma-4-31b). Dış sağlayıcıda eklenen her model yurt dışı aktarım onayını yeniler.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Ekonomik model (asistan/özet/görev/hatırlatma/ön denetim)</label>
                  <Input maxLength={120} placeholder={saglayici === "ollama" ? "llama3.2:3b" : "boşsa ana model"} value={ekonomikModelAdi} onChange={(e) => setEkonomikModelAdi(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Güçlü model (Derin analiz/tarama/teklif/ekstre)</label>
                  {ayriGuclu
                    ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>Ayrı güçlü sağlayıcı tanımlı ({ayriGuclu.modelAdi}); asistan ekonomik modelle çalışır, Derin analiz o sağlayıcıya gider. Aşağıdaki “Güçlü sağlayıcı” kartından yönetilir.</p>
                    : <Input maxLength={120} placeholder={saglayici === "ollama" ? "qwen2.5:14b" : "boşsa ana model"} value={gucluModelAdi} onChange={(e) => setGucluModelAdi(e.target.value)} />}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            {saglayici !== "varsayilan" && (
              <Button type="button" variant="ghost" onClick={baglantiSina} disabled={testEdiliyor}>
                {testEdiliyor ? "Sınanıyor..." : "⚡ Bağlantıyı Sına"}
              </Button>
            )}
            <Button variant="primary" onClick={ayarlariKaydet} disabled={kaydediliyor}>
              {kaydediliyor ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </div>
        </Card>

        {/* KART 2: Şirket Özel Kuralları & Guardrails (Şunu Asla Yapma / Dikkatli Ol) */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px", borderBottom: "1px solid var(--border)", paddingBottom: "12px" }}>
            <Shield size={22} color="#8b5cf6" />
            <div>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700" }}>Şirket Özel Kuralları & Ajan Güvenlik Kalkanı (Guardrails)</h3>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
                Ajanın asla yapmaması gereken eylemleri, özel iskonto limitlerini ve riskli durum talimatlarını belirleyin.
              </p>
            </div>
          </div>

          <div style={{ marginBottom: "14px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>
              Ajan Davranış Talimatları & Şirket Kırmızı Çizgileri
            </label>
            <textarea
              style={{
                width: "100%",
                minHeight: "110px",
                padding: "10px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--surface)",
                color: "var(--text)",
                fontSize: "13px",
                lineHeight: "1.5",
              }}
              placeholder="Örnek:&#10;1. Kaya Ltd şirketine asla %5'ten fazla iskonto teklifi hazırlama.&#10;2. Vadesi 30 günü geçen müşterilere teklif onayı verme; patrona bildir.&#10;3. 50.000 TL üzeri her teklifte mutlaka yönetici teyidi iste.&#10;4. Cuma günleri vadesi gelen alacakları perşembe gününden hatırlat."
              value={ozelTalimatlar}
              onChange={(e) => setOzelTalimatlar(e.target.value)}
            />
            <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
              💡 Bu talimatlar sistemdeki tüm yapay zeka ajanlarına, WhatsApp asistanına ve teklif motoruna zorunlu güvenlik kuralı olarak enjekte edilir.
            </p>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="primary" onClick={ayarlariKaydet} disabled={kaydediliyor}>
              {kaydediliyor ? "Kaydediliyor..." : "Kuralları Güncelle"}
            </Button>
          </div>
        </Card>

        {/* KART 3: AI-16 görevleri */}
        <YzGorevlerKart />

        {/* KART 4: MCP — anahtarlar /panel/ai sayfasında (AI-09) */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Server size={22} color="var(--accent)" />
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700" }}>Model Context Protocol (MCP) Sunucusu</h3>
            </div>
            <Badge variant="success">Açık</Badge>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Her kullanıcı kendi erişim anahtarını <a href="/panel/ai">Asistan ve Onaylar</a> sayfasından oluşturur; anahtar o kullanıcının
            yetkisiyle çalışır ve onay gerektiren işlemler panelden onaylanır. Yönetici olarak kiracıdaki bütün anahtarları orada görüp iptal edebilirsiniz.
          </p>
        </Card>
      </div>

    </div>
  );
}
