"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CrmKapamaDagitimi } from "./crm-kapama-dagitimi";
import { api, ApiHata } from "@/lib/api";
import { Alert, Button, Card, Input } from "@/components/ui";
interface Teklif { id: string; no: string | null; durum: string; dovizCinsi: string; genelToplam: string; updatedAt: string; revizyonNo: number; bagli?: boolean }
interface Bag { id: string; surum: number; gerekce: string; cozulduAt: string | null; cozmeGerekcesi: string | null; belge: Teklif | null }
interface ZincirBelgesi { id: string; no: string | null; tur: "siparis" | "irsaliye"; durum: string; kaynakBelgeId: string; faturaId: string | null }
interface TicariSonuc { id:string; no:string|null; durum:string; dovizCinsi:string; faturaPayi:string|null; payKapsami:string; kapama:{durum:string;kasaBanka:string|null;iade:string|null;diger:string|null;kalan:string|null} }
interface Liste { payFaturaGecmisi?: {id:string;no:string|null}[]; ticariSonuc?: TicariSonuc[]; mod: string; firsat: { id: string; baslik: string; updatedAt: string }; baglar: Bag[]; zincir?: { belgeler: ZincirBelgesi[]; faturalar: { id: string; no: string | null; durum: string; kaynakBelgeIds: string[]; ortakKaynak: boolean }[] } }
interface Adaylar { firsat: Liste["firsat"]; kayitlar: Teklif[]; sonrakiImlec: string | null }
export function CrmTeklifBaglari({ firsatId }: { firsatId: string }) {
 const [liste,setListe] = useState<Liste | null>(null), [aday,setAday] = useState<Adaylar | null>(null);
 const [hata,setHata] = useState(""), [kapali,setKapali] = useState(false), [islemde,setIslemde] = useState(false);
 const [arama,setArama] = useState(""), [secim,setSecim] = useState(""), [gerekce,setGerekce] = useState("");
 const [cozulecek,setCozulecek] = useState<Bag | null>(null), [cozmeNotu,setCozmeNotu] = useState("");
 const [bagAnahtari,setBagAnahtari] = useState(() => crypto.randomUUID()), [cozAnahtari,setCozAnahtari] = useState(() => crypto.randomUUID());
 const [yazabilir,setYazabilir] = useState(false);
 const yukle = useCallback(async () => {
  try { const [l,u] = await Promise.all([api<Liste>(`/crm/firsatlar/${firsatId}/belgeler`),api<{rol:string}>("/auth/ben")]);setListe(l);setKapali(false);setYazabilir(["yonetici","satis"].includes(u.rol) && ["pilot","acik"].includes(l.mod)); }
  catch(e) { if(e instanceof ApiHata && e.durum===403) setKapali(true);else setHata(e instanceof Error?e.message:"Teklif bağları okunamadı"); }
 },[firsatId]);
 useEffect(()=>{void yukle();},[yukle]);
 const adaylariOku = async (imlec?:string) => {
  setIslemde(true);setHata("");
  try {const q=new URLSearchParams({arama,...(imlec?{imlec}:{})});const data=await api<Adaylar>(`/crm/firsatlar/${firsatId}/belgeler/adaylar?${q}`);setAday(data);setSecim("");setBagAnahtari(crypto.randomUUID());}
  catch(e){setHata(e instanceof Error?e.message:"Teklifler okunamadı");}finally{setIslemde(false);}
 };
 const bagla = async () => {
  const b=aday?.kayitlar.find(b=>b.id===secim);if(!b || !aday) return;
  setIslemde(true);setHata("");
  try {await api(`/crm/firsatlar/${firsatId}/belgeler`,{method:"POST",body:JSON.stringify({belgeId:b.id,beklenenFirsatZamani:aday.firsat.updatedAt,beklenenBelgeZamani:b.updatedAt,gerekce,istekAnahtari:bagAnahtari})});setAday(null);setSecim("");setGerekce("");setBagAnahtari(crypto.randomUUID());await yukle();}
  catch(e){setHata(e instanceof Error?e.message:"Teklif bağlanamadı");}finally{setIslemde(false);}
 };
 const coz = async () => {
  if(!cozulecek) return;setIslemde(true);setHata("");
  try {await api(`/crm/firsatlar/${firsatId}/belgeler/${cozulecek.id}/coz`,{method:"POST",body:JSON.stringify({beklenenSurum:cozulecek.surum,gerekce:cozmeNotu,istekAnahtari:cozAnahtari})});setCozulecek(null);setCozmeNotu("");setAday(null);await yukle();}
  catch(e){setHata(e instanceof Error?e.message:"Bağ çözülemedi");}finally{setIslemde(false);}
 };
 const kaynakAdi = (id:string) => liste?.baglar.find(b=>b.belge?.id===id)?.belge?.no ?? liste?.zincir?.belgeler.find(b=>b.id===id)?.no ?? "Numarasız kaynak belge";
 return <section aria-label="Fırsat teklif bağları" className="stack">
  <Card title="İlgili teklifler">
   <Alert tone="error">{hata}</Alert>
   {kapali?<p>Teklif bağları bu şirket veya hesabınız için kapalı. Yönetici Modül Ayarları ekranından erişimi düzenleyebilir.</p>:!liste?<p>Yükleniyor…</p>:<div className="stack">
    <p><strong>{liste.firsat.baslik}</strong></p>
    <p className="muted">Teklif tutarı gerçekleşen satış veya tahsilat değildir. Her teklifin tek aktif fırsat bağı olabilir.</p>
    {!yazabilir && <p>Bu görünüm salt okunur.</p>}
    <div className="row"><Button variant="ghost" onClick={()=>void yukle()} disabled={islemde}>Bağları yenile</Button>{yazabilir && <><Link prefetch={false} className="btn btn--primary" href={`/panel/belgeler/yeni?tur=teklif&yon=satis&yeni=1&firsatId=${firsatId}`}>Yeni teklif oluştur</Link><Button onClick={()=>void adaylariOku()} disabled={islemde}>Mevcut teklif bağla</Button></>}</div>
    {liste.baglar.length===0?<p>Bu fırsata bağlı teklif yok.</p>:<ul className="stack" style={{listStyle:"none",padding:0}}>{liste.baglar.map(b=><li key={b.id} className="card" style={{padding:"1rem"}}>
     {b.belge?<><Link href={`/panel/belgeler?tur=teklif&yon=satis&odak=${b.belge.id}`}>{b.belge.no??"Numarasız teklif"}</Link><p>{b.belge.genelToplam} {b.belge.dovizCinsi} · {b.belge.durum} · Rev.{b.belge.revizyonNo}</p></>:<p>Kaynak belge görüntülenemiyor.</p>}
     <p>{b.gerekce}</p>{b.cozulduAt?<p>Bağ çözüldü: {b.cozmeGerekcesi}</p>:yazabilir && <Button variant="ghost" disabled={islemde} onClick={()=>{setCozulecek(b);setCozmeNotu("");setCozAnahtari(crypto.randomUUID());}}>Bağı çöz</Button>}
    </li>)}</ul>}
    {liste.zincir && <section aria-label="Bağlantılı satış belgeleri" className="stack">
     <h3>Bağlantılı satış belgeleri</h3>
     <p className="muted">Aktif teklif bağlarının mevcut dönüşüm kayıtları gösterilir. Belge bağlantısı tek başına finansal pay kanıtı değildir; doğrulanan tutarlar aşağıda gösterilir.</p>
     {!liste.zincir.belgeler.length && <p>Aktif tekliflerden türeyen sipariş veya irsaliye yok.</p>}
     <ul className="stack">{liste.zincir.belgeler.map(d=><li key={d.id}><Link href={`/panel/belgeler?tur=${d.tur}&yon=satis&odak=${d.id}`}>{d.no??(d.tur==="siparis"?"Numarasız sipariş":"Numarasız irsaliye")}</Link> · {d.tur==="siparis"?"Sipariş":"İrsaliye"} · {d.durum}<p className="muted">Kaynak: {kaynakAdi(d.kaynakBelgeId)}</p></li>)}</ul>
     {liste.zincir.faturalar.length>0 && <><h4>Bağlantılı faturalar</h4><ul className="stack">{liste.zincir.faturalar.map(d=><li key={d.id}><Link href={`/panel/fatura?yon=satis&faturaId=${d.id}`}>{d.no??"Numarasız fatura"}</Link> · {d.durum}{d.ortakKaynak && <strong> · Bu fırsat dışındaki belgeleri de içerir</strong>}</li>)}</ul></>}
    </section>}
    {liste.ticariSonuc && liste.ticariSonuc.length>0 && <section aria-label="Fırsatın fatura payları" className="stack">
     <h3>Fatura payları ve kapama</h3>
     <p className="muted">Yalnız kaynak satır zinciri doğrulanan kesin faturaların KDV dahil payı gösterilir. Kapama kayıtları nakit akışı veya net satış değildir. İadeler burada yalnız faturaya uygulanan kapama tutarıyla görünür.</p>
     <ul className="stack" style={{listStyle:"none",padding:0}}>{liste.ticariSonuc.map(s=><li key={s.id} className="card" style={{padding:"1rem"}}>
      <Link href={`/panel/fatura?yon=satis&faturaId=${s.id}`}>{s.no??"Numarasız fatura"}</Link>
      {s.faturaPayi===null ? <p>{s.payKapsami==="kesin_degil"?"Kesinleşmiş satış payı yok; fatura taslak veya iptal.":"Fatura payı dağıtılamadı; kaynak satır kanıtı eksik veya tutarsız."}</p> : <p>Bu fırsatın fatura payı (KDV dahil): <strong>{s.faturaPayi} {s.dovizCinsi}</strong>{s.payKapsami==="kismi" && " · Yalnız doğrulanan satırlar"}</p>}
      {s.kapama.durum!=="tam" ? <p>Kapama payları dağıtılamadı. Karma veya kaynağı eksik faturada oranla tahsilat/iade dağıtılmaz.</p> : <dl><dt>Kasa/banka ile kapama</dt><dd>{s.kapama.kasaBanka} {s.dovizCinsi}</dd><dt>İade ile kapama</dt><dd>{s.kapama.iade} {s.dovizCinsi}</dd><dt>Diğer kapama (çek/senet/kart)</dt><dd>{s.kapama.diger} {s.dovizCinsi}</dd><dt>Faturanın kalan bakiyesi</dt><dd>{s.kapama.kalan} {s.dovizCinsi}</dd></dl>}
      <CrmKapamaDagitimi firsatId={firsatId} faturaId={s.id} />
     </li>)}</ul>
    </section>}
    {(liste.payFaturaGecmisi??[]).filter(f=>!liste.ticariSonuc?.some(s=>s.id===f.id)).map(f=><div key={f.id} className="card" style={{padding:'1rem'}}><p>Kapama payı geçmişi: {f.no??'Numarasız fatura'}</p><CrmKapamaDagitimi firsatId={firsatId} faturaId={f.id} /></div>)}
    {aday && <section aria-label="Teklif bağlama" className="stack">
     <label>Teklif numarasıyla ara<Input aria-label="Teklif numarasıyla ara" value={arama} maxLength={100} onChange={e=>setArama(e.target.value)} /></label><Button onClick={()=>void adaylariOku()} disabled={islemde}>Teklifleri ara</Button>
     <label>Satış teklifi<select aria-label="Satış teklifi" className="input" value={secim} onChange={e=>{setSecim(e.target.value);setBagAnahtari(crypto.randomUUID());}} disabled={islemde}><option value="">Teklif seçin</option>{aday.kayitlar.map(b=><option key={b.id} value={b.id} disabled={b.bagli}>{b.no??"Numarasız teklif"} · {b.genelToplam} {b.dovizCinsi}{b.bagli?" · zaten bağlı":""}</option>)}</select></label>
     {aday.sonrakiImlec && <Button variant="ghost" disabled={islemde} onClick={()=>void adaylariOku(aday.sonrakiImlec!)}>Sonraki teklifler</Button>}
     <label>Bağlama gerekçesi<Input aria-label="Bağlama gerekçesi" value={gerekce} maxLength={500} onChange={e=>{setGerekce(e.target.value);setBagAnahtari(crypto.randomUUID());}} /></label>
     <div className="row"><Button disabled={islemde||!secim||gerekce.trim().length<2} onClick={()=>void bagla()}>Teklifi bağla</Button><Button variant="ghost" disabled={islemde} onClick={()=>setAday(null)}>Vazgeç</Button></div>
    </section>}
    {cozulecek && <section aria-label="Teklif bağını çözme" className="stack"><p>Yalnız fırsat bağı çözülür; teklif ve geçmişi korunur.</p><label>Çözme gerekçesi<Input aria-label="Çözme gerekçesi" value={cozmeNotu} maxLength={500} onChange={e=>{setCozmeNotu(e.target.value);setCozAnahtari(crypto.randomUUID());}} /></label><div className="row"><Button disabled={islemde||cozmeNotu.trim().length<2} onClick={()=>void coz()}>Bağı çözmeyi onayla</Button><Button variant="ghost" disabled={islemde} onClick={()=>setCozulecek(null)}>Vazgeç</Button></div></section>}
   </div>}
  </Card>
 </section>;
}
