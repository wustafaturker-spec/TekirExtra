"use client";
import { useEffect,useState } from 'react';
import {ihtiyacEksigi} from '@/lib/ihtiyac-talep';
import { api } from '@/lib/api';
import { ihtiyacMiktariYaz,planGirdisiYolu,type IhtiyacPlanSatiri,type KayitliIhtiyacPlani } from '@/lib/ihtiyac-plan';
import { Alert,Button,ButtonLabel,Card,PageHeader } from '@/components/ui';
type Liste={kayitlar:IhtiyacPlanSatiri[];sonrakiImlec:string|null};
export default function IhtiyacPlanlariSayfasi(){
 const [liste,setListe]=useState<Liste>({kayitlar:[],sonrakiImlec:null}),[plan,setPlan]=useState<KayitliIhtiyacPlani|null>(null);
 const [hata,setHata]=useState(''),[listeHatasi,setListeHatasi]=useState(''),[bekliyor,setBekliyor]=useState(false),[planBekliyor,setPlanBekliyor]=useState(false),[yetkili,setYetkili]=useState(false);
 async function listele(imlec?:string){setBekliyor(true);setListeHatasi('');try{const r=await api<Liste>('/stok/ihtiyac-plani/planlar'+(imlec?'?'+new URLSearchParams({imlec}):''),{cache:'no-store'});setListe(v=>({kayitlar:imlec?[...v.kayitlar,...r.kayitlar]:r.kayitlar,sonrakiImlec:r.sonrakiImlec}));}catch(e){setListeHatasi(e instanceof Error?e.message:'Plan listesi okunamadı');}finally{setBekliyor(false);}}
 async function planOku(id:string){setPlanBekliyor(true);setHata('');setPlan(null);try{setPlan(await api<KayitliIhtiyacPlani>(`/stok/ihtiyac-plani/planlar/${encodeURIComponent(id)}`,{cache:'no-store'}));}catch(e){setHata(e instanceof Error?e.message:'Plan okunamadı');}finally{setPlanBekliyor(false);}}
 useEffect(()=>{let aktif=true;void api<{rol:string}>('/auth/ben').then(async b=>{if(!aktif)return;if(!['yonetici','muhasebe','depo'].includes(b.rol))throw Error('Bu ekran için yetkiniz yok.');setYetkili(true);void listele();const id=new URLSearchParams(window.location.search).get('plan');if(id)void planOku(id);}).catch(e=>{if(aktif)setHata(e.message);});return()=>{aktif=false;};},[]);
 let satinAlinabilir=false;try{satinAlinabilir=!!plan?.erisim?.yazabilir&&!!plan?.guncel&&Number(ihtiyacEksigi(plan.snapshot,'tarihli'))>0;}catch{}
 return <div className="stack">
  <PageHeader title="Kayıtlı ihtiyaç planları" subtitle="Tarihsel hesapları ve karşılama paylarını inceleyin. Planlar stok rezervi değildir." actions={<ButtonLabel as="a" href="/panel/stok/ihtiyac">Yeni önizleme</ButtonLabel>}/>
  <Alert tone="error">{hata}</Alert>
  {planBekliyor&&<p role="status">Plan ve güncel kaynaklar okunuyor…</p>}
  {plan&&<Card title="Kayıtlı plan">
   <Alert tone={plan.guncel?'success':'warning'}>{plan.guncel?'Planın kaynakları güncel hesapla aynı.':'Planın kaynakları veya ihtiyaç günü değişmiş. Bu kayıt tarihsel sonucu gösterir.'}</Alert>
   <p>{plan.snapshot.stok.kod} · {plan.snapshot.stok.ad} / {plan.snapshot.depo.ad}</p>
   <p>İhtiyaç günü: {plan.girdi.ihtiyacTarihi} · Kayıt: {new Date(plan.createdAt).toLocaleString('tr-TR')} · Sürüm {plan.surum}</p>
   <dl className="form-grid">{[['İhtiyaç',plan.snapshot.hesap.talep],['Tarihli açık',plan.snapshot.tarihli?.eksik],['Dönem içindeki en büyük açık',plan.snapshot.tarihli?.donemIciEnBuyukAcik]].map(([ad,m])=><div key={ad}><dt>{ad}</dt><dd>{m?`${ihtiyacMiktariYaz(m)} ${plan.snapshot.stok.anaBirim}`:'Doğrulanamadı'}</dd></div>)}</dl>
   {plan.satinAlmaBagi?<p>Bu plandan satın alma talebi oluşturulmuş. <a href={'/panel/satin-alma/talepler?'+new URLSearchParams({talep:plan.satinAlmaBagi.talepId})}>Bağlı talebi incele</a></p>:satinAlinabilir&&<p><a href={'/panel/satin-alma/talepler?'+new URLSearchParams({ihtiyacPlani:plan.id})}>Bu plandan satın alma taslağı hazırla</a></p>}
   {plan.erisim?.mod==='salt_okunur'&&<p>Şirket modu salt okunur; bu plandan yeni taslak oluşturulamaz.</p>}
   <h3>Yeni ihtiyacın kayıtlı kaynak payları</h3>
   {plan.karsilamaBaglari.length?<ul>{plan.karsilamaBaglari.map(b=><li key={b.id}>{b.tur==='mevcut_stok'?'Mevcut stok':'Sipariş girişi'}: {ihtiyacMiktariYaz(b.miktar)} {plan.snapshot.stok.anaBirim}{b.tur==='siparis_girisi'&&<> · <a href={`/panel/stok/giris-tarihleri?satirId=${encodeURIComponent(b.kaynakId)}`}>Güncel giriş kaynağını incele</a></>}</li>)}</ul>:<p>Bu kayıt için karşılanmış kaynak payı yok.</p>}
   <p>Bu paylar başka planlara karşı kapasite ayırmaz. Satın alma için güncel önizleme yeniden hesaplanmalıdır.</p>
   <div style={{display:'flex',flexWrap:'wrap',gap:8}}><ButtonLabel as="a" href={planGirdisiYolu(plan.girdi)}>Girdilerle yeniden hesapla</ButtonLabel><Button disabled={planBekliyor} onClick={()=>void planOku(plan.id)}>Güncelliği tekrar kontrol et</Button></div>
  </Card>}
  <Card title="Plan geçmişi"><Alert tone="error">{listeHatasi}</Alert><Button disabled={!yetkili||bekliyor} onClick={()=>void listele()}>Listeyi yenile</Button>
   {!bekliyor&&!liste.kayitlar.length&&!listeHatasi&&yetkili&&<p>Henüz kayıtlı ihtiyaç planı yok.</p>}
   <p>Güncellik, plan açıldığında kaynaklardan yeniden kontrol edilir.</p>
   <ul>{liste.kayitlar.map(k=><li key={k.id} style={{margin:'12px 0',overflowWrap:'anywhere'}}><a href={'/panel/stok/ihtiyac-planlari?'+new URLSearchParams({plan:k.id})}>{k.stokKod} · {k.stokAd} / {k.depoAd} — {ihtiyacMiktariYaz(k.miktar)} {k.anaBirim}</a><div>{k.ihtiyacTarihi} · {new Date(k.createdAt).toLocaleString('tr-TR')}</div></li>)}</ul>
   {bekliyor&&<p role="status">Liste yükleniyor…</p>}{liste.sonrakiImlec&&<Button disabled={bekliyor} onClick={()=>void listele(liste.sonrakiImlec!)}>Daha fazla plan göster</Button>}
  </Card>
 </div>;
}
