"use client";

import { useEffect, useState } from "react";
import { FileText, FolderOpen, Search, Sparkles, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  PageHeader,
  Select,
} from "@/components/ui";
import styles from "./sozlesmeler.module.css";

type SozlesmeTuru = "sozlesme" | "sartname" | "protokol" | "teklif_eki" | "diger";
type SozlesmeDurumu = "isleniyor" | "hazir" | "hatali" | "arsivlendi";

interface KaynakAlinti {
  belgeId: string;
  belgeBaslik: string;
  surum: number;
  sayfaNo: number;
  bolumBasligi?: string;
  alinti: string;
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
  cari?: { unvan: string } | null;
  _count?: { parcalar: number };
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

const DURUMLAR = {
  hazir: { etiket: "Hazır", renk: "success" },
  isleniyor: { etiket: "İşleniyor", renk: "info" },
  hatali: { etiket: "Hatalı", renk: "warning" },
  arsivlendi: { etiket: "Arşivlendi", renk: "neutral" },
} as const;

const ORNEK_SORULAR = [
  ["Cezai şartlar", "Cezai şart ve tazminat koşulları nelerdir?"],
  ["Fesih süreleri", "Fesih ihbar süresi ve haklı fesih halleri nelerdir?"],
  ["Ödeme ve vade", "Ödeme vadeleri ve faturalandırma şartları nedir?"],
  ["Garanti ve bakım", "Garanti, bakım ve destek taahhütleri nelerdir?"],
];

const TARIH_BICIMI = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "UTC" });

