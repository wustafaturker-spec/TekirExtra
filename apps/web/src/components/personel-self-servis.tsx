"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, Input } from "@/components/ui";

interface Durum { durum: "yok" | "davet_bekliyor" | "davet_suresi_doldu" | "aktif" | "kapali"; eposta?: string; davetSonGecerlilik?: string | null }
interface DavetSonucu { eposta: string; epostaGonderildi: boolean; epostaHatasi: string | null; davetAdresi: string | null; sonGecerlilik: string }

const ETIKET: Record<Durum["durum"], string> = { yok: "Hesap yok", davet_bekliyor: "Davet gönderildi, parola bekleniyor", davet_suresi_doldu: "Davetin süresi doldu", aktif: "Hesap kullanımda", kapali: "Erişim kapalı" };

/** PRS-21: personel kartında çalışan self-servis hesabının durumu, daveti ve kapatılması. */
export function PersonelSelfServis({ personelId, eposta, aktifPersonel }: { personelId: string; eposta: string | null | undefined; aktifPersonel: boolean }) {
  const [durum, setDurum] = useState<Durum | null>(null);
  const [sonuc, setSonuc] = useState<string | null>(null);
  const [baglanti, setBaglanti] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);

  const yukle = useCallback(() => api<Durum>(`/personel/${personelId}/self-servis`).then(setDurum).catch((e) => setHata(e instanceof Error ? e.message : "Durum alınamadı")), [personelId]);
  useEffect(() => { void yukle(); }, [yukle]);

  const davet = async (epostaGonder: boolean) => {
    try {
      setIsleniyor(true); setHata(null); setSonuc(null); setBaglanti(null);
      const r = await api<DavetSonucu>(`/personel/${personelId}/self-servis/davet`, { method: "POST", body: JSON.stringify({ epostaGonder }) });
      setSonuc(r.epostaGonderildi ? `Davet ${r.eposta} adresine gönderildi (7 gün geçerli).` : r.epostaHatasi ? `E-posta gönderilemedi (${r.epostaHatasi}); bağlantıyı çalışana elden iletin.` : "Davet bağlantısı oluşturuldu; çalışana elden iletin (7 gün geçerli).");
      setBaglanti(r.davetAdresi);
      await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Davet oluşturulamadı"); }
    finally { setIsleniyor(false); }
  };

  const kapat = async () => {
    if (!window.confirm("Çalışanın self-servis erişimi kapatılsın mı?")) return;
    try { setIsleniyor(true); setHata(null); await api(`/personel/${personelId}/self-servis/kapat`, { method: "POST" }); setSonuc("Erişim kapatıldı."); setBaglanti(null); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "Erişim kapatılamadı"); }
    finally { setIsleniyor(false); }
  };

  const davetEdilebilir = aktifPersonel && durum && durum.durum !== "aktif";
  return (
    <Card
      title="Çalışan self-servis"
      actions={<div className="row-tight">
        {davetEdilebilir && <Button size="sm" disabled={isleniyor || !eposta} onClick={() => void davet(true)}>{durum?.durum === "yok" ? "E-postayla davet et" : "Daveti yeniden gönder"}</Button>}
        {davetEdilebilir && <Button size="sm" disabled={isleniyor || !eposta} onClick={() => void davet(false)}>Bağlantı oluştur</Button>}
        {durum && ["aktif", "davet_bekliyor", "davet_suresi_doldu"].includes(durum.durum) && <Button size="sm" variant="danger" disabled={isleniyor} onClick={() => void kapat()}>Erişimi kapat</Button>}
      </div>}
    >
      <div className="stack" style={{ gap: "0.6rem", fontSize: "0.85rem" }}>
        <p style={{ margin: 0 }}><strong>{durum ? ETIKET[durum.durum] : "…"}</strong>{durum?.eposta ? ` · giriş adı ${durum.eposta}` : ""}</p>
        <p className="muted" style={{ margin: 0 }}>Çalışan kendi hesabıyla onaylı bordrolarının pusulasını indirir, izin bakiyesini görür; izin, avans ve bilgi güncelleme talebi gönderir, talepler İK onayına düşer. Çalışan hesabı kullanıcı sınırına sayılmaz, işten çıkışta kapanır.</p>
        {!eposta && aktifPersonel && <Alert tone="warning">Davet için önce kartta çalışanın kendi e-posta adresini girin.</Alert>}
        <Alert tone="error">{hata}</Alert>
        <Alert tone="success">{sonuc}</Alert>
        {baglanti && <div className="row-tight"><Input readOnly value={baglanti} onFocus={(e) => e.currentTarget.select()} aria-label="Davet bağlantısı" style={{ flex: 1, minWidth: 0 }} /><Button size="sm" onClick={() => void navigator.clipboard.writeText(baglanti).then(() => setSonuc("Bağlantı kopyalandı."))}>Kopyala</Button></div>}
      </div>
    </Card>
  );
}
