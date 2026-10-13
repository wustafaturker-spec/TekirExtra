"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader, Card, Button, Input, Select, Alert, Badge } from "@/components/ui";
import { YzVeriOnayiKart } from "@/components/yz-veri-onayi-kart";
import { YzKullanimKart } from "@/components/yz-kullanim-kart";
import { Sparkles, Shield, Clock, CheckCircle2, AlertTriangle, Play, Trash2, Plus, RefreshCw, Key, Server, Cpu } from "lucide-react";

interface AiAyari {
  saglayici: string;
  apiKey: string | null;
  hasApiKey?: boolean;
  modelAdi: string | null;
  baseUrl: string | null;
  ozelTalimatlar: string | null;
}

interface AiGorev {
  id: string;
  ad: string;
  tetikleyici: "ZAMANLANMIS" | "VADE_GECIKMESI" | "KASA_KRITIK";
  zamanlamaCron: string | null;
  gorevTalimati: string;
  kanal: "WHATSAPP" | "EMAIL" | "PANEL";
  hedefKimlik: string | null;
  aktif: boolean;
  sonCalisma: string | null;
  sonSonuc: string | null;
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
  const [baseUrl, setBaseUrl] = useState("");
  const [ozelTalimatlar, setOzelTalimatlar] = useState("");

  // Görevler State
  const [gorevler, setGorevler] = useState<AiGorev[]>([]);
  const [yeniGorevModal, setYeniGorevModal] = useState(false);
  const [calistirilanGorevSonuc, setCalistirilanGorevSonuc] = useState<{ ad: string; sonuc: string } | null>(null);

  // Yeni Görev Form
  const [yeniAd, setYeniAd] = useState("");
  const [yeniTetikleyici, setYeniTetikleyici] = useState<"ZAMANLANMIS" | "VADE_GECIKMESI" | "KASA_KRITIK">("ZAMANLANMIS");
  const [yeniZamanlama, setYeniZamanlama] = useState("09:00");
  const [yeniTalimat, setYeniTalimat] = useState("");
  const [yeniKanal, setYeniKanal] = useState<"WHATSAPP" | "EMAIL" | "PANEL">("WHATSAPP");
  const [yeniHedef, setYeniHedef] = useState("");

