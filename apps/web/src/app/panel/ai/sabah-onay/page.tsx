"use client";

import { ClipboardCheck, Inbox, RefreshCw, ScanSearch } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import {
  Alert,
  Badge,
  BulkActionsBar,
  Button,
  Card,
  PageHeader,
  Select,
} from "@/components/ui";
import styles from "./sabah-onay.module.css";

type HazirlikTuru =
  | "fatura_stok_esleme"
  | "banka_ekstre_esleme"
  | "vadesi_gecen_hatirlatma"
  | "kritik_stok_talep"
  | "ay_sonu_kapanis";

type HazirlikDurumu =
  | "hazir"
  | "onaylandi"
  | "reddedildi"
  | "suresi_doldu"
  | "hedef_degisti"
  | "hata";

interface HazirlikKaydi {
  id: string;
  tur: HazirlikTuru;
  turBasligi: string;
  kisaAd: string;
  durum: HazirlikDurumu;
  baslik: string;
  ozet: string;
  oneri: Record<string, any>;
  kanit: Record<string, any> | null;
  alternatifler: any[] | null;
  hedefOzeti: string | null;
  gecerlilikBitisAt: string;
  olusturan: string | null;
  onaylayan: string | null;
  kararAt: string | null;
  kararNotu: string | null;
  olusanKayitTur: string | null;
  olusanKayitId: string | null;
  createdAt: string;
}

const TUR_BADGE: Record<HazirlikTuru, { ad: string; variant: "info" | "warning" | "success" | "neutral" }> = {
  fatura_stok_esleme: { ad: "Stok Eşleme", variant: "info" },
  banka_ekstre_esleme: { ad: "Banka Eşleme", variant: "info" },
  vadesi_gecen_hatirlatma: { ad: "Vade Hatırlatma", variant: "warning" },
  kritik_stok_talep: { ad: "Kritik Stok Talebi", variant: "warning" },
  ay_sonu_kapanis: { ad: "Ay Sonu Kapanış", variant: "neutral" },
};

const DURUM_ROZET: Record<HazirlikDurumu, { ad: string; variant: "success" | "warning" | "danger" | "neutral" }> = {
  hazir: { ad: "Onay Bekliyor", variant: "warning" },
  onaylandi: { ad: "Onaylandı", variant: "success" },
  reddedildi: { ad: "Reddedildi", variant: "danger" },
  suresi_doldu: { ad: "Süresi Doldu", variant: "neutral" },
  hedef_degisti: { ad: "Kayıt Değişti", variant: "danger" },
  hata: { ad: "Hata", variant: "danger" },
};

const zaman = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" });

