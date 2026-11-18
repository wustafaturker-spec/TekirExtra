"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Stat,
  StatGrid,
  TableWrap,
} from "@/components/ui";

interface AlanKaniti {
  sayfa?: number;
  alinti?: string;
  guven: number;
}

interface DogrulamaSonucu {
  gecerli: boolean;
  matematikselUyumlu: boolean;
  hesaplananToplam: number;
  genelToplam: number;
  fark: number;
  eslesmeKesinligi: string;
  eslesenCari: { id: string; unvan: string; kod: string } | null;
  uyarilar: string[];
  hatalar: string[];
  celiskiler: string[];
}

interface TarananBelge {
  id: string;
  dosyaAdi: string;
  dosyaBoyutu: number;
  sayfaSayisi: number;
  mimeTip: string;
  durum: "KUYRUKTA" | "ISLENIYOR" | "INCELENECEK" | "ONAYLANDI" | "ISLENDI" | "REDDEDILDI" | "HATA";
  guvenPuani: string | number | null;
  mukerrerAdayId: string | null;
  createdAt: string;
  cikarilanVeri?: Record<string, any>;
  alanKanitlari?: Record<string, AlanKaniti>;
  dogrulamaSonucu?: DogrulamaSonucu;
  kullaniciDuzeltmesi?: Record<string, any>;
  olusanKayitlar?: { masrafIdler?: string[]; faturaId?: string };
  hataMesaji?: string | null;
}

interface KuyrukIsi {
  id: string;
  toplamBelge: number;
  tamamlananBelge: number;
  hataliBelge: number;
  durum: string;
  createdAt: string;
  belgeler: TarananBelge[];
}

