"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { AlertTriangle, Megaphone, Clock3, ArrowUpRight } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { DuyuruZenginIcerik } from "./duyuru-zengin-icerik";

interface PopupDuyuru {
  id: string; baslik: string; icerik: string; butonMetni: string | null; butonUrl: string | null;
  gosterimYerleri?: ("merkez" | "ust_bant" | "popup" | "modul_karti")[]; popupOnceligi?: number; popupTuru?: "normal" | "kritik";
  ertelemeDakika?: number; sonrakiGosterim?: string | null; popupKapatildi?: boolean; baslangic: string;
  tekrarGosterilebilir?: boolean; tekrarSonrakiGosterim?: string | null;
}
interface Liste { kayitlar: PopupDuyuru[]; toplam: number }

export function TenantDuyuruPopupYoneticisi() {
  const [kayitlar, setKayitlar] = useState<PopupDuyuru[]>([]);
  const [yerelAtlanan, setYerelAtlanan] = useState<Set<string>>(new Set());
  const [islem, setIslem] = useState(false);
  const [hata, setHata] = useState("");
  const yenile = useCallback(async () => {
    try {
      const ilk = await api<Liste>("/duyurular?sayfa=1&gecmis=false");
      const sayfaSayisi = Math.ceil(ilk.toplam / 25);
      const diger = await Promise.all(Array.from({ length: Math.max(0, sayfaSayisi - 1) }, (_, i) => api<Liste>(`/duyurular?sayfa=${i + 2}&gecmis=false`)));
      setKayitlar([...ilk.kayitlar, ...diger.flatMap((s) => s.kayitlar)].filter((d) => !yerelAtlanan.has(d.id)));
    } catch { setKayitlar([]); }
  }, [yerelAtlanan]);
  useEffect(() => {
    void yenile();
    const timer = window.setInterval(() => void yenile(), 60000);
    const gorunurluk = () => { if (document.visibilityState === "visible") void yenile(); };
    document.addEventListener("visibilitychange", gorunurluk);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", gorunurluk); };
  }, [yenile]);
  const aday = useMemo(() => kayitlar.filter((d) => (d.gosterimYerleri ?? ["merkez"]).includes("popup")
    && !d.popupKapatildi && d.tekrarGosterilebilir !== false && (!d.tekrarSonrakiGosterim || new Date(d.tekrarSonrakiGosterim).getTime() <= Date.now())
    && (!d.sonrakiGosterim || new Date(d.sonrakiGosterim).getTime() <= Date.now()))
    .sort((a, b) => (b.popupOnceligi ?? 50) - (a.popupOnceligi ?? 50)
      || new Date(a.baslangic).getTime() - new Date(b.baslangic).getTime() || a.id.localeCompare(b.id)), [kayitlar]);
  const aktif = aday[0];
  useEffect(() => {
    if (!aktif) return;
    const gosterimYaz = () => {
      if (document.visibilityState === "visible") void api(`/duyurular/${aktif.id}/olay`, { method: "POST", body: JSON.stringify({ tur: "gosterim" }) }).catch(() => undefined);
    };
    gosterimYaz();
    document.addEventListener("visibilitychange", gosterimYaz);
    return () => document.removeEventListener("visibilitychange", gosterimYaz);
  }, [aktif?.id]);
  async function tercih(tur: "ertele" | "kapat") {
    if (!aktif || islem) return;
    setIslem(true); setHata("");
    try {
      await api(`/duyurular/${aktif.id}/tercih`, { method: "POST", body: JSON.stringify({ tur }) });
      setYerelAtlanan((onceki) => new Set(onceki).add(aktif.id));
      setKayitlar((onceki) => onceki.filter((d) => d.id !== aktif.id));
    } catch (e) { setHata(e instanceof Error ? e.message : "Popup tercihi kaydedilemedi."); }
    finally { setIslem(false); }
  }
  async function tikla() {
    if (!aktif?.butonUrl || islem) return;
    setIslem(true); setHata("");
    try {
      await api(`/duyurular/${aktif.id}/olay`, { method: "POST", body: JSON.stringify({ tur: "tiklama" }) });
      await api(`/duyurular/${aktif.id}/tercih`, { method: "POST", body: JSON.stringify({ tur: "kapat" }) });
      setYerelAtlanan((onceki) => new Set(onceki).add(aktif.id));
      setKayitlar((onceki) => onceki.filter((d) => d.id !== aktif.id));
      window.location.assign(aktif.butonUrl);
    } catch (e) { setHata(e instanceof Error ? e.message : "Bağlantı açılamadı."); setIslem(false); }
  }
  if (!aktif) return null;
  const dakika = aktif.ertelemeDakika ?? 1440;
  const erteleMetni = dakika === 60 ? "1 saat ertele" : dakika === 10080 ? "1 hafta ertele" : "1 gün ertele";
  return <Modal key={aktif.id} baslik={aktif.popupTuru === "kritik" ? `Önemli duyuru: ${aktif.baslik}` : aktif.baslik} onKapat={() => void tercih("kapat")}>
    <div className={`duyuru-popup${aktif.popupTuru === "kritik" ? " duyuru-popup--kritik" : ""}`}><div className="duyuru-popup-kimlik"><span className="duyuru-simge" aria-hidden="true">{aktif.popupTuru === "kritik" ? <AlertTriangle size={22} /> : <Megaphone size={22} />}</span><div><strong>{aktif.popupTuru === "kritik" ? "Önemli bilgilendirme" : "TekirExtra’dan haberler"}</strong><p>Firmanız için yayınlanan duyuru</p></div></div><DuyuruZenginIcerik icerik={aktif.icerik} />
    {hata && <p role="alert">{hata}</p>}
    <div className="duyuru-popup-islemler">
      {aktif.butonMetni && aktif.butonUrl && <Button disabled={islem} variant="primary" onClick={() => void tikla()}>{aktif.butonMetni}<ArrowUpRight size={16} aria-hidden="true" /></Button>}
      <Button disabled={islem} onClick={() => void tercih("ertele")}><Clock3 size={15} aria-hidden="true" />{erteleMetni}</Button>
      <Button disabled={islem} onClick={() => void tercih("kapat")}>Kapat</Button>
    </div></div>
  </Modal>;
}
