"use client";

import { ArrowUpRight, Megaphone } from "lucide-react";
import type { DuyuruIcerigi } from "@/lib/platform-duyurulari";
import { DuyuruZenginIcerik } from "./duyuru-zengin-icerik";

export function DuyuruOnizleme({ veri }: { veri: DuyuruIcerigi & { icerikHtml?: string } }) {
  return <article className="duyuru-onizleme" aria-label="Duyuru önizlemesi">
    <div className="duyuru-onizleme-kimlik"><span className="duyuru-simge" aria-hidden="true"><Megaphone size={20} /></span><span className="duyuru-kategori">TekirExtra · Bilgilendirme</span></div>
    <h2>{veri.baslik}</h2>
    <DuyuruZenginIcerik icerik={veri.icerikHtml ?? veri.icerik} />
    {veri.butonMetni && veri.butonUrl && <div className="duyuru-kart-alt"><a className="btn btn--primary" href={veri.butonUrl} target="_blank" rel="noopener noreferrer">{veri.butonMetni}<ArrowUpRight size={16} aria-hidden="true" /><span className="sr-only"> (yeni sekmede açılır)</span></a></div>}
  </article>;
}