export default function BelgeTaramaKuyruguSayfasi() {
  const [isler, setIsler] = useState<KuyrukIsi[] | null>(null);
  const [seciliBelge, setSeciliBelge] = useState<TarananBelge | null>(null);
  const [modalAcik, setModalAcik] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [listeHatasi, setListeHatasi] = useState("");
  const [yuklemeIslemi, setYuklemeIslemi] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [basari, setBasari] = useState<string | null>(null);
  const [filtreDurum, setFiltreDurum] = useState<string>("tumu");

  // Düzenleme formu alanları
  const [formSaticiUnvan, setFormSaticiUnvan] = useState("");
  const [formVkn, setFormVkn] = useState("");
  const [formBelgeNo, setFormBelgeNo] = useState("");
  const [formTarih, setFormTarih] = useState("");
  const [formGenelToplam, setFormGenelToplam] = useState("");
  const [formToplamMatrah, setFormToplamMatrah] = useState("");
  const [formToplamKdv, setFormToplamKdv] = useState("");
  const [formParaBirimi, setFormParaBirimi] = useState("TRY");
  const [islemKaydediliyor, setIslemKaydediliyor] = useState(false);

  const dosyaGirdiRef = useRef<HTMLInputElement>(null);

  const listeIstegi = useRef<AbortController | null>(null);

  const verileriYukle = useCallback(async (arkaPlan = false) => {
    if (arkaPlan && listeIstegi.current) return;
    listeIstegi.current?.abort();
    const kontrol = new AbortController();
    listeIstegi.current = kontrol;
    if (!arkaPlan) setYukleniyor(true);
    try {
      const sonuc = await api<{ kayitlar: KuyrukIsi[] }>("/ai/belge-kuyruk/isler?limit=15", { signal: kontrol.signal });
      if (kontrol.signal.aborted) return;
      setIsler(sonuc.kayitlar ?? []);
      setListeHatasi("");
    } catch (e) {
      if (!kontrol.signal.aborted) setListeHatasi(e instanceof Error ? e.message : "Kuyruk listesi yüklenemedi.");
    } finally {
      if (listeIstegi.current === kontrol) {
        listeIstegi.current = null;
        setYukleniyor(false);
      }
    }
  }, []);

  useEffect(() => {
    void verileriYukle();
    const interval = window.setInterval(() => void verileriYukle(true), 4000);
    return () => {
      window.clearInterval(interval);
      listeIstegi.current?.abort();
      listeIstegi.current = null;
    };
  }, [verileriYukle]);

  // Çoklu dosya yükleme
  const dosyalarıGonder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (files.length > 20) {
      setHata("Tek seferde azami 20 belge seçebilirsiniz.");
      return;
    }

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("dosyalar", files[i]);
    }

    try {
      setYuklemeIslemi(true);
      setHata(null);
      setBasari(null);
      const res = await api<{ toplamBelge: number }>("/ai/belge-kuyruk/yukle", {
        method: "POST",
        body: formData,
      });
      setBasari(`${res.toplamBelge} adet belge başarıyla kuyruğa alındı ve işlenmeye başlandı.`);
      if (dosyaGirdiRef.current) dosyaGirdiRef.current.value = "";
      await verileriYukle();
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Dosyalar yüklenirken hata oluştu.");
    } finally {
      setYuklemeIslemi(false);
    }
  };

  // İnceleme modalını aç
  const inceleModalAc = async (belge: TarananBelge) => {
    try {
      const detay = await api<TarananBelge>(`/ai/belge-kuyruk/belgeler/${belge.id}`);
      setSeciliBelge(detay);
      const veri = { ...(detay.cikarilanVeri || {}), ...(detay.kullaniciDuzeltmesi || {}) };
      setFormSaticiUnvan(veri.saticiUnvan || "");
      setFormVkn(veri.saticiVknTckn || "");
      setFormBelgeNo(veri.belgeNo || "");
      setFormTarih(veri.tarih || "");
      setFormGenelToplam(veri.genelToplam?.toString() || "");
      setFormToplamMatrah(veri.toplamMatrah?.toString() || "");
      setFormToplamKdv(veri.toplamKdv?.toString() || "");
      setFormParaBirimi(veri.paraBirimi || "TRY");
      setModalAcik(true);
    } catch (e) {
      setHata("Belge detayı alınamadı.");
    }
  };

  // Kullanıcı düzeltmelerini kaydet
  const duzeltmeKaydet = async () => {
    if (!seciliBelge) return;
    try {
      setIslemKaydediliyor(true);
      setHata(null);
      const guncellenmis = await api<TarananBelge>(`/ai/belge-kuyruk/belgeler/${seciliBelge.id}/duzelt`, {
        method: "PATCH",
        body: JSON.stringify({
          saticiUnvan: formSaticiUnvan || undefined,
          saticiVknTckn: formVkn || undefined,
          belgeNo: formBelgeNo || undefined,
          tarih: formTarih || undefined,
          genelToplam: formGenelToplam ? parseFloat(formGenelToplam) : undefined,
          toplamMatrah: formToplamMatrah ? parseFloat(formToplamMatrah) : undefined,
          toplamKdv: formToplamKdv ? parseFloat(formToplamKdv) : undefined,
          paraBirimi: formParaBirimi,
        }),
      });
      setSeciliBelge(guncellenmis);
      setBasari("Düzeltmeler kaydedildi ve çapraz doğrulama yenilendi.");
      await verileriYukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Düzeltme kaydedilemedi.");
    } finally {
      setIslemKaydediliyor(false);
    }
  };

  // Masraf veya Alış Faturasına aktar
  const kaydaAktar = async (hedef: "MASRAF" | "ALIS_FATURASI") => {
    if (!seciliBelge) return;
    try {
      setIslemKaydediliyor(true);
      setHata(null);
      await api(`/ai/belge-kuyruk/belgeler/${seciliBelge.id}/aktar`, {
        method: "POST",
        body: JSON.stringify({ hedef }),
      });
      setBasari(`Belge başarıyla ${hedef === "MASRAF" ? "Masraf" : "Alış Faturası"} taslağına dönüştürüldü.`);
      setModalAcik(false);
      await verileriYukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Aktarım sırasında hata oluştu.");
    } finally {
      setIslemKaydediliyor(false);
    }
  };

  // Belgeyi reddet
  const reddet = async () => {
    if (!seciliBelge) return;
    try {
      setIslemKaydediliyor(true);
      await api(`/ai/belge-kuyruk/belgeler/${seciliBelge.id}/reddet`, { method: "POST" });
      setBasari("Belge reddedildi.");
      setModalAcik(false);
      await verileriYukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "İşlem başarısız.");
    } finally {
      setIslemKaydediliyor(false);
    }
  };

  // İstatistikler
  const tumBelgeler = (isler ?? []).flatMap((i) => i.belgeler || []);
  const toplamSayi = tumBelgeler.length;
  const incelenecekSayi = tumBelgeler.filter((b) => b.durum === "INCELENECEK").length;
  const onayliSayi = tumBelgeler.filter((b) => b.durum === "ONAYLANDI").length;
  const islenenSayi = tumBelgeler.filter((b) => b.durum === "ISLENDI").length;

  const filtrelenmisBelgeler = tumBelgeler.filter((b) => {
    if (filtreDurum === "tumu") return true;
    return b.durum === filtreDurum;
  });

  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      <PageHeader
        title="Belge Kuyruğu ve OCR"
        subtitle="Fiş ve faturalarınızı toplu olarak yükleyin; arka planda taranan verileri sayfa/alıntı kanıtları ve aritmetik kontrollerle inceleyip masraf veya faturaya aktarın."
        actions={
          <div className="row-tight ocr-actions">
            <ButtonLabel as="a" href="/panel/masraflar">
              Masraflara Dön
            </ButtonLabel>
            <ButtonLabel as="a" href="/panel/fatura?yon=alis">
              Alış Faturaları
            </ButtonLabel>
          </div>
        }
      />

      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}

      {isler && <StatGrid>
        <Stat label="Görüntülenen belgeler" value={toplamSayi} />
        <Stat label="İnceleme Bekleyen" value={incelenecekSayi} hint="Çelişki veya düşük güven" />
        <Stat label="Onaylanan" value={onayliSayi} hint="Aktarıma hazır" />
        <Stat label="Kayda Aktarılan" value={islenenSayi} hint="Masraf / Fatura oldu" />
      </StatGrid>}

      {/* Toplu Yükleme Bölümü */}
      <Card
        title="Toplu Belge Yükleme"
        actions={
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            Azami 20 dosya · Dosya başı en fazla 15 MB · PDF / JPEG / PNG / WEBP
          </span>
        }
      >
        <div className="row-tight ocr-actions">
          <input ref={dosyaGirdiRef} type="file" aria-label="Belge dosyaları" multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp" hidden onChange={dosyalarıGonder} />
          <Button variant="primary" disabled={yuklemeIslemi} onClick={() => dosyaGirdiRef.current?.click()}>
            {yuklemeIslemi ? "Dosyalar yükleniyor…" : "Belge dosyalarını seç"}
          </Button>
        </div>
      </Card>

      {/* Belge Listesi ve Filtreler */}
      <Card
        className="ocr-liste"
        title="Taranan Belgeler"
        actions={
          <div className="row-tight ocr-actions">
            <Select aria-label="Belge durumu" value={filtreDurum} onChange={(e) => setFiltreDurum(e.target.value)}>
              <option value="tumu">Tüm Durumlar</option>
              <option value="INCELENECEK">İncelenecek (Çelişkili / Düşük Güven)</option>
              <option value="ONAYLANDI">Onaylandı (Aktarıma Hazır)</option>
              <option value="ISLENDI">İşlendi (Masraf / Fatura)</option>
              <option value="HATA">Hata Alanlar</option>
            </Select>
            <Button size="sm" onClick={() => void verileriYukle()} disabled={yukleniyor}>
              {yukleniyor ? "Yenileniyor..." : "Yenile"}
            </Button>
          </div>
        }
        pad={false}
      >
        {listeHatasi && <div className="ocr-liste-hatasi"><Alert tone="error">
          <div>{listeHatasi}</div>
          {isler && <div>Son başarılı güncellemenin verileri gösteriliyor.</div>}
          <Button size="sm" disabled={yukleniyor} onClick={() => void verileriYukle()}>Tekrar dene</Button>
        </Alert></div>}
        <TableWrap className="platform-responsive-table ocr-liste-tablo">
          <thead>
            <tr>
              <th>Dosya & Tarih</th>
              <th>Tür & Sayfa</th>
              <th>Satıcı & Belge No</th>
              <th>Tutar & KDV</th>
              <th>Güven Skoru</th>
              <th>Durum</th>
              <th>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {!isler ? (
              <tr><td colSpan={7} className="empty" role="status">{yukleniyor ? "Belgeler yükleniyor…" : "Belge listesi şu anda gösterilemiyor."}</td></tr>
            ) : filtrelenmisBelgeler.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "2rem" }}>
                  {listeHatasi ? "Son başarılı güncellemede bu görünümde belge yoktu."
                    : filtreDurum === "tumu" ? "Henüz belge yok." : "Bu duruma uyan belge yok."}
                </td>
              </tr>
            ) : (
              filtrelenmisBelgeler.map((b) => {
                const veri = { ...(b.cikarilanVeri || {}), ...(b.kullaniciDuzeltmesi || {}) };
                const guven = b.guvenPuani ? Math.round(Number(b.guvenPuani) * 100) : null;
                return (
                  <tr key={b.id}>
                    <td className="platform-cell-title">
                      <strong>{b.dosyaAdi}</strong>
                      <br />
                      <small className="muted">
                        {new Date(b.createdAt).toLocaleString("tr-TR")} · {(b.dosyaBoyutu / 1024).toFixed(0)} KB
                      </small>
                      {b.mukerrerAdayId && (
                        <div style={{ marginTop: "4px" }}>
                          <Badge variant="warning">Mükerrer aday</Badge>
                        </div>
                      )}
                    </td>
                    <td data-label="Tür ve sayfa">
                      <Badge variant="neutral">{veri.belgeTuru || "FIS/FATURA"}</Badge>
                      <br />
                      <small className="muted">{b.sayfaSayisi} sayfa</small>
                    </td>
                    <td data-label="Satıcı ve belge no">
                      <strong>{veri.saticiUnvan || "—"}</strong>
                      <br />
                      <small className="muted">
                        {veri.belgeNo ? `#${veri.belgeNo}` : "No yok"} · {veri.saticiVknTckn || "VKN yok"}
                      </small>
                    </td>
                    <td data-label="Tutar">
                      <strong>
                        {veri.genelToplam !== undefined ? `${Number(veri.genelToplam).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${veri.paraBirimi || "TRY"}` : "—"}
                      </strong>
                      <br />
                      <small className="muted">
                        KDV: {veri.toplamKdv !== undefined ? `${Number(veri.toplamKdv).toFixed(2)}` : "—"}
                      </small>
                    </td>
                    <td data-label="Güven skoru">
                      {guven !== null ? (
                        <Badge variant={guven >= 80 ? "success" : guven >= 60 ? "warning" : "danger"}>
                          %{guven}
                        </Badge>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td data-label="Durum">
                      <Badge
                        variant={
                          b.durum === "ISLENDI"
                            ? "success"
                            : b.durum === "ONAYLANDI"
                              ? "success"
                              : b.durum === "INCELENECEK"
                                ? "warning"
                                : b.durum === "HATA"
                                  ? "danger"
                                  : "neutral"
                        }
                      >
                        {b.durum === "ISLENDI"
                          ? "Kayıt Açıldı"
                          : b.durum === "ONAYLANDI"
                            ? "Onaylandı"
                            : b.durum === "INCELENECEK"
                              ? "İncelenecek"
                              : b.durum === "ISLENIYOR"
                                ? "Okunuyor"
                                : b.durum === "KUYRUKTA"
                                  ? "Kuyrukta"
                                  : b.durum}
                      </Badge>
                    </td>
                    <td data-label="İşlem">
                      <Button size="sm" variant="primary" onClick={() => inceleModalAc(b)}>
                        {b.durum === "INCELENECEK" ? "İncele" : b.durum === "ONAYLANDI" ? "Aktarımı incele" : "Ayrıntı"}
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>

      {/* Alan Kanıtlı İnceleme Modalı */}
      {modalAcik && seciliBelge && (
        <Modal
          baslik={`Belge İnceleme: ${seciliBelge.dosyaAdi}`}
          onKapat={() => setModalAcik(false)}
        >
          <div className="stack" style={{ gap: "1rem" }}>
            {seciliBelge.hataMesaji && <Alert tone="error">{seciliBelge.hataMesaji}</Alert>}
            {seciliBelge.mukerrerAdayId && (
              <Alert tone="warning">
                <strong>Dikkat: Mükerrer Belge Adayı!</strong> Bu belgeyle aynı dosya içeriğine (SHA-256) sahip bir kayıt son 90 gün içinde sisteme yüklenmiş. Eğer farklı bir döneme ait meşru bir belge ise onaylayıp devam edebilirsiniz.
              </Alert>
            )}

            {seciliBelge.dogrulamaSonucu?.celiskiler && seciliBelge.dogrulamaSonucu.celiskiler.length > 0 && (
              <Alert tone="error">
                <strong>Çözülmesi Gereken Çelişkiler (Aktarım Engellendi):</strong>
                <ul style={{ margin: "0.25rem 0 0 1rem" }}>
                  {seciliBelge.dogrulamaSonucu.celiskiler.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </Alert>
            )}

            {seciliBelge.dogrulamaSonucu?.uyarilar && seciliBelge.dogrulamaSonucu.uyarilar.length > 0 && (
              <div style={{ background: "#fefce8", padding: "0.75rem", borderRadius: "6px", fontSize: "0.85rem" }}>
                <strong>Doğrulama Uyarıları:</strong>
                <ul style={{ margin: "0.25rem 0 0 1rem" }}>
                  {seciliBelge.dogrulamaSonucu.uyarilar.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Alan Kanıtları Bilgi Kutusu */}
            {seciliBelge.alanKanitlari && Object.keys(seciliBelge.alanKanitlari).length > 0 && (
              <Card title="Metin ve Sayfa Kanıtları (Alıntılar)">
                <div className="ocr-inceleme-grid" style={{ fontSize: "0.85rem" }}>
                  {Object.entries(seciliBelge.alanKanitlari).map(([alan, kanit]) => (
                    <div key={alan} style={{ background: "#f1f5f9", padding: "0.5rem 0.75rem", borderRadius: "4px" }}>
                      <strong>{alan}:</strong> {kanit.sayfa ? `[Sayfa ${kanit.sayfa}] ` : ""}
                      <span style={{ fontStyle: "italic", color: "#334155" }}>"{kanit.alinti || "Belirtilmemiş"}"</span>
                      <small style={{ float: "right", color: "#64748b" }}>%{Math.round(kanit.guven * 100)}</small>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Düzeltme & Aktarım Formu */}
            <Card title="Belge bilgileri">
              <fieldset className="ocr-inceleme-grid" disabled={seciliBelge.durum === "ISLENDI" || islemKaydediliyor}>
                <Field label="Satıcı Ünvanı">
                  <Input value={formSaticiUnvan} onChange={(e) => setFormSaticiUnvan(e.target.value)} />
                </Field>
                <Field label="Satıcı VKN / TCKN">
                  <Input value={formVkn} onChange={(e) => setFormVkn(e.target.value)} />
                </Field>
                <Field label="Belge No">
                  <Input value={formBelgeNo} onChange={(e) => setFormBelgeNo(e.target.value)} />
                </Field>
                <Field label="Belge Tarihi (YYYY-MM-DD)">
                  <Input type="date" value={formTarih} onChange={(e) => setFormTarih(e.target.value)} />
                </Field>
                <Field label="Genel Toplam">
                  <Input type="number" step="0.01" value={formGenelToplam} onChange={(e) => setFormGenelToplam(e.target.value)} />
                </Field>
                <Field label="Toplam Matrah">
                  <Input type="number" step="0.01" value={formToplamMatrah} onChange={(e) => setFormToplamMatrah(e.target.value)} />
                </Field>
                <Field label="Toplam KDV">
                  <Input type="number" step="0.01" value={formToplamKdv} onChange={(e) => setFormToplamKdv(e.target.value)} />
                </Field>
                <Field label="Para Birimi">
                  <Select value={formParaBirimi} onChange={(e) => setFormParaBirimi(e.target.value)}>
                    <option value="TRY">TRY</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </Select>
                </Field>
              </fieldset>

              {seciliBelge.durum !== "ISLENDI" && <div className="row-tight ocr-actions" style={{ marginTop: "1rem", justifyContent: "flex-end" }}>
                <Button onClick={duzeltmeKaydet} disabled={islemKaydediliyor}>
                  {islemKaydediliyor ? "Kaydediliyor..." : "Düzeltmeleri Kaydet & Doğrula"}
                </Button>
              </div>}
            </Card>

            {/* Eylemler */}
            <div className="row-tight ocr-actions" style={{ justifyContent: "flex-end" }}>
              <Button onClick={() => setModalAcik(false)}>Kapat</Button>
              {seciliBelge.durum !== "ISLENDI" && <>
                <Button variant="danger" onClick={reddet} disabled={islemKaydediliyor}>Belgeyi Reddet</Button>
                <Button
                  variant="primary"
                  onClick={() => kaydaAktar("MASRAF")}
                  disabled={islemKaydediliyor || (seciliBelge.dogrulamaSonucu?.celiskiler?.length ?? 0) > 0}
                >
                  Masraf Taslağı Oluştur
                </Button>
                <Button
                  variant="primary"
                  onClick={() => kaydaAktar("ALIS_FATURASI")}
                  disabled={islemKaydediliyor || (seciliBelge.dogrulamaSonucu?.celiskiler?.length ?? 0) > 0}
                >
                  Alış Faturası Oluştur
                </Button>
              </>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
