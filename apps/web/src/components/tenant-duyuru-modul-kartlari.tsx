"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Megaphone } from "lucide-react";
import { api } from "@/lib/api";
import { DuyuruZenginIcerik } from "./duyuru-zengin-icerik";

interface Duyuru { id: string; baslik: string; icerik: string; butonMetni: string | null; butonUrl: string | null; gosterimYerleri?: string[]; modulYollari?: string[]; tekrarGosterilebilir?: boolean; tekrarSonrakiGosterim?: string | null }
interface Liste { kayitlar: Duyuru[] }
const MODUL_YOLLARI: Record<string, string[]> = {
  genel: ["/panel"], finans: ["/panel/kasa-banka", "/panel/nakit-akisi", "/panel/butce", "/panel/gelirler", "/panel/masraflar", "/panel/fatura"],
  satis: ["/panel/satis", "/panel/belgeler", "/panel/fatura", "/panel/pazaryeri"], satin_alma: ["/panel/satin-alma"],
  stok: ["/panel/stok"], uretim: ["/panel/uretim"], raporlar: ["/panel/raporlar"], ayarlar: ["/panel/ayarlar"],
  ebelge: ["/panel/ebelge"], cari: ["/panel/cari"], personel: ["/panel/personel", "/panel/self-servis"], crm: ["/panel/crm"],
};
function modulEslesiyor(pathname: string, modul: string) {
  return (MODUL_YOLLARI[modul] ?? []).some((root) => root === "/panel" ? pathname === root : pathname === root || pathname.startsWith(`${root}/`));
}
export function TenantDuyuruModulKartlari({ pathname }: { pathname: string }) {
  const [duyurular, setDuyurular] = useState<Duyuru[]>([]);
  useEffect(() => {
    let kapandi = false;
    const yukle = () => void api<Liste>("/duyurular?sayfa=1&gecmis=false")
      .then((r) => { if (!kapandi) setDuyurular(r.kayitlar.filter((d) => (d.gosterimYerleri ?? []).includes("modul_karti") && d.tekrarGosterilebilir !== false && (!d.tekrarSonrakiGosterim || new Date(d.tekrarSonrakiGosterim).getTime() <= Date.now()) && (d.modulYollari ?? []).some((m) => modulEslesiyor(pathname, m)))); })
      .catch(() => { if (!kapandi) setDuyurular([]); });
    yukle();
    return () => { kapandi = true; };
  }, [pathname]);
  if (!duyurular.length) return null;
  return <div className="stack" aria-label="Bu modülle ilgili duyurular">{duyurular.map((duyuru) => <ModulKarti key={duyuru.id} duyuru={duyuru} />)}</div>;
}
function ModulKarti({ duyuru }: { duyuru: Duyuru }) {
  useEffect(() => {
    const hedef = document.getElementById(`duyuru-modul-${duyuru.id}`);
    if (!hedef || !("IntersectionObserver" in window)) return;
    const gozlem = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) return;
      gozlem.disconnect();
      void api(`/duyurular/${duyuru.id}/olay`, { method: "POST", body: JSON.stringify({ tur: "gosterim" }) }).catch(() => undefined);
    }, { threshold: 0.5 });
    gozlem.observe(hedef);
    return () => gozlem.disconnect();
  }, [duyuru.id]);
  async function tikla() {
    if (!duyuru.butonUrl) return;
    try {
      await api(`/duyurular/${duyuru.id}/olay`, { method: "POST", body: JSON.stringify({ tur: "tiklama" }) });
      window.location.assign(duyuru.butonUrl);
    } catch { /* Yayın durdurulmuşsa kartın bağlantısı açılmaz. */ }
  }
  return <aside id={`duyuru-modul-${duyuru.id}`} className="card duyuru-bildirim duyuru-bildirim--modul">
    <span className="duyuru-simge" aria-hidden="true"><Megaphone size={20} /></span><div className="duyuru-bildirim-govde"><span className="duyuru-kategori">Bu modülle ilgili</span><h2>{duyuru.baslik}</h2><DuyuruZenginIcerik icerik={duyuru.icerik} />
    </div>
    {duyuru.butonMetni && duyuru.butonUrl && (duyuru.butonUrl.startsWith("/panel")
      ? <Link className="btn btn--primary" href={duyuru.butonUrl} onClick={(e) => { e.preventDefault(); void tikla(); }}>{duyuru.butonMetni}<ArrowUpRight size={15} aria-hidden="true" /></Link>
      : <button className="btn btn--primary" type="button" onClick={() => void tikla()}>{duyuru.butonMetni}<ArrowUpRight size={15} aria-hidden="true" /></button>)}
  </aside>;
}
