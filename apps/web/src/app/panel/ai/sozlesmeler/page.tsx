"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  PageHeader,
  Select,
} from "@/components/ui";

type SozlesmeTuru = "sozlesme" | "sartname" | "protokol" | "teklif_eki" | "diger";
type SozlesmeDurumu = "isleniyor" | "hazir" | "hatali" | "arsivlendi";

interface KaynakAlinti {
  belgeId: string;
  belgeBaslik: string;
  surum: number;
  sayfaNo: number;
  bolumBasligi?: string;
  alinti: string;
  skor?: number;
}

interface SozlesmeBelge {
  id: string;
  baslik: string;
  tur: SozlesmeTuru;
  durum: SozlesmeDurumu;
  surum: number;
  sayfaSayisi: number;
  dosyaAdi: string;
  boyut: number;
  ozet: string | null;
  gecerlilikBitis: string | null;
  yetkiliRoller: string[] | null;
  createdAt: string;
  cari?: { id: string; unvan: string; kod: string } | null;
  yukleyen?: { id: string; adSoyad: string; eposta: string } | null;
  _count?: { parcalar: number; sonrakiSurumler: number };
}

interface SozlesmeSoruSonucu {
  cevap: string;
  guvenSkoru: "yuksek" | "orta" | "yok";
  kaynaklar: KaynakAlinti[];
  toplamParcaSayisi: number;
}

const TUR_METINLERI: Record<SozlesmeTuru, string> = {
  sozlesme: "Ticari Sözleşme",
  sartname: "Şartname",
  protokol: "Protokol / Zeyilname",
  teklif_eki: "Teklif Şartı & Eki",
  diger: "Diğer Belge",
};

const TUR_RENKLERI: Record<SozlesmeTuru, "accent" | "info" | "warning" | "success" | "neutral"> = {
  sozlesme: "accent",
  sartname: "info",
  protokol: "warning",
  teklif_eki: "success",
  diger: "neutral",
};