  async function verileriYukle() {
    setYukleniyor(true);
    setHata("");
    try {
      const [ayarData, gorevData] = await Promise.all([
        api<AiAyari>("/ai/ayarlar"),
        api<AiGorev[]>("/ai/gorevler"),
      ]);

      setSaglayici(ayarData.saglayici || "varsayilan");
      setApiKey(ayarData.apiKey || "");
      setModelAdi(ayarData.modelAdi || "");
      setBaseUrl(ayarData.baseUrl || "");
      setOzelTalimatlar(ayarData.ozelTalimatlar || "");
      setGorevler(gorevData || []);
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
          baseUrl: baseUrl || null,
          ozelTalimatlar: ozelTalimatlar || null,
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

  async function gorevEkle() {
    if (!yeniAd.trim() || !yeniTalimat.trim()) {
      alert("Lütfen görev adını ve talimatını doldurun.");
      return;
    }
    try {
      await api("/ai/gorevler", {
        method: "POST",
        body: JSON.stringify({
          ad: yeniAd,
          tetikleyici: yeniTetikleyici,
          zamanlamaCron: yeniZamanlama,
          gorevTalimati: yeniTalimat,
          kanal: yeniKanal,
          hedefKimlik: yeniHedef || null,
        }),
      });
      setYeniGorevModal(false);
      setYeniAd("");
      setYeniTalimat("");
      setYeniHedef("");
      await verileriYukle();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Görev eklenemedi");
    }
  }

  async function gorevSil(id: string) {
    if (!confirm("Bu görevi silmek istediğinize emin misiniz?")) return;
    try {
      await api(`/ai/gorevler/${id}`, { method: "DELETE" });
      await verileriYukle();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Görev silinemedi");
    }
  }

  async function gorevManuelCalistir(id: string) {
    try {
      const res = await api<{ ad: string; raporIcerigi: string }>(`/ai/gorevler/${id}/calistir`, {
        method: "POST",
      });
      setCalistirilanGorevSonuc({ ad: res.ad, sonuc: res.raporIcerigi });
      await verileriYukle();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Görev çalıştırılamadı");
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

        {/* KART 3: Otonom AI Görevleri & Zamanlanmış Raporlar / Erken Uyarılar */}
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", borderBottom: "1px solid var(--border)", paddingBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Clock size={22} color="#f59e0b" />
              <div>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700" }}>Otonom Görevler & Proaktif Raporlama</h3>
                <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
                  Her sabah finans özeti gönderme veya vade gecikmesinde uyarma gibi zamanlanmış yapay zeka görevleri.
                </p>
              </div>
            </div>
            <Button variant="primary" onClick={() => setYeniGorevModal(true)}>
              <Plus size={16} /> Yeni Görev Ekle
            </Button>
          </div>

          {gorevler.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 10px", color: "var(--text-muted)", fontSize: "13px" }}>
              Henüz tanımlanmış otonom görev bulunmuyor. Yeni bir günlük finans brifingi veya anomali radarı ekleyebilirsiniz.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {gorevler.map((g) => (
                <div
                  key={g.id}
                  style={{
                    padding: "14px 18px",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--surface)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "14px",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <strong style={{ fontSize: "14px" }}>{g.ad}</strong>
                      <Badge variant={g.aktif ? "success" : "neutral"}>
                        {g.aktif ? "Aktif" : "Pasif"}
                      </Badge>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                        {g.tetikleyici === "ZAMANLANMIS" ? `⏰ Her gün ${g.zamanlamaCron || "09:00"}` : `⚡ ${g.tetikleyici}`}
                      </span>
                      <span style={{ fontSize: "12px", color: "var(--accent)" }}>
                        📲 {g.kanal} {g.hedefKimlik ? `(${g.hedefKimlik})` : ""}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>
                      Talimat: &quot;{g.gorevTalimati}&quot;
                    </p>
                    {g.sonCalisma && (
                      <small style={{ color: "var(--text-subtle)", fontSize: "11px", display: "block", marginTop: "4px" }}>
                        Son Çalışma: {new Date(g.sonCalisma).toLocaleString("tr-TR")}
                      </small>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: "8px" }}>
                    <Button variant="ghost" onClick={() => gorevManuelCalistir(g.id)} title="Şimdi Çalıştır ve Gör">
                      <Play size={15} /> Şimdi Çalıştır
                    </Button>
                    <Button variant="ghost" onClick={() => gorevSil(g.id)} title="Görevi Sil">
                      <Trash2 size={15} color="var(--danger)" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

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

      {/* MODAL: Yeni Görev Ekle */}
      {yeniGorevModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: "var(--surface)",
            padding: "24px",
            borderRadius: "14px",
            width: "90%",
            maxWidth: "520px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            border: "1px solid var(--border)",
          }}>
            <h3 style={{ marginTop: 0, marginBottom: "16px", fontSize: "18px" }}>✨ Yeni Otonom AI Görevi Tanımla</h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "4px" }}>Görev Adı</label>
                <Input placeholder="Örn: Sabah Finans Brifingi" value={yeniAd} onChange={(e) => setYeniAd(e.target.value)} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "4px" }}>Tetikleyici</label>
                  <Select value={yeniTetikleyici} onChange={(e) => setYeniTetikleyici(e.target.value as any)}>
                    <option value="ZAMANLANMIS">Zamanlanmış (Her gün)</option>
                    <option value="VADE_GECIKMESI">Vade Gecikmesi Olduğunda</option>
                    <option value="KASA_KRITIK">Kasa/Banka Kritik Seviyede</option>
                  </Select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "4px" }}>Çalışma Saati</label>
                  <Input type="time" value={yeniZamanlama} onChange={(e) => setYeniZamanlama(e.target.value)} />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "4px" }}>AI Talimatı (Prompt)</label>
                <textarea
                  style={{
                    width: "100%",
                    minHeight: "75px",
                    padding: "8px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--surface)",
                    color: "var(--text)",
                    fontSize: "12px",
                  }}
                  placeholder="Dünkü satış hacmini, bugünkü tahsilatları ve vadesi geciken alacakları analiz edip kısa bir yönetici özeti çıkar."
                  value={yeniTalimat}
                  onChange={(e) => setYeniTalimat(e.target.value)}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "4px" }}>Gönderim Kanalı</label>
                  <Select value={yeniKanal} onChange={(e) => setYeniKanal(e.target.value as any)}>
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="EMAIL">E-posta</option>
                    <option value="PANEL">Panel Bildirimi</option>
                  </Select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "4px" }}>Hedef (Telefon / E-posta)</label>
                  <Input placeholder="0532... veya eposta@..." value={yeniHedef} onChange={(e) => setYeniHedef(e.target.value)} />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <Button variant="ghost" onClick={() => setYeniGorevModal(false)}>Vazgeç</Button>
              <Button variant="primary" onClick={gorevEkle}>Görevi Oluştur</Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Görev Çalıştırma Sonucu */}
      {calistirilanGorevSonuc && (
        <div style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: "var(--surface)",
            padding: "24px",
            borderRadius: "14px",
            width: "90%",
            maxWidth: "600px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            border: "1px solid var(--border)",
          }}>
            <h3 style={{ marginTop: 0, marginBottom: "8px", fontSize: "17px" }}>
              📢 Görev Çıktısı: {calistirilanGorevSonuc.ad}
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: "12px", color: "var(--text-muted)" }}>
              Yapay zeka ajanı tarafından üretilen ve yöneticiye iletilen mesaj önizlemesi:
            </p>

            <div style={{
              padding: "16px",
              borderRadius: "8px",
              backgroundColor: "var(--surface-2)",
              border: "1px solid var(--border)",
              fontSize: "13px",
              lineHeight: "1.6",
              whiteSpace: "pre-wrap",
              maxHeight: "360px",
              overflowY: "auto",
              color: "var(--text)",
            }}>
              {calistirilanGorevSonuc.sonuc}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "18px" }}>
              <Button variant="primary" onClick={() => setCalistirilanGorevSonuc(null)}>Kapat</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
