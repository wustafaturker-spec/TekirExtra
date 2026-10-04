"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

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
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
        <h2 className="text-base font-bold text-slate-900">Çalışan self-servis</h2>
        <div className="flex flex-wrap gap-2">
          {davetEdilebilir && <button type="button" disabled={isleniyor || !eposta} onClick={() => void davet(true)} className="rounded-lg border px-3 py-2 text-xs font-semibold">{durum?.durum === "yok" ? "E-postayla davet et" : "Daveti yeniden gönder"}</button>}
          {davetEdilebilir && <button type="button" disabled={isleniyor || !eposta} onClick={() => void davet(false)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Bağlantı oluştur</button>}
          {durum && ["aktif", "davet_bekliyor", "davet_suresi_doldu"].includes(durum.durum) && <button type="button" disabled={isleniyor} onClick={() => void kapat()} className="rounded-lg border px-3 py-2 text-xs font-semibold text-red-700">Erişimi kapat</button>}
        </div>
      </div>
      <div className="space-y-3 px-6 py-5 text-sm">
        <p><strong>{durum ? ETIKET[durum.durum] : "…"}</strong>{durum?.eposta ? ` · giriş adı ${durum.eposta}` : ""}</p>
        <p className="text-slate-500">Çalışan kendi hesabıyla onaylı bordrolarının pusulasını indirir, izin bakiyesini görür ve izin talebi gönderir; talepler İK onayına düşer. Çalışan hesabı kullanıcı sınırına sayılmaz, işten çıkışta kapanır.</p>
        {!eposta && aktifPersonel && <p className="text-amber-800">Davet için önce kartta çalışanın kendi e-posta adresini girin.</p>}
        {hata && <p role="alert" className="text-red-700">{hata}</p>}
        {sonuc && <p role="status" className="text-slate-700">{sonuc}</p>}
        {baglanti && <div className="flex flex-wrap items-center gap-2"><input readOnly value={baglanti} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs" aria-label="Davet bağlantısı" /><button type="button" onClick={() => void navigator.clipboard.writeText(baglanti).then(() => setSonuc("Bağlantı kopyalandı."))} className="rounded-lg border px-3 py-2 text-xs font-semibold">Kopyala</button></div>}
      </div>
    </section>
  );
}