export default function SabahOnayKutusuSayfasi() {
  const [kapsam, setKapsam] = useState<"bana" | "firma">("bana");
  const [durum, setDurum] = useState<HazirlikDurumu | "">("hazir");
  const [tur, setTur] = useState<HazirlikTuru | "">("");
  const [kayitlar, setKayitlar] = useState<HazirlikKaydi[] | null>(null);
  const [secilenler, setSecilenler] = useState<Set<string>>(new Set());
  const [hata, setHata] = useState("");
  const [mesaj, setMesaj] = useState("");
  const [islem, setIslem] = useState<string | null>(null);
  const [calisiyor, setCalisiyor] = useState(false);
  const [duzenlenen, setDuzenlenen] = useState<{ id: string; konu: string; metin: string } | null>(null);

  const yukle = useCallback(async () => {
    setHata("");
    const q = new URLSearchParams({ kapsam });
    if (durum) q.set("durum", durum);
    if (tur) q.set("tur", tur);

    try {
      const data = await api<HazirlikKaydi[]>(`/ai/hazirlik?${q}`);
      setKayitlar(data);
      setSecilenler(new Set());
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Hazırlıklar yüklenemedi");
    }
  }, [kapsam, durum, tur]);

  useEffect(() => {
    if (tokenAl()) void yukle();
  }, [yukle]);

  const secimDegistir = (id: string) => {
    setSecilenler((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const tumunuSec = () => {
    if (!kayitlar) return;
    const bekleyenler = kayitlar.filter((k) => k.durum === "hazir").map((k) => k.id);
    if (secilenler.size === bekleyenler.length) setSecilenler(new Set());
    else setSecilenler(new Set(bekleyenler));
  };

  const onayla = async (id: string) => {
    setIslem(id);
    setHata("");
    setMesaj("");
    try {
      const oneri = duzenlenen?.id === id ? { konu: duzenlenen.konu, metin: duzenlenen.metin } : undefined;
      await api(`/ai/hazirlik/${id}/onayla`, { method: "POST", body: oneri ? JSON.stringify({ oneri }) : undefined });
      if (oneri) setDuzenlenen(null);
      setMesaj("Hazırlık onaylandı ve ilgili işlem gerçekleştirildi.");
      await yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Onaylama başarısız.");
    } finally {
      setIslem(null);
    }
  };

  const reddet = async (id: string) => {
    setIslem(id);
    setHata("");
    setMesaj("");
    try {
      await api(`/ai/hazirlik/${id}/reddet`, { method: "POST" });
      setMesaj("Hazırlık reddedildi.");
      await yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Reddetme başarısız.");
    } finally {
      setIslem(null);
    }
  };

  const topluOnayla = async () => {
    if (!secilenler.size) return;
    setIslem("toplu");
    setHata("");
    setMesaj("");
    try {
      const res = await api<{ basarili: string[]; basarisiz: { id: string; hata: string }[] }>("/ai/hazirlik/toplu-onayla", {
        method: "POST",
        body: JSON.stringify({ idler: Array.from(secilenler) }),
      });
      setMesaj(`${res.basarili.length} hazırlık onaylandı.${res.basarisiz.length ? ` (${res.basarisiz.length} işlem başarısız)` : ""}`);
      await yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Toplu onaylama başarısız.");
    } finally {
      setIslem(null);
    }
  };

  const topluReddet = async () => {
    if (!secilenler.size) return;
    setIslem("toplu");
    setHata("");
    setMesaj("");
    try {
      const res = await api<{ basarili: string[]; basarisiz: { id: string; hata: string }[] }>("/ai/hazirlik/toplu-reddet", {
        method: "POST",
        body: JSON.stringify({ idler: Array.from(secilenler) }),
      });
      setMesaj(`${res.basarili.length} hazırlık reddedildi.`);
      await yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Toplu reddetme başarısız.");
    } finally {
      setIslem(null);
    }
  };

  const hazirlaManuel = async () => {
    setCalisiyor(true);
    setHata("");
    setMesaj("");
    try {
      const res = await api<{ uretilenSayisi: number }>("/ai/hazirlik/calistir", { method: "POST" });
      setMesaj(`Hazırlık taraması tamamlandı: ${res.uretilenSayisi} yeni hazırlık üretildi.`);
      await yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Hazırlık taraması başlatılamadı.");
    } finally {
      setCalisiyor(false);
    }
  };

  const bekleyenSayisi = kayitlar?.filter((kayit) => kayit.durum === "hazir").length ?? 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.icon}><ClipboardCheck size={24} aria-hidden /></div>
        <PageHeader
          title="Sabah Onay Kutusu"
          subtitle="Yapay zekânın hazırladığı taslakları, gerekçeleri ve alternatifleri inceleyin. Uygun önerileri tek tek veya toplu onaylayın."
          actions={
            <div className={styles.actions}>
              <Button size="sm" onClick={() => void yukle()} disabled={islem !== null}>
                <RefreshCw size={15} aria-hidden /> Yenile
              </Button>
              <Button size="sm" variant="primary" onClick={() => void hazirlaManuel()} disabled={calisiyor || islem !== null}>
                <ScanSearch size={16} aria-hidden /> {calisiyor ? "Taranıyor…" : "Şimdi Tara ve Hazırla"}
              </Button>
            </div>
          }
        />
      </header>

      {hata && <Alert tone="error">{hata}</Alert>}
      {mesaj && <Alert tone="success">{mesaj}</Alert>}

      <Card pad={false} className={styles.filters}>
        <div className={styles.filterHeader}>
          <div>
            <h2>Hazırlıklar</h2>
            {kayitlar && <p role="status">{kayitlar.length} kayıt · {bekleyenSayisi} onay bekliyor</p>}
          </div>
          {bekleyenSayisi > 0 && (
            <Button size="sm" onClick={tumunuSec} disabled={islem !== null}>
              {secilenler.size === bekleyenSayisi ? "Seçimi kaldır" : "Tüm bekleyenleri seç"}
            </Button>
          )}
        </div>
        <div className={styles.filterGrid}>
          <label className={styles.field}>
            Kapsam
            <Select value={kapsam} onChange={(e) => setKapsam(e.target.value as "bana" | "firma")}>
              <option value="bana">Bana Atananlar</option>
              <option value="firma">Tüm Firma (Yönetici)</option>
            </Select>
          </label>

          <label className={styles.field}>
            Durum
            <Select value={durum} onChange={(e) => setDurum(e.target.value as HazirlikDurumu | "")}>
              <option value="hazir">Onay Bekleyenler (Hazır)</option>
              <option value="onaylandi">Onaylananlar</option>
              <option value="reddedildi">Reddedilenler</option>
              <option value="hedef_degisti">Kaynak Değişenler</option>
              <option value="suresi_doldu">Süresi Dolanlar</option>
              <option value="">Tüm Durumlar</option>
            </Select>
          </label>

          <label className={styles.field}>
            Hazırlık türü
            <Select value={tur} onChange={(e) => setTur(e.target.value as HazirlikTuru | "")}>
              <option value="">Tüm Türler</option>
              <option value="fatura_stok_esleme">Gelen Fatura Stok Eşleme</option>
              <option value="banka_ekstre_esleme">Banka Ekstresi Eşleme</option>
              <option value="vadesi_gecen_hatirlatma">Vadesi Geçen Alacak Hatırlatma</option>
              <option value="kritik_stok_talep">Kritik Stok Satın Alma Talebi</option>
              <option value="ay_sonu_kapanis">Ay Sonu Kapanış Kontrolü</option>
            </Select>
          </label>
        </div>
      </Card>

      {secilenler.size > 0 && (
        <BulkActionsBar selectedCount={secilenler.size} onClear={() => setSecilenler(new Set())}>
          <div className={styles.actions}>
            <Button size="sm" variant="primary" disabled={islem !== null || Boolean(duzenlenen && secilenler.has(duzenlenen.id))} onClick={() => void topluOnayla()}>
              Seçilenleri Onayla ({secilenler.size})
            </Button>
            <Button size="sm" variant="danger" disabled={islem !== null} onClick={() => void topluReddet()}>
              Seçilenleri Reddet ({secilenler.size})
            </Button>
          </div>
        </BulkActionsBar>
      )}

      {!kayitlar && !hata && <Card className={styles.empty}><p role="status">Hazırlıklar yükleniyor…</p></Card>}

      {kayitlar && !kayitlar.length && (
        <Card className={styles.empty}>
          <div className={styles.icon}><Inbox size={22} aria-hidden /></div>
          <h2>{durum === "hazir" && !tur ? "Onay bekleyen hazırlık yok" : "Filtrelere uyan hazırlık yok"}</h2>
          <p>{durum === "hazir" && !tur ? "Yeni öneriler için hazırlık taraması başlatabilirsiniz." : "Sonuçları görmek için durum veya hazırlık türü seçimini değiştirin."}</p>
        </Card>
      )}

      {kayitlar && kayitlar.length > 0 && (
        <div className={styles.records}>
          {kayitlar.map((k) => {
            const turCfg = TUR_BADGE[k.tur] ?? { ad: k.tur, variant: "neutral" };
            const durumCfg = DURUM_ROZET[k.durum] ?? { ad: k.durum, variant: "neutral" };
            const secili = secilenler.has(k.id);
            const taslak = duzenlenen?.id === k.id ? duzenlenen : null;

            return (
              <Card key={k.id} className={secili ? styles.selected : undefined}>
                <div className={styles.record}>
                  {k.durum === "hazir" && (
                    <input
                      type="checkbox"
                      checked={secili}
                      onChange={() => secimDegistir(k.id)}
                      className={styles.checkbox}
                      aria-label={`${k.baslik} hazırlığını seç`}
                    />
                  )}

                  <div className={styles.details}>
                    <div className={styles.recordHeader}>
                      <div>
                        <div className={styles.badges}>
                          <Badge variant={turCfg.variant}>{turCfg.ad}</Badge>
                          <Badge variant={durumCfg.variant}>{durumCfg.ad}</Badge>
                        </div>
                        <h3>{k.baslik}</h3>
                      </div>
                      <time dateTime={k.createdAt}>Oluşturulma · {zaman(k.createdAt)}</time>
                    </div>

                    <p className={styles.summary}>{k.ozet}</p>

                    <div className={styles.proposal}>
                      <h4>Önerilen işlem</h4>
                      {k.tur === "fatura_stok_esleme" && (
                        <div>
                          Stok: <code>[{k.oneri.stokKod}] {k.oneri.stokAd}</code> · Miktar: {k.oneri.miktar} · Birim Fiyat: {k.oneri.birimFiyat} TL
                        </div>
                      )}
                      {k.tur === "banka_ekstre_esleme" && (
                        <div>
                          Önerilen Tür: <code>{k.oneri.tur}</code> · Cari: <strong>{k.oneri.cariUnvan ?? "Belirsiz"}</strong> · Tutar: {k.oneri.tutar} TL
                        </div>
                      )}
                      {k.tur === "vadesi_gecen_hatirlatma" && (
                        <div>
                          Alıcı: <code>{k.oneri.alici || "E-posta yok"}</code>
                          {taslak ? (
                            <div className={styles.editor}>
                              <label className={styles.field}>
                                Konu
                                <input className="input" value={taslak.konu} maxLength={250} onChange={(e) => setDuzenlenen({ ...taslak, konu: e.target.value })} />
                              </label>
                              <label className={styles.field}>
                                Metin
                                <textarea className="input" value={taslak.metin} maxLength={10000} rows={5} onChange={(e) => setDuzenlenen({ ...taslak, metin: e.target.value })} />
                              </label>
                            </div>
                          ) : (
                            <>
                              {" · "}Konu: {k.oneri.konu}
                              <pre className={styles.draft}>{k.oneri.metin}</pre>
                            </>
                          )}
                        </div>
                      )}
                      {k.tur === "kritik_stok_talep" && (
                        <div>
                          Ürün: <code>[{k.oneri.stokKod}] {k.oneri.stokAd}</code> · Mevcut Bakiye: <strong>{k.oneri.mevcutBakiye}</strong> (Kritik: {k.oneri.kritikSeviye}) · Önerilen Sipariş: <strong>{k.oneri.onerilenMiktar} {k.oneri.anaBirim}</strong>
                          {k.oneri.tedarikciUnvan && <span> · Tedarikçi: {k.oneri.tedarikciUnvan}</span>}
                        </div>
                      )}
                      {k.tur === "ay_sonu_kapanis" && (
                        <div>
                          Dönem: <strong>{k.oneri.donem}</strong> · Bekleyen Ekstre: {k.oneri.bekleyenEkstreSayisi} · Taslak Fatura: {k.oneri.taslakFaturaSayisi} · Bekleyen Onay: {k.oneri.bekleyenOnaySayisi}
                        </div>
                      )}
                    </div>

                    {/* Kanıt ve Alternatifler */}
                    {k.kanit && (
                      <div className={styles.note}>
                        <strong>Kanıt ve gerekçe</strong> {k.kanit.neden ?? (k.kanit.skor ? `Eşleşme güven skoru: %${k.kanit.skor}` : JSON.stringify(k.kanit))}
                      </div>
                    )}

                    {k.alternatifler && k.alternatifler.length > 0 && (
                      <div className={styles.note}>
                        <strong>Alternatifler</strong>{" "}
                        {k.alternatifler.map((a: any, i: number) => (
                          <span key={i} style={{ marginRight: "0.5rem" }}>
                            • {a.ad ?? a.unvan ?? a.kod} {a.skor ? `(%${a.skor})` : ""}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Karar ve Sonuç Bilgisi */}
                    {k.durum === "onaylandi" && (
                      <div className={styles.decision}>
                        <span>✓ {k.onaylayan} tarafından onaylandı ({k.kararAt ? zaman(k.kararAt) : ""})</span>
                        {k.olusanKayitId && <span>· Oluşan Kayıt: {k.olusanKayitTur} (#{k.olusanKayitId})</span>}
                      </div>
                    )}

                    {k.durum === "hedef_degisti" && (
                      <p className={styles.warning}>
                        Kaynak kayıt hazırlık üretildikten sonra güncellendi veya onaylandı; bu hazırlık artık uygulanamaz.
                      </p>
                    )}

                    {/* Eylemler */}
                    {k.durum === "hazir" && (
                      <div className={styles.recordActions}>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={islem !== null || Boolean(taslak && (!taslak.konu.trim() || !taslak.metin.trim()))}
                          onClick={() => void onayla(k.id)}
                        >
                          {islem === k.id ? "Onaylanıyor…" : "Onayla ve Oluştur"}
                        </Button>
                        {k.tur === "vadesi_gecen_hatirlatma" && (
                          <Button size="sm" disabled={islem !== null} onClick={() => setDuzenlenen(taslak ? null : {
                            id: k.id, konu: String(k.oneri.konu ?? ""), metin: String(k.oneri.metin ?? ""),
                          })}>
                            {taslak ? "Düzenlemeyi iptal et" : "Taslağı düzenle"}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={islem !== null}
                          onClick={() => void reddet(k.id)}
                        >
                          Reddet
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
