import 'reflect-metadata';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer,type ServerResponse} from 'node:http';
import {spawn,type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';

const url=process.env.F01_YARIS_DB_URL,dist=process.env.F04_REZERV_API_DIST,nonce=process.env.F01_YARIS_NONCE;
if(!url||!dist||!nonce)throw Error('Yalnız izole F04 rezervasyon runner ile çalıştırın');
const parsed=new URL(url);if(parsed.hostname!=='127.0.0.1'||parsed.username!=='tekir_app'||!/^\/f01_yaris_[a-f0-9]{16}$/.test(parsed.pathname)||['5432','5433'].includes(parsed.port))throw Error('Geçici DB kapsamı geçersiz');
process.env.BAGLANTI_SIFRELEME_ANAHTARI=randomBytes(32).toString('hex');
const req=createRequire(import.meta.url),load=(p:string)=>req(resolve(dist,p+'.js'));
const {PrismaService}=load('core/prisma.service'),{baglamlaCalistir}=load('core/istek-baglami'),{sifrele}=load('core/kripto');
const db=new PrismaService({datasourceUrl:url});
const documents=new Map<string,any>(),sendCounts=new Map<string,number>(),lookupCounts=new Map<string,number>(),hold=new Set<string>(),lookupFails=new Set<string>(),responses=new Set<ServerResponse>(),children=new Set<ChildProcess>();
let provider:string,cut:any,reservationId:string,financialBefore:string;
const evidence=resolve(process.env.F04_HTTP_EVIDENCE!);
const tx=(f:any,fn:any)=>baglamlaCalistir({...f,rol:'yonetici'},()=>db.tenantIslem(f.tenantId,fn));
const server=createServer(async(q,s)=>{
  try{
    let raw='';for await(const chunk of q)raw+=chunk;const body=JSON.parse(raw);
    if(q.url===`/${nonce}/send`){
      sendCounts.set(body.uuid,(sendCounts.get(body.uuid)??0)+1);expect(body.xml).toContain('<');
      const document={basarili:true,belgeRef:'FIXTURE-'+body.uuid};documents.set(body.uuid,document);
      if(hold.has(body.uuid)){responses.add(s);s.once('close',()=>responses.delete(s));return;}
      s.setHeader('Content-Type','application/json');s.end(JSON.stringify(document));return;
    }
    if(q.url===`/${nonce}/lookup`){
      lookupCounts.set(body.uuid,(lookupCounts.get(body.uuid)??0)+1);
      if(lookupFails.has(body.uuid)){s.writeHead(503);s.end('fixture');return;}
      s.setHeader('Content-Type','application/json');s.end(JSON.stringify({found:documents.has(body.uuid),document:documents.get(body.uuid)}));return;
    }
    s.writeHead(404);s.end();
  }catch{if(!s.headersSent)s.writeHead(500);s.end();}
});
beforeAll(async()=>{
  const [guard]=await db.$queryRawUnsafe("SELECT current_database() AS db,current_setting('tekir.f01_yaris_nonce',true) AS nonce,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
  expect(guard).toEqual({db:parsed.pathname.slice(1),nonce,rolsuper:false,rolbypassrls:false});
  expect(await readFile(resolve(dist,'ebelge/ebelge.service.js'),'utf8')).toContain('arama desteği sunmuyor');
  await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));provider=`http://127.0.0.1:${(server.address() as any).port}/${nonce}/`;
});
afterAll(async()=>{
  for(const child of children)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise<void>(ok=>child.once('close',()=>ok()));}
  for(const response of responses)response.destroy();server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()));await db.$disconnect();
  await writeFile(resolve(evidence,'ebelge-rezervasyon-saglayici.json'),JSON.stringify({gercekSaglayici:false,adres:'127.0.0.1/gecici-port',sendCounts:Object.fromEntries(sendCounts),lookupCounts:Object.fromEntries(lookupCounts)},null,2)+'\n');
});
async function fixture(existing=false){
  const f={tenantId:randomUUID(),userId:randomUUID(),invoiceId:randomUUID()};
  await tx(f,async(t:any)=>{
    await t.tenant.create({data:{id:f.tenantId,vkn:(BigInt('0x'+randomBytes(5).toString('hex'))%10000000000n).toString().padStart(10,'0'),unvan:'İzole rezervasyon fixture',efaturaMukellefi:false,earsivMukellefi:true,eirsaliyeMukellefi:false,vergiDairesi:'Test',adres:'Test sokak 1',ilce:'Kadıköy',il:'İstanbul'}});
    await t.user.create({data:{id:f.userId,tenantId:f.tenantId,eposta:f.userId+'@test.invalid',adSoyad:'Fixture',parolaHash:'fixture',rol:'yonetici'}});
    const cari=await t.cariHesap.create({data:{tenantId:f.tenantId,kod:'C1',unvan:'Fixture alıcı',tip:'musteri',vknTckn:'1234567890'}});
    const stock=await t.stokKart.create({data:{tenantId:f.tenantId,kod:'H1',ad:'Fixture hizmet',tip:'hizmet',anaBirim:'adet'}});
    await t.baglanti.create({data:{tenantId:f.tenantId,aile:'ebelge',saglayici:'nes',durum:'aktif',sifreliConfig:sifrele(JSON.stringify({kullaniciAdi:'fixture',testOrtami:true}))}});
    await t.fatura.create({data:{id:f.invoiceId,tenantId:f.tenantId,cariId:cari.id,tip:'satis',durum:'kesin',no:'TKR2026000000001',tarih:new Date('2026-10-23'),dovizCinsi:'TRY',kur:'1',toplamBrut:'100',toplamMatrah:'100',toplamKdv:'20',genelToplam:'120',toplamSatirIskontosu:'0',genelIskontoToplam:'0',toplamTevkifat:'0',toplamNetKdv:'20',satirlar:{create:{tenantId:f.tenantId,stokId:stock.id,miktar:'1',birim:'adet',birimFiyat:'100',matrah:'100',kdvOrani:'20',kdvTutari:'20',netKdvTutari:'20',toplamTutar:'120'}}}});
    if(existing)await t.ebelgeKayit.create({data:{tenantId:f.tenantId,faturaId:f.invoiceId,tur:'earsiv',durum:'hata',hataMesaji:'Kesilmiş yanıt fixture'}});
  });return f;
}
function start(f:any,noLookup=false){
  const child=spawn(process.execPath,[resolve('scripts/f04-rezervasyon-istemci.cjs')],{env:process.env,stdio:['pipe','pipe','pipe']});children.add(child);
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const done=new Promise<any>((ok,fail)=>{child.once('error',fail);child.once('close',(code,signal)=>{children.delete(child);const line=output.split('\n').find(l=>l.startsWith('F04_EBELGE_SONUC='));ok({code,signal,result:line?JSON.parse(line.slice('F04_EBELGE_SONUC='.length)):undefined,output});});});
  child.stdin.end(JSON.stringify({...f,provider,noLookup}));return {child,done};
}
async function call(f:any,noLookup=false){const p=start(f,noLookup);const r=await p.done;expect(r.code,r.output).toBe(0);expect(r.result,r.output).toBeDefined();return r.result;}
const record=(f:any)=>tx(f,(t:any)=>t.ebelgeKayit.findUnique({where:{faturaId:f.invoiceId},include:{arsiv:true}}));
const financial=(f:any)=>tx(f,async(t:any)=>JSON.stringify({invoice:await t.fatura.findUnique({where:{id:f.invoiceId},include:{satirlar:true}}),hareket:await t.cariHareket.count(),stok:await t.stokHareket.count()}));
it('sağlayıcı kabulünden sonra SIGKILL: rezervasyon kalır, taze rezervasyona ikinci gönderim engellenir',async()=>{
  cut=await fixture();financialBefore=await financial(cut);hold.add(cut.invoiceId);const p=start(cut);
  try{
    const deadline=Date.now()+20000;while(!documents.has(cut.invoiceId)&&Date.now()<deadline){expect(p.child.exitCode).toBe(null);await new Promise(ok=>setTimeout(ok,100));}
    expect(documents.has(cut.invoiceId)).toBe(true);const r=await record(cut);expect(r).toMatchObject({durum:'kuyrukta',entegratorRef:null,arsiv:null});reservationId=r.id;
    p.child.kill('SIGKILL');expect((await p.done).signal).toBe('SIGKILL');hold.delete(cut.invoiceId);
    expect(await call(cut)).toMatchObject({ok:false,status:409});expect(sendCounts.get(cut.invoiceId)).toBe(1);expect(lookupCounts.get(cut.invoiceId)??0).toBe(0);expect((await record(cut)).id).toBe(reservationId);
  }finally{if(p.child.exitCode===null&&p.child.signalCode===null){p.child.kill('SIGKILL');await p.done;}}
});
it('eski rezervasyon yeni süreçte benimsenir; ikinci sağlayıcı gönderimi ve ikinci e-belge kaydı oluşmaz',async()=>{
  // Yaşlandırılmış geçmiş fixture: 15 dakika doğal bekleme kabulü değildir.
  await tx(cut,(t:any)=>t.ebelgeKayit.update({where:{id:reservationId},data:{updatedAt:new Date(Date.now()-20*60000)}}));
  expect(await call(cut)).toMatchObject({ok:true,result:{basarili:true,durum:'iletildi',ebelgeRef:'FIXTURE-'+cut.invoiceId}});
  const r=await record(cut);expect(r.id).toBe(reservationId);expect(r.arsiv.xmlIcerik).toContain(cut.invoiceId);expect(sendCounts.get(cut.invoiceId)).toBe(1);expect(lookupCounts.get(cut.invoiceId)).toBe(1);
  expect(await tx(cut,(t:any)=>t.ebelgeKayit.count())).toBe(1);expect(await financial(cut)).toBe(financialBefore);
});
it('yeniden denemede arama desteği yoksa ağ çağrısı ve gönderim yapılmaz',async()=>{
  const f=await fixture(true);expect(await call(f,true)).toMatchObject({ok:false,status:503,message:expect.stringContaining('arama desteği sunmuyor')});
  expect(sendCounts.get(f.invoiceId)??0).toBe(0);expect(lookupCounts.get(f.invoiceId)??0).toBe(0);expect(await record(f)).toMatchObject({durum:'hata',arsiv:null,hataMesaji:expect.stringContaining('mükerrer gönderim riski')});
});
it('önceki belge sorgusu 503 dönerse yeniden gönderim yapılmaz',async()=>{
  const f=await fixture(true);lookupFails.add(f.invoiceId);expect(await call(f)).toMatchObject({ok:false,status:503,message:expect.stringContaining('mükerrer gönderim riski')});
  expect(sendCounts.get(f.invoiceId)??0).toBe(0);expect(lookupCounts.get(f.invoiceId)).toBe(1);expect(await record(f)).toMatchObject({durum:'hata',arsiv:null});
});
it('arama belgeyi bulamazsa tek gönderim yapılır ve XML arşivlenir',async()=>{
  const f=await fixture(true);expect(await call(f)).toMatchObject({ok:true,result:{basarili:true}});expect(sendCounts.get(f.invoiceId)).toBe(1);expect(lookupCounts.get(f.invoiceId)).toBe(1);expect((await record(f)).arsiv.xmlIcerik).toContain(f.invoiceId);
});
it('ilk gönderim arama desteği olmayan adaptörde çalışmaya devam eder',async()=>{
  const f=await fixture();expect(await call(f,true)).toMatchObject({ok:true,result:{basarili:true}});expect(sendCounts.get(f.invoiceId)).toBe(1);expect(lookupCounts.get(f.invoiceId)??0).toBe(0);
});
