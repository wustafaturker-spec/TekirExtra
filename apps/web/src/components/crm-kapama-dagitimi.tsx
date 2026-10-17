"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Input } from "@/components/ui";
interface Kapama {id:string;tur:string;tutar:string;kaynakOzeti:string;gecerli:boolean;surum:number;pay:string|null;azamiTutar:string;gecersizEskiPay:boolean}
interface Gorunum {mod:string;fatura:{id:string;no:string|null;dovizCinsi:string};kanitOzeti:string;faturaPayi:string;dagitilanToplam:string;kapamalar:Kapama[];gecmis:{id:string;kapamaId:string;surum:number;tutar:string;gerekce:string;createdAt:string;gecerli:boolean}[]}
const turAdi=(tur:string)=>tur==='kasa_banka'?'Kasa/banka':tur==='iade'?'İade':'Diğer (çek/senet/kart)';
export function CrmKapamaDagitimi({firsatId,faturaId}:{firsatId:string;faturaId:string}){
 const [data,setData]=useState<Gorunum|null>(null),[rol,setRol]=useState(''),[hata,setHata]=useState(''),[busy,setBusy]=useState(false);
 const [secim,setSecim]=useState(''),[tutar,setTutar]=useState(''),[gerekce,setGerekce]=useState(''),[anahtar,setAnahtar]=useState(()=>crypto.randomUUID());
 const url=`/crm/firsatlar/${firsatId}/belgeler/faturalar/${faturaId}/kapama-paylari`;
 const yukle=async()=>{setBusy(true);setHata('');try{const [d,u]=await Promise.all([api<Gorunum>(url),api<{rol:string}>('/auth/ben')]);setData(d);setRol(u.rol);setSecim('');setTutar('');setAnahtar(crypto.randomUUID());}catch(e){setHata(e instanceof Error?e.message:'Dağıtım okunamadı');}finally{setBusy(false);}};
 const kaydet=async()=>{
  const k=data?.kapamalar.find(k=>k.id===secim);if(!k || !data)return;
  setBusy(true);setHata('');try{await api(url,{method:'POST',body:JSON.stringify({kapamaId:k.id,tutar,gerekce,istekAnahtari:anahtar,beklenenSurum:k.surum,kanitOzeti:data.kanitOzeti,kaynakOzeti:k.kaynakOzeti})});setGerekce('');await yukle();}catch(e){setHata(e instanceof Error?e.message:'Pay kaydedilemedi');}finally{setBusy(false);}
 };
 const yazabilir=!!data && ['pilot','acik'].includes(data.mod) && ['yonetici','muhasebe'].includes(rol),k=data?.kapamalar.find(k=>k.id===secim);
 return <section aria-label="Açık kapama dağıtımı" className="stack">
  <Button variant="ghost" disabled={busy} onClick={()=>void yukle()}>{data?'Dağıtımı yenile':'Kapama dağıtımını aç'}</Button>
  <Alert tone="error">{hata}</Alert>
  {data && <>
   <p>Bu fırsat için açıkça belirtilen kapama payı: <strong>{data.dagitilanToplam} {data.fatura.dovizCinsi}</strong></p>
   <p className="muted">Bu dağıtım muhasebe kapamasını değiştirmez ve otomatik tutarlara eklenmez. Kaynak veya fırsat bağı değişirse pay geçersizleşir. Sıfır girerek önceki payı kaldırabilirsiniz.</p>
   {!data.kapamalar.length && <p>Güncel kapama yok; varsa önceki paylar geçmişte korunur.</p>}
   <ul>{data.kapamalar.map(k=><li key={k.id}>{turAdi(k.tur)} · Kapama {k.tutar} {data.fatura.dovizCinsi} · Fırsat payı {k.pay===null?'belirtilmedi':`${k.pay} ${data.fatura.dovizCinsi}`}{k.gecersizEskiPay?' · Önceki payın kaynağı değişti':''}</li>)}</ul>
   {yazabilir ? <>
    <label>Dağıtılacak kapama<select aria-label="Dağıtılacak kapama" className="input" value={secim} disabled={busy} onChange={e=>{setSecim(e.target.value);setTutar('');setAnahtar(crypto.randomUUID());}}><option value="">Kapama seçin</option>{data.kapamalar.map(k=><option key={k.id} value={k.id} disabled={!k.gecerli}>{turAdi(k.tur)} · {k.tutar} {data.fatura.dovizCinsi} · Sürüm {k.surum}</option>)}</select></label>
    {k && <p>Bu kapamada bu fırsat için en çok {k.azamiTutar} {data.fatura.dovizCinsi} belirtilebilir.</p>}
    <label>Fırsatın kapama payı<Input aria-label="Fırsatın kapama payı" inputMode="decimal" value={tutar} disabled={busy} maxLength={16} onChange={e=>{setTutar(e.target.value.replace(',','.'));setAnahtar(crypto.randomUUID());}} /></label>
    <label>Dağıtım gerekçesi<Input aria-label="Dağıtım gerekçesi" value={gerekce} disabled={busy} maxLength={500} onChange={e=>{setGerekce(e.target.value);setAnahtar(crypto.randomUUID());}} /></label>
    <Button disabled={busy || !secim || !/^\d{1,13}(\.\d{1,2})?$/.test(tutar) || gerekce.trim().length<2} onClick={()=>void kaydet()}>Kapama payını kaydet</Button>
   </> : <p>Bu dağıtım salt okunur. Yönetici veya muhasebe pay belirtebilir.</p>}
   {data.gecmis.length>0 && <details><summary>Dağıtım geçmişi</summary><ul>{data.gecmis.map(g=><li key={g.id}>Sürüm {g.surum} · {g.tutar} {data.fatura.dovizCinsi} · {g.gerekce} · {g.gecerli?'Güncel':'Geçmiş / geçersiz kaynak'}</li>)}</ul></details>}
  </>}
 </section>;
}
