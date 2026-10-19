"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { finansalOzetGorebilir } from "@/lib/rol-yetkileri";
import { Alert } from "@/components/ui";
import { CalendarDays, ListChecks } from "lucide-react";
import { TahsilatTakipleri } from "@/components/tahsilat-takipleri";
import { TahsilatOdemeSozleri } from "@/components/tahsilat-odeme-sozleri";
function TahsilatIsListesiIcerik() {
  const takipId = useSearchParams().get("takip");
  const [ben, setBen] = useState<{ rol:string; userId:string } | null>(null), [hata,setHata] = useState("");
  useEffect(()=>{let etkin=true;void api<{rol:string;userId:string}>("/auth/ben").then(r=>{if(etkin)setBen(r);}).catch(e=>{if(etkin)setHata(e instanceof Error?e.message:"Yetki alınamadı");});return()=>{etkin=false;};},[]);
  return <div className="collection-page stack"><header className="collection-page__header"><div><span className="collection-eyebrow"><ListChecks size={14} aria-hidden="true"/>CARİ HESAPLAR · TAHSİLAT</span><h1>Tahsilat iş listesi</h1><p>Ödeme sözlerini izleyin, öncelikli işlerinizi planlayın ve görüşmeleri kaydedin.</p></div><span className="collection-today"><CalendarDays size={17} aria-hidden="true"/>{new Date().toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric" })}</span></header><Alert tone="error">{hata}</Alert>
    {!ben&&!hata&&<p role="status">Yetki yükleniyor…</p>}
    {ben&&finansalOzetGorebilir(ben.rol)&&<><TahsilatOdemeSozleri/><TahsilatTakipleri rol={ben.rol} benId={ben.userId} baslangicTakipId={takipId}/></>}
  </div>;
}
export default function TahsilatIsListesi() {
  return <Suspense fallback={<p role="status">Tahsilat iş listesi yükleniyor…</p>}><TahsilatIsListesiIcerik/></Suspense>;
}