export default function SozlesmelerRAGPage() {
  const [aktifSekme, setAktifSekme] = useState<"liste" | "sor" | "yukle">("liste");
  const [belgeler, setBelgeler] = useState<SozlesmeBelge[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [basari, setBasari] = useState<string | null>(null);

  // Filtreler
  const [turFiltre, setTurFiltre] = useState<string>("hepsi");
  const [aramaMetni, setAramaMetni] = useState("");

  // Soru-Cevap (RAG) Durumu
  const [secilenBelgeId, setSecilenBelgeId] = useState<string>("");
  const [soru, setSoru] = useState("");
  const [soruluyor, setSoruluyor] = useState(false);
  const [ragSonuc, setRagSonuc] = useState<SozlesmeSoruSonucu | null>(null);

  // Yeni Belge Yükleme Formu
  const [yeniBaslik, setYeniBaslik] = useState("");
  const [yeniTur, setYeniTur] = useState<SozlesmeTuru>("sozlesme");
  const [yeniGecerlilik, setYeniGecerlilik] = useState("");
  const [secilenDosya, setSecilenDosya] = useState<File | null>(null);
  const [dosyaYukleniyor, setDosyaYukleniyor] = useState(false);

  // Belgeleri Listele
  const listele = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);
    try {
      const p = new URLSearchParams();
      if (turFiltre !== "hepsi") p.set("tur", turFiltre);
      if (aramaMetni.trim()) p.set("arama", aramaMetni.trim());

      const res = await api<SozlesmeBelge[]>(`/ai/sozlesme?${p.toString()}`);
      setBelgeler(res || []);
    } catch (e: any) {
      setHata(e?.message || "Sözleşmeler yüklenirken bir hata oluştu.");
    } finally {
      setYukleniyor(false);
    }
  }, [turFiltre, aramaMetni]);

  useEffect(() => {
    listele();
  }, [listele]);

  // Soru Sor (RAG)
  const soruSor = async (soruMetni?: string) => {
    const sorulacak = (soruMetni || soru).trim();
    if (!sorulacak) return;

    setSoruluyor(true);
    setHata(null);
    try {
      const res = await api<SozlesmeSoruSonucu>("/ai/sozlesme/sor", {
        method: "POST",
        body: JSON.stringify({
          soru: sorulacak,
          ...(secilenBelgeId ? { belgeId: secilenBelgeId } : {}),
        }),
      });
      setRagSonuc(res);
    } catch (e: any) {
      setHata(e?.message || "Soru yanıtlanırken bir hata oluştu.");
    } finally {
      setSoruluyor(false);
    }
  };

  // Yeni Belge Yükle
  const belgeYukle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secilenDosya) {
      setHata("Lütfen bir dosya seçin.");
      return;
    }
    if (!yeniBaslik.trim()) {
      setHata("Lütfen belge başlığı girin.");
      return;
    }

    setDosyaYukleniyor(true);
    setHata(null);
    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const res = reader.result as string;
          const base64 = res.split(",")[1];
          resolve(base64);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(secilenDosya);
      const dosyaBase64 = await base64Promise;

      await api("/ai/sozlesme/yukle", {
        method: "POST",
        body: JSON.stringify({
          baslik: yeniBaslik.trim(),
          tur: yeniTur,
          dosyaBase64,
          dosyaAdi: secilenDosya.name,
          mimeTip: secilenDosya.type || "application/pdf",
          ...(yeniGecerlilik ? { gecerlilikBitis: yeniGecerlilik } : {}),
        }),
      });

      setBasari("Sözleşme başarıyla yüklendi, metin katmanı ayrıştırıldı ve parçalandı.");
      setYeniBaslik("");
      setSecilenDosya(null);
      setYeniGecerlilik("");
      setAktifSekme("liste");
      listele();
    } catch (e: any) {
      setHata(e?.message || "Belge yüklenirken bir hata oluştu.");
    } finally {
      setDosyaYukleniyor(false);
    }
  };

  // Belge Sil
  const belgeSil = async (id: string, baslik: string) => {
    if (!confirm(`"${baslik}" belgesini ve tüm indeks parçalarını silmek istediğinize emin misiniz?`)) return;

    try {
      await api(`/ai/sozlesme/${id}`, { method: "DELETE" });
      setBasari(`"${baslik}" başarıyla silindi.`);
      listele();
    } catch (e: any) {
      setHata(e?.message || "Belge silinirken hata oluştu.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sözleşme & Şartname Belge Sorgulama (RAG)"
        subtitle="PostgreSQL tam metin araması ve sayfa kaynaklı yapay zekâ analiz motoru (P-10). Sözleşmelerdeki maddeleri, cezai şartları ve teslimat koşullarını kaynak atıflarıyla sorgulayın."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={aktifSekme === "sor" ? "primary" : "ghost"}
              onClick={() => setAktifSekme("sor")}
            >
              🔍 Soru Sor (RAG)
            </Button>
            <Button
              variant={aktifSekme === "yukle" ? "primary" : "ghost"}
              onClick={() => setAktifSekme("yukle")}
            >
              ➕ Yeni Belge Yükle
            </Button>
            <Button
              variant={aktifSekme === "liste" ? "primary" : "ghost"}
              onClick={() => setAktifSekme("liste")}
            >
              📑 Belgelerim ({belgeler.length})
            </Button>
          </div>
        }
      />

      {hata && (
        <Alert tone="error">
          <div className="flex items-center justify-between w-full">
            <span>{hata}</span>
            <button type="button" onClick={() => setHata(null)} className="ml-2 underline text-xs">Kapat</button>
          </div>
        </Alert>
      )}
      {basari && (
        <Alert tone="success">
          <div className="flex items-center justify-between w-full">
            <span>{basari}</span>
            <button type="button" onClick={() => setBasari(null)} className="ml-2 underline text-xs">Kapat</button>
          </div>
        </Alert>
      )}

      {/* SEKME 1: AKILLI SORU-CEVAP (RAG) */}
      {aktifSekme === "sor" && (
        <div className="space-y-6">
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <span>🔍</span> Sözleşme veya Şartname Üzerinde Soru Sor
            </h2>
            <p className="text-sm text-muted-foreground">
              Yapay zekâ modeli yalnızca yetkili olduğunuz sözleşme metinlerine dayanarak, hangi sayfadan ve maddeden alıntı yaptığını göstererek yanıt verir.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-1">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">
                  Kapsam (Belge Seçimi)
                </label>
                <Select
                  value={secilenBelgeId}
                  onChange={(e) => setSecilenBelgeId(e.target.value)}
                  className="w-full"
                >
                  <option value="">🌐 Tüm Yetkili Belgeler</option>
                  {belgeler.map((b) => (
                    <option key={b.id} value={b.id}>
                      [{TUR_METINLERI[b.tur]}] {b.baslik} (v{b.surum})
                    </option>
                  ))}
                </Select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">
                  Soru veya İnceleme Konusu
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={soru}
                    onChange={(e) => setSoru(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && soruSor()}
                    placeholder="Örn: Sözleşmede gecikme cezası ve fesih şartları nelerdir?"
                    className="flex-1 px-3 py-2 border rounded-md text-sm bg-background"
                  />
                  <Button
                    variant="primary"
                    disabled={soruluyor || !soru.trim()}
                    onClick={() => soruSor()}
                  >
                    {soruluyor ? "Taranıyor..." : "Analiz Et"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Hızlı Öneri Butonları */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t text-xs text-muted-foreground">
              <span>Hızlı Sorular:</span>
              <button
                type="button"
                className="px-2.5 py-1 bg-muted hover:bg-muted/80 rounded-full text-foreground transition"
                onClick={() => {
                  setSoru("Cezai şart ve tazminat koşulları nelerdir?");
                  soruSor("Cezai şart ve tazminat koşulları nelerdir?");
                }}
              >
                ⚖️ Cezai Şartlar
              </button>
              <button
                type="button"
                className="px-2.5 py-1 bg-muted hover:bg-muted/80 rounded-full text-foreground transition"
                onClick={() => {
                  setSoru("Fesih ihbar süresi ve haklı fesih halleri nelerdir?");
                  soruSor("Fesih ihbar süresi ve haklı fesih halleri nelerdir?");
                }}
              >
                ⏱️ Fesih Süreleri
              </button>
              <button
                type="button"
                className="px-2.5 py-1 bg-muted hover:bg-muted/80 rounded-full text-foreground transition"
                onClick={() => {
                  setSoru("Ödeme vadeleri ve faturalandırma şartları nedir?");
                  soruSor("Ödeme vadeleri ve faturalandırma şartları nedir?");
                }}
              >
                💳 Ödeme ve Vade
              </button>
              <button
                type="button"
                className="px-2.5 py-1 bg-muted hover:bg-muted/80 rounded-full text-foreground transition"
                onClick={() => {
                  setSoru("Garanti, bakım ve destek taahhütleri nelerdir?");
                  soruSor("Garanti, bakım ve destek taahhütleri nelerdir?");
                }}
              >
                🛡️ Garanti ve Bakım
              </button>
            </div>
          </Card>

          {/* Yanıt Alanı */}
          {ragSonuc && (
            <Card className="p-6 space-y-6 border-primary/40 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground">Yapay Zekâ Analiz Yanıtı</h3>
                  {ragSonuc.guvenSkoru === "yuksek" ? (
                    <Badge variant="success">✓ Kanıtlı Yanıt</Badge>
                  ) : ragSonuc.guvenSkoru === "orta" ? (
                    <Badge variant="warning">Kısmi Kanıt</Badge>
                  ) : (
                    <Badge variant="neutral">Hüküm Bulunamadı</Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  İncelenen Parça: {ragSonuc.toplamParcaSayisi}
                </span>
              </div>

              <div className="prose dark:prose-invert max-w-none text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {ragSonuc.cevap}
              </div>

              {/* Dayanak Gösterilen Kaynak Alıntıları */}
              {ragSonuc.kaynaklar && ragSonuc.kaynaklar.length > 0 && (
                <div className="space-y-3 pt-4 border-t">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <span>📑</span> Dayanak Gösterilen Belge ve Sayfalar ({ragSonuc.kaynaklar.length})
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {ragSonuc.kaynaklar.map((k, idx) => (
                      <div
                        key={idx}
                        className="p-3 border rounded-lg bg-card/60 text-xs space-y-1.5 hover:border-primary/50 transition"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-foreground truncate">
                            {k.belgeBaslik} <span className="text-muted-foreground font-normal">(v{k.surum})</span>
                          </span>
                          <span className="px-2 py-0.5 bg-primary/10 text-primary font-bold rounded">
                            Sayfa {k.sayfaNo}
                          </span>
                        </div>
                        {k.bolumBasligi && (
                          <div className="text-muted-foreground font-medium truncate">
                            📌 {k.bolumBasligi}
                          </div>
                        )}
                        <p className="text-muted-foreground line-clamp-3 italic bg-background p-2 rounded border border-border/50">
                          &quot;{k.alinti}&quot;
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {/* SEKME 2: YENİ BELGE YÜKLE */}
      {aktifSekme === "yukle" && (
        <Card className="p-6 max-w-2xl mx-auto space-y-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <span>📤</span> Yeni Sözleşme / Şartname Yükle
          </h2>
          <p className="text-sm text-muted-foreground">
            PDF veya metin dosyasını yükleyin. Sistem metin katmanını ayıklayıp otomatik olarak sayfa ve maddelere göre indeksleyecektir.
          </p>

          <form onSubmit={belgeYukle} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">
                Belge Başlığı *
              </label>
              <input
                type="text"
                required
                value={yeniBaslik}
                onChange={(e) => setYeniBaslik(e.target.value)}
                placeholder="Örn: 2026 ERP Yazılım ve Lisans Sözleşmesi"
                className="w-full px-3 py-2 border rounded-md text-sm bg-background"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">
                  Belge Türü
                </label>
                <Select
                  value={yeniTur}
                  onChange={(e) => setYeniTur(e.target.value as SozlesmeTuru)}
                  className="w-full"
                >
                  <option value="sozlesme">Ticari Sözleşme</option>
                  <option value="sartname">Teknik / İdari Şartname</option>
                  <option value="protokol">Ek Protokol / Zeyilname</option>
                  <option value="teklif_eki">Teklif Şartı & Eki</option>
                  <option value="diger">Diğer Hukuki Belge</option>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">
                  Geçerlilik Bitiş Tarihi (Opsiyonel)
                </label>
                <input
                  type="date"
                  value={yeniGecerlilik}
                  onChange={(e) => setYeniGecerlilik(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">
                Dosya Seç (PDF veya Metin, azami 25 MB) *
              </label>
              <input
                type="file"
                required
                accept=".pdf,.txt,.md"
                onChange={(e) => setSecilenDosya(e.target.files?.[0] || null)}
                className="w-full p-2 border border-dashed rounded-md text-sm bg-background file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
              />
              {secilenDosya && (
                <div className="text-xs text-muted-foreground mt-1">
                  Seçilen: {secilenDosya.name} ({(secilenDosya.size / (1024 * 1024)).toFixed(2)} MB)
                </div>
              )}
            </div>

            <div className="pt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAktifSekme("liste")}
              >
                İptal
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={dosyaYukleniyor || !secilenDosya || !yeniBaslik.trim()}
              >
                {dosyaYukleniyor ? "İşleniyor..." : "Yükle ve İndeksle"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* SEKME 3: BELGE LİSTESİ */}
      {aktifSekme === "liste" && (
        <div className="space-y-4">
          <Card className="p-4 flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="flex items-center gap-3 w-full md:w-auto">
              <Select
                value={turFiltre}
                onChange={(e) => setTurFiltre(e.target.value)}
                className="w-48"
              >
                <option value="hepsi">Tüm Türler</option>
                <option value="sozlesme">Ticari Sözleşmeler</option>
                <option value="sartname">Şartnameler</option>
                <option value="protokol">Protokoller</option>
                <option value="teklif_eki">Teklif Ekleri</option>
                <option value="diger">Diğer</option>
              </Select>
              <input
                type="text"
                placeholder="Başlık, dosya adı veya özette ara..."
                value={aramaMetni}
                onChange={(e) => setAramaMetni(e.target.value)}
                className="px-3 py-1.5 border rounded-md text-sm bg-background w-full md:w-72"
              />
            </div>

            <div className="text-xs text-muted-foreground">
              Toplam {belgeler.length} aktif belge
            </div>
          </Card>

          {yukleniyor ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Sözleşmeler listeleniyor...
            </div>
          ) : belgeler.length === 0 ? (
            <Card className="p-12 text-center space-y-3">
              <div className="text-3xl">📄</div>
              <h3 className="font-semibold text-foreground">Henüz Sözleşme Bulunmuyor</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Hukuki sözleşme, idari/teknik şartname veya protokollerinizi PDF formatında yükleyerek yapay zekâ destekli semantik arama ve madde analizi yapabilirsiniz.
              </p>
              <Button variant="primary" onClick={() => setAktifSekme("yukle")}>
                İlk Belgenizi Yükleyin
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {belgeler.map((b) => (
                <Card key={b.id} className="p-5 flex flex-col justify-between space-y-4 hover:border-primary/40 transition">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <Badge variant={TUR_RENKLERI[b.tur]}>
                        {TUR_METINLERI[b.tur]}
                      </Badge>
                      <span className="text-xs font-semibold px-2 py-0.5 bg-muted rounded text-muted-foreground">
                        v{b.surum}
                      </span>
                    </div>

                    <h3 className="font-semibold text-foreground text-base line-clamp-2">
                      {b.baslik}
                    </h3>

                    {b.cari && (
                      <div className="text-xs text-primary font-medium flex items-center gap-1">
                        <span>🏢</span> {b.cari.unvan}
                      </div>
                    )}

                    {b.ozet && (
                      <p className="text-xs text-muted-foreground line-clamp-3 bg-muted/30 p-2 rounded">
                        {b.ozet}
                      </p>
                    )}
                  </div>

                  <div className="space-y-3 pt-3 border-t text-xs text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span>📄 {b.sayfaSayisi} sayfa ({b._count?.parcalar ?? 0} parça)</span>
                      <span>{(b.boyut / 1024).toFixed(0)} KB</span>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setSecilenBelgeId(b.id);
                          setAktifSekme("sor");
                        }}
                      >
                        🔍 Soru Sor
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => belgeSil(b.id, b.baslik)}
                      >
                        Sil
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
