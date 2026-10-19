"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Input, Para } from "@/components/ui";

interface Iade {id:string;no:string|null;durum:string;matrah:string;dagitilanMatrah:string;kalanMatrah:string;dagitimDurumu:"tam"|"eksik"|"gecersiz";gecerli:boolean;kanitOzeti:string;surum:number;pay:string|null;azamiMatrah:string;gecersizEskiPay:boolean;kaynakFaturalar:{id:string;no:string|null}[]}
interface Gorunum {mod:string;fatura:{id:string;no:string|null;dovizCinsi:string};sonuc:{durum:string;satisMatrahi:string|null;belirtilenIadeMatrahi:string;netMatrah:string|null};iadeler:Iade[];gecmis:{id:string;iadeFaturaId:string;surum:number;matrah:string;gerekce:string;gecerli:boolean}[]}

export function CrmIadeDagitimi({firsatId,faturaId}:{firsatId:string;faturaId:string}){
 const [data,setData]=useState<Gorunum|null>(null),[rol,setRol]=useState(''),[hata,setHata]=useState(''),[busy,setBusy]=useState(false);
 const [secim,setSecim]=useState(''),[matrah,setMatrah]=useState(''),[gerekce,setGerekce]=useState(''),[anahtar,setAnahtar]=useState(()=>crypto.randomUUID());
 const url=`/crm/firsatlar/${firsatId}/belgeler/faturalar/${faturaId}/iade-paylari`;
 const yukle=async()=>{setBusy(true);setHata('');try{const [d,u]=await Promise.all([api<Gorunum>(url),api<{rol:string}>('/auth/ben')]);setData(d);setRol(u.rol);setSecim('');setMatrah('');setAnahtar(crypto.randomUUID());}catch(e){setHata(e instanceof Error?e.message:'Ticari iade dağıtımı okunamadı');}finally{setBusy(false);}};
 const kaydet=async()=>{
  const i=data?.iadeler.find(i=>i.id===secim);if(!i)return;
  setBusy(true);setHata('');try{await api(url,{method:'POST',body:JSON.stringify({iadeFaturaId:i.id,matrah,gerekce,istekAnahtari:anahtar,beklenenSurum:i.surum,kanitOzeti:i.kanitOzeti})});setGerekce('');await yukle();}catch(e){setHata(e instanceof Error?e.message:'Ticari iade payı kaydedilemedi');}finally{setBusy(false);}
 };
 const yazabilir=!!data && ['pilot','acik'].includes(data.mod) && ['yonetici','muhasebe'].includes(rol),i=data?.iadeler.find(i=>i.id===secim);
 return <section aria-label="Ticari iade dağıtımı" className="stack">
  <Button variant="ghost" disabled={busy} onClick={()=>void yukle()}>{data?'Ticari iadeleri yenile':'Ticari iade dağıtımını aç'}</Button>
  <Alert tone="error">{hata}</Alert>
  {data && <>
   <h4>Belirtilen ticari iade payları (KDV hariç)</h4>
   <p className="muted">Muhasebenin gerekçeyle, kaynak fatura ve fırsat bazında belirttiği matrah paylarıdır. Kapama payından ve otomatik iade hesabından ayrı gösterilir. İade toplamı, bütün kaynaklardaki güncel paylar tamamlanmadan net sonuç verilmez.</p>
   <dl><dt>Bu fırsatın doğrulanan satış matrahı</dt><dd>{data.sonuc.satisMatrahi===null?'Doğrulanamadı':<Para deger={data.sonuc.satisMatrahi} dovizCinsi={data.fatura.dovizCinsi} />}</dd>
    <dt>Belirtilen güncel iade matrahı</dt><dd><Para deger={data.sonuc.belirtilenIadeMatrahi} dovizCinsi={data.fatura.dovizCinsi} /></dd>
    <dt>Dağıtım sonrası satış matrahı</dt><dd>{data.sonuc.netMatrah===null?'Dağıtım eksik veya kaynak geçersiz':<Para deger={data.sonuc.netMatrah} dovizCinsi={data.fatura.dovizCinsi} />}</dd></dl>
   <p className="muted">Sonuç yalnız bütün kesin referanslı iadeler fırsatlara dağıtıldığında hesaplanır. Kaynak değişirse önceki paylar geçmişte kalır. Sıfır matrah yeni sürümle önceki payı kaldırır.</p>
   {!data.iadeler.length && <p>Bu faturaya referans veren iade yok.</p>}
   <ul>{data.iadeler.map(i=><li key={i.id}>{i.no??'Numarasız iade'} · {i.durum} · Kaynaklar: {i.kaynakFaturalar.map(f=>f.no??f.id).join(', ')||'Referans yok'} · Bu kaynak/fırsat payı: {i.pay===null?'Belirtilmedi':<Para deger={i.pay} dovizCinsi={data.fatura.dovizCinsi} />} · Tüm kaynaklardaki pay: <Para deger={i.dagitilanMatrah} dovizCinsi={data.fatura.dovizCinsi} /> / <Para deger={i.matrah} dovizCinsi={data.fatura.dovizCinsi} /> · Kalan: <Para deger={i.kalanMatrah} dovizCinsi={data.fatura.dovizCinsi} />{i.dagitimDurumu==='tam'?' · Dağıtım tamam':i.dagitimDurumu==='gecersiz'?' · Dağıtım doğrulanamadı':' · Dağıtım eksik'}{!i.gecerli?' · Kaynak dağıtıma uygun değil':''}{i.gecersizEskiPay?' · Önceki pay geçersiz':''}</li>)}</ul>
   {yazabilir?<>
    <label>Ticari iade<select aria-label="Ticari iade" className="input" value={secim} disabled={busy} onChange={e=>{setSecim(e.target.value);setMatrah('');setAnahtar(crypto.randomUUID());}}><option value="">İade seçin</option>{data.iadeler.map(i=><option key={i.id} value={i.id} disabled={!i.gecerli}>{i.no??'Numarasız iade'} · Sürüm {i.surum}</option>)}</select></label>
    {i && <p>En çok <Para deger={i.azamiMatrah} dovizCinsi={data.fatura.dovizCinsi} /> matrah belirtilebilir.</p>}
    <label>İade matrah payı<Input aria-label="İade matrah payı" inputMode="decimal" value={matrah} maxLength={16} disabled={busy} onChange={e=>{setMatrah(e.target.value.replace(',','.'));setAnahtar(crypto.randomUUID());}} /></label>
    <label>Ticari iade gerekçesi<Input aria-label="Ticari iade gerekçesi" value={gerekce} maxLength={500} disabled={busy} onChange={e=>{setGerekce(e.target.value);setAnahtar(crypto.randomUUID());}} /></label>
    <Button disabled={busy || !secim || !/^\d{1,13}(\.\d{1,2})?$/.test(matrah) || gerekce.trim().length<2} onClick={()=>void kaydet()}>Ticari iade payını kaydet</Button>
   </>:<p>Ticari iade dağıtımı salt okunur. Yönetici veya muhasebe pay belirtebilir.</p>}
   {!!data.gecmis.length && <details><summary>Ticari iade geçmişi</summary><ul>{data.gecmis.map(g=><li key={g.id}>Sürüm {g.surum} · <Para deger={g.matrah} dovizCinsi={data.fatura.dovizCinsi} /> · {g.gerekce} · {g.gecerli?'Güncel':'Geçmiş / geçersiz kaynak'}</li>)}</ul></details>}
  </>}
 </section>;
}
