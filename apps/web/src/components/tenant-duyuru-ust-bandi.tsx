"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Megaphone } from "lucide-react";
import { api } from "@/lib/api";
import { DuyuruZenginIcerik } from "./duyuru-zengin-icerik";

interface Duyuru { id: string; baslik: string; icerik: string; butonMetni: string | null; butonUrl: string | null; gosterimYerleri?: ("merkez" | "ust_bant" | "popup" | "modul_karti")[]; tekrarGosterilebilir?: boolean; tekrarSonrakiGosterim?: string | null }
interface Liste { kayitlar: Duyuru[] }

export function TenantDuyuruUstBandi() {
  const [duyurular, setDuyurular] = useState<Duyuru[]>([]);
  useEffect(() => {
    let kapandi = false;
    const yukle = () => void api<Liste>("/duyurular?sayfa=1&gecmis=false")
      .then((r) => { if (!kapandi) setDuyurular(r.kayitlar.filter((d) => (d.gosterimYerleri ?? ["merkez"]).includes("ust_bant") && d.tekrarGosterilebilir !== false && (!d.tekrarSonrakiGosterim || new Date(d.tekrarSonrakiGosterim).getTime() <= Date.now()))); })
      .catch(() => { if (!kapandi) setDuyurular([]); });
    yukle();
    const timer = window.setInterval(yukle, 60000);
    const gorunurluk = () => { if (document.visibilityState === "visible") yukle(); };
    document.addEventListener("visibilitychange", gorunurluk);
    return () => { kapandi = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", gorunurluk); };
  }, []);
  if (!duyurular.length) return null;
  return <div className="stack" aria-label="Önemli duyurular">{duyurular.map((d) => <UstBantKarti key={d.id} duyuru={d} />)}</div>;
}

function UstBantKarti({ duyuru }: { duyuru: Duyuru }) {
  useEffect(() => {
    const baslik = document.getElementById(`duyuru-bant-${duyuru.id}`);
    if (!baslik) return;
    const gozlem = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) return;
      gozlem.disconnect();
      void api(`/duyurular/${duyuru.id}/olay`, { method: "POST", body: JSON.stringify({ tur: "gosterim" }) }).catch(() => undefined);
    }, { threshold: 0.5 });
    gozlem.observe(baslik);
    return () => gozlem.disconnect();
  }, [duyuru.id]);
  async function tikla() {
    if (!duyuru.butonUrl) return;
    try {
      await api(`/duyurular/${duyuru.id}/olay`, { method: "POST", body: JSON.stringify({ tur: "tiklama" }) });
      window.location.assign(duyuru.butonUrl);
    } catch { /* Yayın durdurulmuşsa eski banner bağlantısı açılmaz. */ }
  }
  return <aside className="card duyuru-bildirim duyuru-bildirim--bant">
    <span className="duyuru-simge" aria-hidden="true"><Megaphone size={20} /></span><div className="duyuru-bildirim-govde"><span className="duyuru-kategori">Platform duyurusu</span><h2 id={`duyuru-bant-${duyuru.id}`}>{duyuru.baslik}</h2>
    <DuyuruZenginIcerik icerik={duyuru.icerik} />
    </div>
    {duyuru.butonMetni && duyuru.butonUrl && (duyuru.butonUrl.startsWith("/panel")
      ? <Link className="btn btn--primary" href={duyuru.butonUrl} onClick={(e) => { e.preventDefault(); void tikla(); }}>{duyuru.butonMetni}<ArrowUpRight size={15} aria-hidden="true" /></Link>
      : <button className="btn btn--primary" type="button" onClick={() => void tikla()}>{duyuru.butonMetni}<ArrowUpRight size={15} aria-hidden="true" /></button>)}
  </aside>;
}
