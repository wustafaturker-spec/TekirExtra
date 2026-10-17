"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { finansalOzetGorebilir } from "@/lib/rol-yetkileri";
import { Alert, PageHeader } from "@/components/ui";
import { TahsilatTakipleri } from "@/components/tahsilat-takipleri";
function TahsilatIsListesiIcerik() {
  const takipId = useSearchParams().get("takip");
  const [ben, setBen] = useState<{ rol:string; userId:string } | null>(null), [hata,setHata] = useState("");
  useEffect(()=>{let etkin=true;void api<{rol:string;userId:string}>("/auth/ben").then(r=>{if(etkin)setBen(r);}).catch(e=>{if(etkin)setHata(e instanceof Error?e.message:"Yetki alınamadı");});return()=>{etkin=false;};},[]);
  return <div className="stack"><PageHeader title="Tahsilat iş listesi" subtitle="Bugünkü ve geciken işlemler, açık itirazlar ve sorumlu takibi."/><Alert tone="error">{hata}</Alert>
    {!ben&&!hata&&<p role="status">Yetki yükleniyor…</p>}
    {ben&&finansalOzetGorebilir(ben.rol)&&<TahsilatTakipleri rol={ben.rol} benId={ben.userId} baslangicTakipId={takipId}/>}
  </div>;
}
export default function TahsilatIsListesi() {
  return <Suspense fallback={<p role="status">Tahsilat iş listesi yükleniyor…</p>}><TahsilatIsListesiIcerik/></Suspense>;
}