export default function SozlesmelerRAGPage() {
  const [aktifSekme, setAktifSekme] = useState<"liste" | "sor" | "yukle">("liste");
  const [belgeler, setBelgeler] = useState<SozlesmeBelge[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [listeHatasi, setListeHatasi] = useState<string | null>(null);
  const [listeSurumu, setListeSurumu] = useState(0);
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

  const [silinenBelgeId, setSilinenBelgeId] = useState<string | null>(null);

  // Yeni Belge Yükleme Formu
  const [yeniBaslik, setYeniBaslik] = useState("");
  const [yeniTur, setYeniTur] = useState<SozlesmeTuru>("sozlesme");
  const [yeniGecerlilik, setYeniGecerlilik] = useState("");
  const [secilenDosya, setSecilenDosya] = useState<File | null>(null);
  const [dosyaYukleniyor, setDosyaYukleniyor] = useState(false);

  const listeFiltresi = aktifSekme === "liste" ? turFiltre : "hepsi";
  const listeAramasi = aktifSekme === "liste" ? aramaMetni.trim() : "";
  const belgeYuklemeAcik = aktifSekme === "yukle";

  useEffect(() => {
    if (belgeYuklemeAcik) return;
    const istek = new AbortController();
    setYukleniyor(true);
    setListeHatasi(null);

    const p = new URLSearchParams();
    if (listeFiltresi !== "hepsi") p.set("tur", listeFiltresi);
    if (listeAramasi) p.set("arama", listeAramasi);
    const sorgu = p.size ? `?${p}` : "";

    async function listele() {
      try {
        const sonuc = await api<SozlesmeBelge[]>(`/ai/sozlesme${sorgu}`, { signal: istek.signal });
        if (!istek.signal.aborted) setBelgeler(sonuc || []);
      } catch (e) {
        if (!istek.signal.aborted) {
          setListeHatasi(e instanceof Error ? e.message : "Sözleşmeler yüklenirken bir hata oluştu.");
        }
      } finally {
        if (!istek.signal.aborted) setYukleniyor(false);
      }
    }

    const zamanlayici = window.setTimeout(listele, listeAramasi ? 250 : 0);
    return () => {
      window.clearTimeout(zamanlayici);
      istek.abort();
    };
  }, [belgeYuklemeAcik, listeFiltresi, listeAramasi, listeSurumu]);

  // Soru Sor (RAG)
  const soruSor = async (soruMetni?: string) => {
    const sorulacak = (soruMetni || soru).trim();
    if (!sorulacak || soruluyor) return;

    setRagSonuc(null);

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
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Soru yanıtlanırken bir hata oluştu.");
    } finally {
      setSoruluyor(false);
    }
  };

  // Yeni Belge Yükle
  const belgeYukle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dosyaYukleniyor) return;
    if (!secilenDosya) {
      setHata("Lütfen bir dosya seçin.");
      return;
    }
    if (!yeniBaslik.trim()) {
      setHata("Lütfen belge başlığı girin.");
      return;
    }

    if (secilenDosya.size > 25 * 1024 * 1024) {
      setHata("Dosya boyutu 25 MB sınırını aşamaz.");
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

      setBasari("Belge yüklendi ve sorgulamaya hazır.");
      setYeniBaslik("");
      setSecilenDosya(null);
      setYeniGecerlilik("");
      setAktifSekme("liste");
      setListeSurumu((surum) => surum + 1);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Belge yüklenirken bir hata oluştu.");
    } finally {
      setDosyaYukleniyor(false);
    }
  };

  // Belge Sil
  const belgeSil = async (id: string, baslik: string) => {
    if (silinenBelgeId || !confirm(`"${baslik}" belgesini ve tüm indeks parçalarını silmek istediğinize emin misiniz?`)) return;

    setSilinenBelgeId(id);
    setHata(null);
    try {
      await api(`/ai/sozlesme/${id}`, { method: "DELETE" });
      setBasari(`"${baslik}" başarıyla silindi.`);
      setSecilenBelgeId((secilen) => secilen === id ? "" : secilen);
      setListeSurumu((surum) => surum + 1);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Belge silinirken hata oluştu.");
    } finally {
      setSilinenBelgeId(null);
    }
  };

  const filtreVar = turFiltre !== "hepsi" || Boolean(aramaMetni.trim());

  function sekmeyeGec(sekme: typeof aktifSekme) {
    if (aktifSekme === "yukle" && sekme !== "yukle") setSecilenDosya(null);
    setAktifSekme(sekme);
  }

  function filtreleriTemizle() {
    setTurFiltre("hepsi");
    setAramaMetni("");
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerIcon}><FileText size={25} aria-hidden /></div>
        <PageHeader
          title="Sözleşmeler"
          subtitle="Sözleşme, şartname ve protokollerinizi yönetin. Yapay zekâ ile maddeleri sayfa referanslarıyla inceleyin."
          actions={
            <Button type="button" variant="primary" onClick={() => setAktifSekme("yukle")}>
              <Upload size={16} aria-hidden /> Yeni belge
            </Button>
          }
        />
      </header>

      <nav aria-label="Sözleşme işlemleri" className={styles.navigation}>
        <button type="button" disabled={dosyaYukleniyor} aria-current={aktifSekme === "liste" ? "page" : undefined} onClick={() => sekmeyeGec("liste")}>
          <FolderOpen size={17} aria-hidden /> Belge kütüphanesi
        </button>
        <button type="button" disabled={dosyaYukleniyor} aria-current={aktifSekme === "sor" ? "page" : undefined} onClick={() => sekmeyeGec("sor")}>
          <Sparkles size={17} aria-hidden /> Belgelere soru sor
        </button>
      </nav>

      {hata && <Alert tone="error"><div className={styles.between}><span>{hata}</span><Button type="button" size="sm" onClick={() => setHata(null)}>Kapat</Button></div></Alert>}
      {basari && <Alert tone="success"><div className={styles.between}><span>{basari}</span><Button type="button" size="sm" onClick={() => setBasari(null)}>Kapat</Button></div></Alert>}

      {aktifSekme === "liste" && (
        <Card pad={false} className={styles.library} aria-busy={yukleniyor}>
          <div className={styles.toolbar}>
            <div>
              <h2>Belge kütüphanesi</h2>
              {!yukleniyor && !listeHatasi && <p role="status">{belgeler.length} {filtreVar ? "sonuç" : "belge"}</p>}
            </div>
            <div className={styles.filters}>
              <div className={styles.search}>
                <Search size={16} aria-hidden />
                <Input type="search" aria-label="Belgelerde ara" placeholder="Başlık, dosya adı veya özet" value={aramaMetni} onChange={(e) => setAramaMetni(e.target.value)} />
              </div>
              <Select aria-label="Belge türüne göre filtrele" value={turFiltre} onChange={(e) => setTurFiltre(e.target.value)}>
                <option value="hepsi">Tüm belge türleri</option>
                {Object.entries(TUR_METINLERI).map(([deger, etiket]) => <option key={deger} value={deger}>{etiket}</option>)}
              </Select>
            </div>
          </div>

          {yukleniyor ? (
            <div className={styles.empty} role="status">Belgeler yükleniyor…</div>
          ) : listeHatasi ? (
            <div className={styles.empty}>
              <Alert tone="error">{listeHatasi}</Alert>
              <Button type="button" onClick={() => setListeSurumu((surum) => surum + 1)}>Tekrar dene</Button>
            </div>
          ) : belgeler.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>{filtreVar ? <Search size={23} aria-hidden /> : <FolderOpen size={23} aria-hidden />}</div>
              <h3>{filtreVar ? "Eşleşen belge bulunamadı" : "Henüz belge yok"}</h3>
              <p>{filtreVar ? "Başka bir arama yapın veya filtreleri temizleyin." : "Sözleşme, şartname veya protokol yükleyerek kütüphanenizi oluşturun."}</p>
              {filtreVar ? (
                <Button type="button" onClick={filtreleriTemizle}>Filtreleri temizle</Button>
              ) : (
                <Button type="button" onClick={() => setAktifSekme("yukle")}><Upload size={16} aria-hidden /> Belge yükle</Button>
              )}
            </div>
          ) : (
            <ul className={styles.documents}>
              {belgeler.map((belge) => (
                <li key={belge.id} className={styles.document}>
                  <div className={styles.fileIcon}><FileText size={20} aria-hidden /></div>
                  <div className={styles.documentDetails}>
                    <h3>{belge.baslik}</h3>
                    <p>{belge.dosyaAdi}{belge.cari && ` · ${belge.cari.unvan}`}</p>
                    {belge.ozet && <p className={styles.summary}>{belge.ozet}</p>}
                    <div className={styles.metadata}>
                      <span>Sürüm {belge.surum}</span>
                      <span>{belge.sayfaSayisi} sayfa</span>
                      {belge._count && <span>{belge._count.parcalar} metin parçası</span>}
                      <span>{Math.ceil(belge.boyut / 1024)} KB</span>
                      {belge.gecerlilikBitis && <span>Geçerlilik sonu {TARIH_BICIMI.format(new Date(belge.gecerlilikBitis))}</span>}
                    </div>
                  </div>
                  <div className={styles.tags}>
                    <Badge variant={TUR_RENKLERI[belge.tur]}>{TUR_METINLERI[belge.tur]}</Badge>
                    <Badge variant={DURUMLAR[belge.durum].renk}>{DURUMLAR[belge.durum].etiket}</Badge>
                  </div>
                  <div className={styles.documentActions}>
                    <Button type="button" size="sm" disabled={soruluyor} onClick={() => {
                      setSecilenBelgeId(belge.id);
                      setRagSonuc(null);
                      setAktifSekme("sor");
                    }}>
                      <Sparkles size={15} aria-hidden /> Soru sor
                    </Button>
                    <Button type="button" size="sm" className={styles.delete} aria-label={`${belge.baslik} belgesini sil`} title="Belgeyi sil" disabled={silinenBelgeId !== null} onClick={() => belgeSil(belge.id, belge.baslik)}>
                      <Trash2 size={16} aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {aktifSekme === "sor" && (
        <>
          <Card pad={false} className={styles.content} aria-busy={soruluyor}>
            <div className={styles.sectionTitle}>
              <div className={styles.fileIcon}><Sparkles size={20} aria-hidden /></div>
              <div>
                <h2>Belgelere soru sor</h2>
                <p>Yetkili olduğunuz belgelerde arayın ve yanıtı dayanak alıntılarıyla inceleyin.</p>
              </div>
            </div>
            {listeHatasi && <Alert tone="error">{listeHatasi}</Alert>}
            <form className={styles.form} onSubmit={(e) => { e.preventDefault(); void soruSor(); }}>
              <label className={styles.field}>
                Belge kapsamı
                <Select value={secilenBelgeId} disabled={yukleniyor || soruluyor} onChange={(e) => {
                  setSecilenBelgeId(e.target.value);
                  setRagSonuc(null);
                }}>
                  <option value="">Tüm yetkili belgeler</option>
                  {belgeler.map((belge) => <option key={belge.id} value={belge.id}>{belge.baslik} (v{belge.surum})</option>)}
                </Select>
              </label>
              <label className={styles.field}>
                Sorunuz
                <Input value={soru} disabled={soruluyor} onChange={(e) => setSoru(e.target.value)} placeholder="Örneğin, gecikme cezası nasıl hesaplanır?" />
              </label>
              <div className={styles.formActions}>
                <Button type="submit" variant="primary" disabled={soruluyor || !soru.trim()}>
                  <Sparkles size={16} aria-hidden /> {soruluyor ? "Belgeler inceleniyor…" : "Yanıtı getir"}
                </Button>
              </div>
            </form>
            <div className={styles.examples}>
              <span>Örnek sorular</span>
              {ORNEK_SORULAR.map(([etiket, metin]) => (
                <Button key={etiket} type="button" size="sm" disabled={soruluyor} onClick={() => { setSoru(metin); void soruSor(metin); }}>{etiket}</Button>
              ))}
            </div>
          </Card>

          {ragSonuc && (
            <Card pad={false} className={styles.content} aria-live="polite">
              <div className={styles.between}>
                <h2>Yanıt</h2>
                {ragSonuc.guvenSkoru === "yuksek" ? <Badge variant="success">Yüksek güven</Badge>
                  : ragSonuc.guvenSkoru === "orta" ? <Badge variant="warning">Kısmi dayanak</Badge>
                    : <Badge variant="neutral">Hüküm bulunamadı</Badge>}
              </div>
              <p className={styles.answer}>{ragSonuc.cevap}</p>
              <p className={styles.answerDetails}>İncelenen metin parçası sayısı {ragSonuc.toplamParcaSayisi}</p>
              {ragSonuc.kaynaklar?.length > 0 && (
                <section className={styles.sources}>
                  <h3>Kaynak alıntıları ({ragSonuc.kaynaklar.length})</h3>
                  {ragSonuc.kaynaklar.map((kaynak, sira) => (
                    <article className={styles.source} key={`${kaynak.belgeId}-${kaynak.sayfaNo}-${sira}`}>
                      <div className={styles.between}>
                        <strong>{kaynak.belgeBaslik} · v{kaynak.surum}</strong>
                        <Badge variant="accent">Sayfa {kaynak.sayfaNo}</Badge>
                      </div>
                      {kaynak.bolumBasligi && <p>{kaynak.bolumBasligi}</p>}
                      <blockquote>{kaynak.alinti}</blockquote>
                    </article>
                  ))}
                </section>
              )}
            </Card>
          )}
        </>
      )}

      {aktifSekme === "yukle" && (
        <Card pad={false} className={`${styles.content} ${styles.upload}`}>
          <div className={styles.sectionTitle}>
            <div className={styles.fileIcon}><Upload size={20} aria-hidden /></div>
            <div>
              <h2>Yeni belge yükle</h2>
              <p>Yüklenen belgenin metni, kaynak göstererek sorgulanabilmesi için indekslenir.</p>
            </div>
          </div>
          <form className={styles.form} onSubmit={belgeYukle} aria-busy={dosyaYukleniyor}>
            <label className={styles.field}>
              Belge başlığı
              <Input required value={yeniBaslik} onChange={(e) => setYeniBaslik(e.target.value)} placeholder="Örneğin, ERP lisans sözleşmesi" />
            </label>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                Belge türü
                <Select value={yeniTur} onChange={(e) => setYeniTur(e.target.value as SozlesmeTuru)}>
                  {Object.entries(TUR_METINLERI).map(([deger, etiket]) => <option key={deger} value={deger}>{etiket}</option>)}
                </Select>
              </label>
              <label className={styles.field}>
                Geçerlilik bitişi (isteğe bağlı)
                <Input type="date" value={yeniGecerlilik} onChange={(e) => setYeniGecerlilik(e.target.value)} />
              </label>
            </div>
            <label className={`${styles.field} ${styles.fileField}`}>
              Belge dosyası
              <span>PDF, TXT veya MD · En fazla 25 MB</span>
              <Input type="file" required accept=".pdf,.txt,.md" onChange={(e) => setSecilenDosya(e.target.files?.[0] ?? null)} />
            </label>
            <div className={styles.formActions}>
              <Button type="button" disabled={dosyaYukleniyor} onClick={() => sekmeyeGec("liste")}>İptal</Button>
              <Button type="submit" variant="primary" disabled={dosyaYukleniyor || !secilenDosya || !yeniBaslik.trim()}>
                <Upload size={16} aria-hidden /> {dosyaYukleniyor ? "Belge işleniyor…" : "Yükle ve indeksle"}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
