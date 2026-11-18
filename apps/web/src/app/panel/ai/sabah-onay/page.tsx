"use client";

import Link from "next/link";
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
      await api(`/ai/hazirlik/${id}/onayla`, { method: "POST" });
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

  return (
    <>
      <PageHeader
        title="Sabah Onay Kutusu"
        subtitle="Yapay zekânın gece hazırladığı taslak ve öneriler. Hiçbir işlem kendiliğinden kesinleşmez; tek ekrandan kanıtları ve alternatifleri inceleyip tekli veya toplu onaylayabilirsiniz."
        actions={
          <div className="row-tight">
            <Button size="sm" onClick={() => void yukle()} disabled={islem !== null}>
              Yenile
            </Button>
            <Button size="sm" variant="primary" onClick={() => void hazirlaManuel()} disabled={calisiyor || islem !== null}>
              {calisiyor ? "Taranıyor…" : "Şimdi Tara ve Hazırla"}
            </Button>
          </div>
        }
      />

      {hata && <Alert tone="error">{hata}</Alert>}
      {mesaj && <Alert tone="success">{mesaj}</Alert>}

      <div className="row-tight" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <Select value={kapsam} onChange={(e) => setKapsam(e.target.value as "bana" | "firma")} aria-label="Kapsam">
          <option value="bana">Bana Atananlar</option>
          <option value="firma">Tüm Firma (Yönetici)</option>
        </Select>

        <Select value={durum} onChange={(e) => setDurum(e.target.value as HazirlikDurumu | "")} aria-label="Durum">
          <option value="hazir">Onay Bekleyenler (Hazır)</option>
          <option value="onaylandi">Onaylananlar</option>
          <option value="reddedildi">Reddedilenler</option>
          <option value="hedef_degisti">Kaynak Değişenler</option>
          <option value="suresi_doldu">Süresi Dolanlar</option>
          <option value="">Tüm Durumlar</option>
        </Select>

        <Select value={tur} onChange={(e) => setTur(e.target.value as HazirlikTuru | "")} aria-label="Tür">
          <option value="">Tüm Türler</option>
          <option value="fatura_stok_esleme">Gelen Fatura Stok Eşleme</option>
          <option value="banka_ekstre_esleme">Banka Ekstresi Eşleme</option>
          <option value="vadesi_gecen_hatirlatma">Vadesi Geçen Alacak Hatırlatma</option>
          <option value="kritik_stok_talep">Kritik Stok Satın Alma Talebi</option>
          <option value="ay_sonu_kapanis">Ay Sonu Kapanış Kontrolü</option>
        </Select>

        {kayitlar && kayitlar.some((k) => k.durum === "hazir") && (
          <Button size="sm" onClick={tumunuSec}>
            {secilenler.size ? "Seçimi Kaldır" : "Tüm Bekleyenleri Seç"}
          </Button>
        )}
      </div>

      {secilenler.size > 0 && (
        <BulkActionsBar selectedCount={secilenler.size} onClear={() => setSecilenler(new Set())}>
          <div className="row-tight">
            <Button size="sm" variant="primary" disabled={islem !== null} onClick={() => void topluOnayla()}>
              Seçilenleri Onayla ({secilenler.size})
            </Button>
            <Button size="sm" variant="danger" disabled={islem !== null} onClick={() => void topluReddet()}>
              Seçilenleri Reddet ({secilenler.size})
            </Button>
          </div>
        </BulkActionsBar>
      )}

      {kayitlar && !kayitlar.length && (
        <Card>
          <p className="muted">
            {durum === "hazir"
              ? "Şu an onay bekleyen bir hazırlık bulunmuyor. Gece zamanlanmış görevle veya 'Şimdi Tara ve Hazırla' butonuyla yeni öneriler üretebilirsiniz."
              : "Bu süzgeç kriterlerine uygun hazırlık kaydı bulunamadı."}
          </p>
        </Card>
      )}

      {kayitlar && kayitlar.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {kayitlar.map((k) => {
            const turCfg = TUR_BADGE[k.tur] ?? { ad: k.tur, variant: "neutral" };
            const durumCfg = DURUM_ROZET[k.durum] ?? { ad: k.durum, variant: "neutral" };
            const secili = secilenler.has(k.id);

            return (
              <Card key={k.id}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
                  {k.durum === "hazir" && (
                    <input
                      type="checkbox"
                      checked={secili}
                      onChange={() => secimDegistir(k.id)}
                      style={{ marginTop: "0.25rem", cursor: "pointer" }}
                      aria-label="Seç"
                    />
                  )}

                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                      <div className="row-tight" style={{ gap: "0.5rem" }}>
                        <Badge variant={turCfg.variant}>{turCfg.ad}</Badge>
                        <Badge variant={durumCfg.variant}>{durumCfg.ad}</Badge>
                        <span style={{ fontWeight: 600 }}>{k.baslik}</span>
                      </div>
                      <span className="muted" style={{ fontSize: "0.85em" }}>
                        Oluşturulma: {zaman(k.createdAt)}
                      </span>
                    </div>

                    <p style={{ margin: "0.25rem 0 0.5rem 0", color: "var(--fg)" }}>{k.ozet}</p>

                    {/* Öneri Ayrıntısı */}
                    <div style={{ background: "var(--bg-muted, #f8f9fa)", padding: "0.75rem", borderRadius: "6px", marginBottom: "0.5rem", fontSize: "0.9em" }}>
                      <strong>Önerilen Eylem / Taslak:</strong>
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
                          Alıcı: <code>{k.oneri.alici || "E-posta yok"}</code> · Konu: {k.oneri.konu}
                          <pre style={{ margin: "0.5rem 0 0 0", whiteSpace: "pre-wrap", background: "white", padding: "0.5rem", borderRadius: "4px" }}>
                            {k.oneri.metin}
                          </pre>
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
                      <div style={{ fontSize: "0.85em", color: "var(--fg-muted, #6c757d)", marginBottom: "0.5rem" }}>
                        💡 <strong>Kanıt & Gerekçe:</strong> {k.kanit.neden ?? (k.kanit.skor ? `Eşleşme güven skoru: %${k.kanit.skor}` : JSON.stringify(k.kanit))}
                      </div>
                    )}

                    {k.alternatifler && k.alternatifler.length > 0 && (
                      <div style={{ fontSize: "0.85em", color: "var(--fg-muted, #6c757d)", marginBottom: "0.5rem" }}>
                        🔄 <strong>Alternatif Seçenekler:</strong>{" "}
                        {k.alternatifler.map((a: any, i: number) => (
                          <span key={i} style={{ marginRight: "0.5rem" }}>
                            • {a.ad ?? a.unvan ?? a.kod} {a.skor ? `(%${a.skor})` : ""}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Karar ve Sonuç Bilgisi */}
                    {k.durum === "onaylandi" && (
                      <div className="row-tight" style={{ fontSize: "0.85em", color: "var(--color-success, #28a745)" }}>
                        <span>✓ {k.onaylayan} tarafından onaylandı ({k.kararAt ? zaman(k.kararAt) : ""})</span>
                        {k.olusanKayitId && <span>· Oluşan Kayıt: {k.olusanKayitTur} (#{k.olusanKayitId})</span>}
                      </div>
                    )}

                    {k.durum === "hedef_degisti" && (
                      <p style={{ color: "var(--color-danger, #dc3545)", fontSize: "0.85em", margin: "0.25rem 0" }}>
                        ⚠️ Kaynak kayıt hazırlık üretildikten sonra güncellendi veya onaylandı; bu hazırlık artık uygulanamaz.
                      </p>
                    )}

                    {/* Eylemler */}
                    {k.durum === "hazir" && (
                      <div className="row-tight" style={{ marginTop: "0.75rem", gap: "0.5rem" }}>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={islem !== null}
                          onClick={() => void onayla(k.id)}
                        >
                          {islem === k.id ? "Onaylanıyor…" : "Onayla ve Oluştur"}
                        </Button>
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
    </>
  );
}
