"use client";
import {useEffect,useRef,useState} from 'react';
import {api} from '@/lib/api';
import {ihtiyacMiktariYaz} from '@/lib/ihtiyac-plan';
import {Alert,Button,ButtonLabel,Card,Field,Input,PageHeader,Select} from '@/components/ui';
type Depo={id:string;kod:string;ad:string};
type Atama={depoId:string;ihtiyacTarihi:string;aktif:boolean;surum:number;kaynakOzeti:string;gerekce:string;depo:{aktif:boolean}};
type Kaynak={erisim?:{mod:string;yazabilir:boolean};kalemId:string;emirId:string;emirNo:string;malzeme:{kod:string;ad:string};rezervDisi:string;aktifRezerv:string;anaBirim:string;kaynakOzeti:string;atama:Atama|null};
const bugun=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'});
export default function UretimTalepleriSayfasi(){
 const [kaynak,setKaynak]=useState<Kaynak|null>(null),[depolar,setDepolar]=useState<Depo[]>([]),[id,setId]=useState(''),[depoId,setDepoId]=useState(''),[tarih,setTarih]=useState(''),[gerekce,setGerekce]=useState('');
 const [hata,setHata]=useState(''),[basari,setBasari]=useState(''),[yetkili,setYetkili]=useState(false),[bekliyor,setBekliyor]=useState(false),[yenileGerekli,setYenileGerekli]=useState(false);
 const sira=useRef(0),yaziyor=useRef(false);
 async function yukle(kalemId:string){const n=++sira.current;setBekliyor(true);setHata('');setKaynak(null);try{const [k,d]=await Promise.all([api<Kaynak>(`/stok/ihtiyac-plani/uretim-talepleri/${encodeURIComponent(kalemId)}`,{cache:'no-store'}),api<Depo[]>('/depo?yalnizAktif=true',{cache:'no-store'})]);if(n!==sira.current)return;setKaynak(k);setDepolar(d);setDepoId(k.atama?.depoId??'');setTarih(k.atama?.ihtiyacTarihi.slice(0,10)??'');setGerekce('');setYenileGerekli(false);}catch(e){if(n===sira.current){setHata(e instanceof Error?e.message:'Üretim ihtiyacı okunamadı');throw e;}}finally{if(n===sira.current)setBekliyor(false);}}
 useEffect(()=>{let aktif=true;void api<{rol:string}>('/auth/ben').then(b=>{if(!aktif)return;if(!['yonetici','muhasebe','depo'].includes(b.rol))throw Error('Bu ekran için yetkiniz yok.');setYetkili(true);const k=new URLSearchParams(window.location.search).get('kalemId');if(k){setId(k);void yukle(k).catch(()=>{});}}).catch(e=>{if(aktif)setHata(e.message);});return()=>{aktif=false;sira.current++;};},[]);
 async function kaydet(aktif:boolean){
  if(!kaynak?.erisim?.yazabilir||yaziyor.current||bekliyor||yenileGerekli)return;
  if(!depoId||!tarih||gerekce.trim().length<5){setHata('Hammadde deposunu, ihtiyaç gününü ve en az 5 karakterlik gerekçeyi girin.');return;}
  yaziyor.current=true;setBekliyor(true);setHata('');setBasari('');let kaydedildi=false;
  try{await api(`/stok/ihtiyac-plani/uretim-talepleri/${kaynak.kalemId}`,{method:'PUT',body:JSON.stringify({depoId,ihtiyacTarihi:tarih,aktif,beklenenSurum:kaynak.atama?.surum??0,beklenenKaynakOzeti:kaynak.kaynakOzeti,gerekce:gerekce.trim()})});kaydedildi=true;await yukle(kaynak.kalemId);setBasari(aktif?'Rezerv dışı üretim ihtiyacının deposu ve günü atandı.':'Atama kaldırıldı; rezerv dışı ihtiyaç tekrar belirsiz olarak izlenir.');}
  catch(e){setYenileGerekli(true);setHata(kaydedildi?'Atama kaydedildi fakat güncel kalem okunamadı. Yeniden yükleyin.':`${e instanceof Error?e.message:'İşlem sonucu alınamadı.'} Güncel durumu yeniden yükleyin.`);}
  finally{yaziyor.current=false;setBekliyor(false);}
 }
 const a=kaynak?.atama;
 return <div className="stack"><PageHeader title="Üretim ihtiyacının deposu ve günü" subtitle="Yalnız rezerv dışı malzeme ihtiyacını planlayın; mamul hedef deposu otomatik seçilmez." actions={<ButtonLabel as="a" href="/panel/stok/ihtiyac">İhtiyaç önizlemesi</ButtonLabel>}/>
  <Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>
  <Card><form onSubmit={e=>{e.preventDefault();setBasari('');void yukle(id).catch(()=>{});}} className="stack"><Field label="Üretim kalemi kimliği"><Input required value={id} disabled={!yetkili||bekliyor} onChange={e=>{sira.current++;setId(e.target.value);setKaynak(null);setBasari('');}}/></Field><div><Button type="submit" disabled={!yetkili||bekliyor||!id}>Kalemi yeniden yükle</Button></div><p>Kalemi üretim emrinin malzeme listesinden seçebilirsiniz.</p></form></Card>
  {kaynak&&<Card title={`${kaynak.emirNo} · ${kaynak.malzeme.kod} — ${kaynak.malzeme.ad}`}>
   <p>Rezerv dışı kalan: {ihtiyacMiktariYaz(kaynak.rezervDisi)} {kaynak.anaBirim} · Tüm depolardaki aktif rezerv: {ihtiyacMiktariYaz(kaynak.aktifRezerv)} {kaynak.anaBirim}</p>
   {a&&<p>Son atama: {a.ihtiyacTarihi.slice(0,10)} · {a.aktif?'Etkin':'Kaldırılmış'} · Sürüm {a.surum}<br/>Son gerekçe: {a.gerekce}</p>}
   {a?.aktif&&(a.kaynakOzeti!==kaynak.kaynakOzeti||!a.depo.aktif)&&<Alert tone="warning">Kaynak veya depo değişmiş. Atamayı yeniden doğrulayın.</Alert>}
   {kaynak.erisim?.mod==='salt_okunur'&&<p>Şirket modu salt okunur; atama değiştirilemez.</p>}
   <div className="stack"><Field label="Hammadde deposu"><Select disabled={!kaynak.erisim?.yazabilir||bekliyor||yenileGerekli} value={depoId} onChange={e=>setDepoId(e.target.value)}><option value="">Depo seçin</option>{a&&!depolar.some(d=>d.id===a.depoId)&&<option disabled value={a.depoId}>Önceki depo artık aktif değil</option>}{depolar.map(d=><option key={d.id} value={d.id}>{d.kod} · {d.ad}</option>)}</Select></Field>
    <Field label="Malzeme ihtiyaç günü"><Input type="date" min={bugun()} disabled={!kaynak.erisim?.yazabilir||bekliyor||yenileGerekli} value={tarih} onChange={e=>setTarih(e.target.value)}/></Field>
    <Field label="Atama veya kaldırma gerekçesi"><Input maxLength={1000} disabled={!kaynak.erisim?.yazabilir||bekliyor||yenileGerekli} value={gerekce} onChange={e=>setGerekce(e.target.value)}/></Field>
    <div style={{display:'flex',flexWrap:'wrap',gap:8}}><Button variant="primary" disabled={!kaynak.erisim?.yazabilir||bekliyor||yenileGerekli||kaynak.rezervDisi==='0.000'} onClick={()=>void kaydet(true)}>Depo ve günü ata</Button><Button disabled={!kaynak.erisim?.yazabilir||bekliyor||yenileGerekli||!a?.aktif} onClick={()=>void kaydet(false)}>Atamayı kaldır</Button><ButtonLabel as="a" href={`/panel/uretim/emirler/${encodeURIComponent(kaynak.emirId)}`}>Üretim emrine dön</ButtonLabel></div>
   </div><p>Bu işlem malzeme ayırmaz, stok tüketmez veya üretimi başlatmaz. Atamayı kaldırmak üretim ihtiyacını silmez.</p>
  </Card>}
 </div>;
}
