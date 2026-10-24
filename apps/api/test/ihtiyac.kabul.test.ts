import '../src/ayar-tanimlari';
import 'reflect-metadata';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,expect,it} from 'vitest';
import {PrismaService} from '../src/core/prisma.service';
import {baglamlaCalistir} from '../src/core/istek-baglami';
import {IhtiyacService} from '../src/stok/ihtiyac.service';
import {SiparisGirisTarihiService} from '../src/stok/siparis-giris-tarihi.service';
import {IhtiyacUretimTalebiService} from '../src/stok/ihtiyac-uretim-talebi.service';
import {IhtiyacPlanService} from '../src/stok/ihtiyac-plan.service';
const url=process.env.F01_YARIS_DB_URL;
if(!url||!process.env.F01_YARIS_NONCE)throw Error('Geçici DB runner gerekli');
const u=new URL(url);if(u.hostname!=='127.0.0.1'||!/^\/f01_yaris_[a-f0-9]{16}$/.test(u.pathname)||u.username!=='tekir_app'||['5432','5433'].includes(u.port))throw Error('Geçici DB kapsamı geçersiz');
const p=new PrismaService({datasourceUrl:url}),s=new IhtiyacService(p);
beforeAll(async()=>{const [r]=await p.$queryRaw<any[]>`SELECT current_setting('tekir.f01_yaris_nonce',true) AS nonce,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;expect(r).toEqual({nonce:process.env.F01_YARIS_NONCE,rolsuper:false,rolbypassrls:false});});
afterAll(()=>p.$disconnect());
async function fixture(){const tenantId=randomUUID();return p.$transaction(async t=>{await t.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;await t.tenant.create({data:{id:tenantId,vkn:tenantId,unvan:'F04 izole test'}});await t.modulAyar.create({data:{tenantId,modul:'stok_ihtiyac_plani',ayarlar:{surum:1,mod:'pilot'}}});const user=await t.user.create({data:{tenantId,eposta:tenantId+'@test.invalid',parolaHash:'test',adSoyad:'Depo',rol:'depo'}});const k=await t.stokKart.create({data:{tenantId,kod:'S1',ad:'Ürün',tip:'urun',anaBirim:'adet'}});const d=await t.depo.create({data:{tenantId,kod:'D1',ad:'Depo'}});await t.stokDepoBakiye.create({data:{tenantId,stokId:k.id,depoId:d.id,mevcutMiktar:'10',rezerveMiktar:'4',yoldakiMiktar:'100'}});return {tenantId,userId:user.id,stokId:k.id,depoId:d.id};});}
type F=Awaited<ReturnType<typeof fixture>>;
const ctx=<T>(f:F,fn:()=>Promise<T>,rol:any='depo')=>baglamlaCalistir({...f,rol},fn);
const tx=<T>(f:F,fn:(t:any)=>Promise<T>)=>ctx(f,()=>p.tenantIslem(f.tenantId,fn));
const body=(f:F)=>({stokId:f.stokId,depoId:f.depoId,miktar:'8',birim:'adet',ihtiyacTarihi:'2099-01-01'});
const run=(f:F,extra={})=>ctx(f,()=>s.onizle({...body(f),...extra}));
it('stok 10 rezerv 4 ihtiyaç 8: eksik 2; stok ve satın alma değişmez',async()=>{const f=await fixture();const snapshot=()=>tx(f,async t=>JSON.stringify([await t.stokDepoBakiye.findMany(),await t.stokHareket.findMany(),await t.belge.findMany(),await t.auditLog.findMany()]));const before=await snapshot();expect((await run(f)).hesap).toMatchObject({kullanilabilir:'6.000',eksik:'2.000',yoldaki:'100.000'});expect(await snapshot()).toBe(before);});
it('birim katsayısını kesin uygular ve fazla hassasiyeti yuvarlamaz',async()=>{const f=await fixture();await tx(f,t=>t.stokBirim.create({data:{tenantId:f.tenantId,stokId:f.stokId,ad:'kutu',katsayi:'2.5'}}));expect((await run(f,{miktar:'4',birim:'kutu'})).hesap.talep).toBe('10.000');await expect(run(f,{miktar:'0.001',birim:'kutu'})).rejects.toMatchObject({status:400});});
it('başka tenant ürün ve deposu görünmez',async()=>{const f=await fixture(),g=await fixture();await expect(run(f,{stokId:g.stokId})).rejects.toMatchObject({status:404});await expect(run(f,{depoId:g.depoId})).rejects.toMatchObject({status:404});expect(await tx(f,t=>t.stokKart.findMany({where:{id:g.stokId}}))).toEqual([]);});
it('bakiyesiz depoda stok sıfırdır; başka depodan stok eklenmez',async()=>{const f=await fixture();const d:any=await tx(f,t=>t.depo.create({data:{tenantId:f.tenantId,kod:'D2',ad:'Boş depo'}}));expect((await run(f,{depoId:d.id})).hesap).toMatchObject({mevcut:'0.000',eksik:'8.000'});});
it('varyant stoklarını birleştirmez',async()=>{const f=await fixture();await tx(f,t=>t.stokVaryant.create({data:{tenantId:f.tenantId,stokId:f.stokId,kod:'V1',ad:'Mavi',nitelikler:{renk:'mavi'}}}));await expect(run(f)).rejects.toMatchObject({status:400});});
it('pasif depo ve hizmet kartını reddeder',async()=>{const f=await fixture();await tx(f,t=>t.depo.update({where:{id:f.depoId},data:{aktif:false}}));await expect(run(f)).rejects.toMatchObject({status:404});await tx(f,t=>t.depo.update({where:{id:f.depoId},data:{aktif:true}}));await tx(f,t=>t.stokKart.update({where:{id:f.stokId},data:{tip:'hizmet'}}));await expect(run(f)).rejects.toMatchObject({status:404});});
it('geçmiş gün, geçersiz takvim, sıfır miktar ve bilinmeyen birimi reddeder',async()=>{const f=await fixture();for(const x of [{ihtiyacTarihi:'2020-01-01'},{ihtiyacTarihi:'2099-02-30'},{miktar:'0'},{birim:'bilinmeyen'}])await expect(run(f,x)).rejects.toMatchObject({status:400});});
it('yetkisiz rol servise doğrudan erişemez',async()=>{const f=await fixture();for(const rol of ['satis','salt_okunur','uretim_operatoru'])await expect(ctx(f,()=>s.onizle(body(f)),rol)).rejects.toMatchObject({status:403});});
it('stok değişince aynı sorgu yeni bakiyeyi döndürür',async()=>{const f=await fixture();await run(f);await tx(f,t=>t.stokDepoBakiye.updateMany({data:{mevcutMiktar:'20'}}));expect((await run(f)).hesap.eksik).toBe('0.000');});

const girisServisi = new SiparisGirisTarihiService(p);
async function siparis(f:F, extra:Record<string,unknown>={}){
 return tx(f,async t=>{
  const c=await t.cariHesap.create({data:{tenantId:f.tenantId,kod:'C1',unvan:'İzole tedarikçi',tip:'tedarikci'}});
  const b=await t.belge.create({data:{tenantId:f.tenantId,cariId:c.id,depoId:f.depoId,tur:'siparis',yon:'alis',durum:'kismen_kapandi',tarih:new Date('2026-10-22'),toplamBrut:0,toplamSatirIskontosu:0,genelIskontoToplam:0,toplamMatrah:0,toplamKdv:0,toplamTevkifat:0,toplamNetKdv:0,genelToplam:0,...extra}});
  const r=await t.belgeSatir.create({data:{tenantId:f.tenantId,belgeId:b.id,stokId:f.stokId,miktar:'8',teslimEdilenMiktar:'3',birim:'adet',birimFiyat:0,matrah:0,kdvTutari:0,netKdvTutari:0,toplamTutar:0}});
  return {satirId:r.id,belgeId:b.id};
 });
}
const oku=(f:F,id:string)=>ctx(f,()=>girisServisi.oku(id));
async function dogrula(f:F,id:string,tarih:string|null='2098-12-31'){
 const k=await oku(f,id);
 return ctx(f,()=>girisServisi.kaydet(id,{tarih,beklenenSurum:k.surum,beklenenKaynakOzeti:k.kaynakOzeti,gerekce:'Tedarikçiden teyit edildi'}),'muhasebe');
}
const tarihli=(f:F)=>ctx(f,()=>s.onizle(body(f),true));

it('doğrulanmış tarihli kalan giriş açığı kapatır; teslim birikimi ikinci kez eklenmez',async()=>{
 const f=await fixture(),r=await siparis(f);
 expect((await tarihli(f)).tarihli).toMatchObject({eksik:'2.000',tarihliGiris:'0.000'});
 await dogrula(f,r.satirId);
 expect((await tarihli(f)).tarihli).toMatchObject({eksik:'0.000',tarihliGiris:'5.000'});
 expect((await run(f)).hesap.eksik).toBe('2.000');
 await tx(f,t=>t.belgeSatir.update({where:{id:r.satirId},data:{teslimEdilenMiktar:'7'}}));
 expect((await tarihli(f)).tarihli).toMatchObject({eksik:'1.000',tarihliGiris:'1.000'});
 expect((await oku(f,r.satirId)).gecerli).toBe(true);
});
it('geç giriş ve kullanıcı tarafından kaldırılan doğrulama yeterlilik yaratmaz',async()=>{
 const f=await fixture(),r=await siparis(f);
 await dogrula(f,r.satirId,'2099-01-02');
 expect((await tarihli(f)).tarihli).toMatchObject({eksik:'2.000',dislananlar:[{neden:'ufuk_disinda'}]});
 await dogrula(f,r.satirId,null);
 expect((await tarihli(f)).tarihli).toMatchObject({eksik:'2.000',dislananlar:[{neden:'tarih_dogrulanmadi'}]});
 expect(await tx(f,t=>t.auditLog.count({where:{varlikId:r.satirId}}))).toBe(2);
});
it('kaynak miktarı değişince tarih geçersizleşir ve eski kaynak kanıtıyla yazılmaz',async()=>{
 const f=await fixture(),r=await siparis(f);await dogrula(f,r.satirId);const k=await oku(f,r.satirId);
 await tx(f,t=>t.belgeSatir.update({where:{id:r.satirId},data:{miktar:'9'}}));
 expect((await oku(f,r.satirId)).gecerli).toBe(false);
 expect((await tarihli(f)).tarihli).toMatchObject({tarihliGiris:'0.000',eksik:'2.000'});
 await expect(ctx(f,()=>girisServisi.kaydet(r.satirId,{tarih:'2098-12-30',beklenenSurum:k.surum,beklenenKaynakOzeti:k.kaynakOzeti,gerekce:'Eski ekrandan değişiklik'}),'muhasebe')).rejects.toMatchObject({status:409});
});
it('başka tenant tarihi ve satırı görünmez; çapraz tenant FK yazımı reddedilir',async()=>{
 const f=await fixture(),g=await fixture(),r=await siparis(f);await dogrula(f,r.satirId);
 await expect(oku(g,r.satirId)).rejects.toMatchObject({status:404});
 await expect(dogrula(g,r.satirId)).rejects.toMatchObject({status:404});
 expect(await tx(g,t=>t.siparisGirisTarihi.findMany({where:{satirId:r.satirId}}))).toEqual([]);
 await expect(tx(g,t=>t.siparisGirisTarihi.create({data:{tenantId:g.tenantId,satirId:r.satirId,tarih:new Date('2098-12-31'),kaynakOzeti:'a'.repeat(64),gerekce:'Çapraz tenant denemesi',dogrulayanUserId:g.userId}}))).rejects.toThrow();
});
it('eşzamanlı farklı revizyonlardan biri geçer; ağ tekrarı ikinci audit yaratmaz',async()=>{
 const f=await fixture(),r=await siparis(f),k=await oku(f,r.satirId);
 const g={tarih:'2098-12-31',beklenenSurum:0,beklenenKaynakOzeti:k.kaynakOzeti,gerekce:'Tedarikçiden teyit edildi'};
 const yaz=(body:unknown)=>ctx(f,()=>girisServisi.kaydet(r.satirId,body),'muhasebe');
 const sonuc=await Promise.allSettled([yaz(g),yaz({...g,tarih:'2098-12-30'})]);
 expect(sonuc.filter(v=>v.status==='fulfilled')).toHaveLength(1);
 expect(sonuc.filter(v=>v.status==='rejected')).toHaveLength(1);
 const kazanan=sonuc[0].status==='fulfilled'?g:{...g,tarih:'2098-12-30'};
 await yaz(kazanan);
 expect(await tx(f,t=>t.auditLog.count({where:{varlikId:r.satirId}}))).toBe(1);
 expect((await oku(f,r.satirId)).surum).toBe(1);
});
it('depo ve salt okunur roller tarih doğrulayamaz; geçmiş ve geçersiz gün reddedilir',async()=>{
 const f=await fixture(),r=await siparis(f),k=await oku(f,r.satirId);
 const g={tarih:'2098-12-31',beklenenSurum:0,beklenenKaynakOzeti:k.kaynakOzeti,gerekce:'Tedarikçiden teyit edildi'};
 for(const rol of ['depo','salt_okunur','satis'])await expect(ctx(f,()=>girisServisi.kaydet(r.satirId,g),rol)).rejects.toMatchObject({status:403});
 for(const tarih of ['2020-01-01','2099-02-30'])await expect(ctx(f,()=>girisServisi.kaydet(r.satirId,{...g,tarih}),'muhasebe')).rejects.toMatchObject({status:400});
 expect(await tx(f,t=>t.siparisGirisTarihi.count())).toBe(0);
});
it('iptal ve deposuz sipariş tarihli hesapta sayılmaz; yazma da reddedilir',async()=>{
 for(const extra of [{durum:'iptal'},{depoId:null}]){
  const f=await fixture(),r=await siparis(f,extra);
  await expect(oku(f,r.satirId)).rejects.toMatchObject({status:409});
  expect((await tarihli(f)).tarihli).toMatchObject({tarihliGiris:'0.000',eksik:'2.000'});
 }
});
it('sipariş kalanı yoldaki bakiyesini aşarsa kısmi veya iyimser sonuç verilmez',async()=>{
 const f=await fixture();await siparis(f);
 await tx(f,t=>t.stokDepoBakiye.updateMany({data:{yoldakiMiktar:'4'}}));
 await expect(tarihli(f)).rejects.toMatchObject({status:409});
});
it('audit yazılamazsa tarih kaydı da transaction ile geri alınır',async()=>{
 const f=await fixture(),r=await siparis(f),k=await oku(f,r.satirId);
 const hatali=new SiparisGirisTarihiService({tenantIslem:(tenantId:string,fn:any)=>p.tenantIslem(tenantId,t=>fn({$queryRaw:t.$queryRaw.bind(t),belgeSatir:t.belgeSatir,siparisGirisTarihi:t.siparisGirisTarihi,auditLog:{create:async()=>{throw Error('İzole audit arızası');}}}))} as never);
 await expect(ctx(f,()=>hatali.kaydet(r.satirId,{tarih:'2098-12-31',beklenenSurum:0,beklenenKaynakOzeti:k.kaynakOzeti,gerekce:'Audit rollback testi'}),'muhasebe')).rejects.toThrow('İzole audit arızası');
 expect(await tx(f,t=>t.siparisGirisTarihi.count())).toBe(0);
 expect(await tx(f,t=>t.auditLog.count({where:{varlikId:r.satirId}}))).toBe(0);
});
it('tarih doğrulama ve önizleme belge stok ve finans kayıtlarını değiştirmez',async()=>{
 const f=await fixture(),r=await siparis(f);
 const snapshot=()=>tx(f,async t=>JSON.stringify([await t.belge.findMany(),await t.belgeSatir.findMany(),await t.stokDepoBakiye.findMany(),await t.stokHareket.findMany(),await t.fatura.findMany(),await t.cariHareket.findMany(),await t.satinAlmaTalebi.findMany()]));
 const once=await snapshot();await dogrula(f,r.satirId);await tarihli(f);
 expect(await snapshot()).toBe(once);
});
it('aynı gün ve miktarda doğrulama revizyonu kaynak kanıtını değiştirir; saat değişimi değiştirmez',async()=>{
 const f=await fixture(),r=await siparis(f);await dogrula(f,r.satirId);
 const once=(await tarihli(f)).tarihli!;expect((await tarihli(f)).tarihli!.kaynakKaniti).toBe(once.kaynakKaniti);
 await dogrula(f,r.satirId);
 const sonra=(await tarihli(f)).tarihli!;expect(sonra.eksik).toBe(once.eksik);expect(sonra.kaynakKaniti).not.toBe(once.kaynakKaniti);
});

const uretimTalepServisi=new IhtiyacUretimTalebiService(p),planServisi=new IhtiyacPlanService(p,s);
async function uretim(f:F){return tx(f,async t=>{
 const mamul=await t.stokKart.create({data:{tenantId:f.tenantId,kod:'M1',ad:'Mamul',tip:'urun',anaBirim:'adet'}});
 const depo=await t.depo.create({data:{tenantId:f.tenantId,kod:'D3',ad:'Diğer malzeme deposu'}});
 const e=await t.uretimEmri.create({data:{tenantId:f.tenantId,no:'UR-1',stokId:mamul.id,hedefDepoId:depo.id,planlananMiktar:'1',tarih:new Date('2026-10-22'),durum:'malzeme_bekliyor'}});
 const k=await t.uretimEmriKalem.create({data:{tenantId:f.tenantId,uretimEmriId:e.id,malzemeStokId:f.stokId,planlananMiktar:'8',sarfEdilenMiktar:'2'}});
 await t.uretimMalzemeRezervasyon.createMany({data:[{tenantId:f.tenantId,uretimEmriKalemId:k.id,depoId:f.depoId,rezerveMiktar:'4',sarfEdilenMiktar:'1',cozulenMiktar:'1'},{tenantId:f.tenantId,uretimEmriKalemId:k.id,depoId:depo.id,rezerveMiktar:'1'}]});
 return {kalemId:k.id,emirId:e.id,digerDepoId:depo.id};
});}
async function ata(f:F,kalemId:string,extra={}){
 const k=await ctx(f,()=>uretimTalepServisi.oku(kalemId));
 return ctx(f,()=>uretimTalepServisi.kaydet(kalemId,{depoId:f.depoId,ihtiyacTarihi:'2098-12-30',aktif:true,beklenenSurum:k.atama?.surum??0,beklenenKaynakOzeti:k.kaynakOzeti,gerekce:'Hammadde deposu ve günü doğrulandı',...extra}));
}
async function planGirdisi(f:F){const r=await tarihli(f);return {istekAnahtari:randomUUID(),beklenenSonucKaniti:r.sonucKaniti!,girdi:body(f)};}
it('rezerv dışı atanmamış üretim ihtiyacında mamul deposu tahmin edilmez ve yeterlilik verilmez',async()=>{
 const f=await fixture();await uretim(f);
 expect((await tarihli(f)).tarihli).toMatchObject({veriYeterli:false,durum:'dogrulanamadi',dislananlar:[{neden:'tarih_dogrulanmadi'}]});
 await expect(ctx(f,()=>planServisi.kaydet({istekAnahtari:randomUUID(),beklenenSonucKaniti:'a'.repeat(64),girdi:body(f)}))).rejects.toMatchObject({status:409});
});
it('çok depolu rezervler bir kez düşülür; yalnız rezerv dışı kalan 3 birim ek talep olur',async()=>{
 const f=await fixture(),k=await uretim(f);await ata(f,k.kalemId);
 expect((await tarihli(f)).tarihli).toMatchObject({veriYeterli:true,ekTalep:'3.000',eksik:'5.000'});
 await ata(f,k.kalemId,{depoId:k.digerDepoId});
 expect((await tarihli(f)).tarihli).toMatchObject({ekTalep:'0.000',eksik:'2.000'});
 await tx(f,t=>t.depo.update({where:{id:k.digerDepoId},data:{aktif:false}}));
 expect((await tarihli(f)).tarihli).toMatchObject({veriYeterli:false});
});
it('üretim planı değişince atama yeniden doğrulanana kadar yeterlilik kapanır',async()=>{
 const f=await fixture(),k=await uretim(f);await ata(f,k.kalemId);
 await tx(f,t=>t.uretimEmriKalem.update({where:{id:k.kalemId},data:{ekIhtiyacMiktari:'1'}}));
 expect((await tarihli(f)).tarihli).toMatchObject({veriYeterli:false});
 await ata(f,k.kalemId);expect((await tarihli(f)).tarihli).toMatchObject({veriYeterli:true,ekTalep:'4.000'});
 await ata(f,k.kalemId,{aktif:false});expect((await tarihli(f)).tarihli).toMatchObject({veriYeterli:false});
});
it('üretim ataması başka tenant kalemine veya deposuna yazılamaz',async()=>{
 const f=await fixture(),g=await fixture(),k=await uretim(f);
 await expect(ctx(g,()=>uretimTalepServisi.oku(k.kalemId))).rejects.toMatchObject({status:404});
 await expect(ata(f,k.kalemId,{depoId:g.depoId})).rejects.toMatchObject({status:404});
 await expect(ctx(f,()=>uretimTalepServisi.oku(k.kalemId),'satis')).rejects.toMatchObject({status:403});
});
it('aynı üretim ataması ağ tekrarında tek sürüm/audit oluşturur; eski revizyon reddedilir',async()=>{
 const f=await fixture(),k=await uretim(f),once=await ctx(f,()=>uretimTalepServisi.oku(k.kalemId));
 const g={depoId:f.depoId,ihtiyacTarihi:'2098-12-30',aktif:true,beklenenSurum:0,beklenenKaynakOzeti:once.kaynakOzeti,gerekce:'Hammadde deposu doğrulandı'};
 const yaz=(b:unknown)=>ctx(f,()=>uretimTalepServisi.kaydet(k.kalemId,b));
 await Promise.all([yaz(g),yaz(g)]);
 expect(await tx(f,t=>t.auditLog.count({where:{varlikId:k.kalemId}}))).toBe(1);
 await expect(yaz({...g,ihtiyacTarihi:'2098-12-29'})).rejects.toMatchObject({status:409});
});
it('plan ve kaynak payları aynı snapshot ile kalıcı saklanır; tekrar ikinci plan/audit yazmaz',async()=>{
 const f=await fixture(),r=await siparis(f);await dogrula(f,r.satirId);const g=await planGirdisi(f);
 const [a,b]=await Promise.all([ctx(f,()=>planServisi.kaydet(g)),ctx(f,()=>planServisi.kaydet(g))]);
 expect(a.id).toBe(b.id);expect(a.karsilamaBaglari.map(v=>({tur:v.tur,miktar:v.miktar.toFixed(3)})).sort((a,b)=>a.tur.localeCompare(b.tur))).toEqual([{tur:'mevcut_stok',miktar:'6.000'},{tur:'siparis_girisi',miktar:'2.000'}]);
 expect(await tx(f,t=>t.auditLog.count({where:{varlikId:a.id}}))).toBe(1);
 expect((await ctx(f,()=>planServisi.oku(a.id))).guncel).toBe(true);
 await expect(ctx(f,()=>planServisi.kaydet({...g,girdi:{...g.girdi,miktar:'9'}}))).rejects.toMatchObject({status:409});
});
it('eski önizlemeyle plan yazılmaz; saklanan plan kaynak değişiminde eski kalır',async()=>{
 const f=await fixture(),r=await siparis(f);await dogrula(f,r.satirId);const g=await planGirdisi(f);
 const plan=await ctx(f,()=>planServisi.kaydet(g));
 await dogrula(f,r.satirId);
 await expect(ctx(f,()=>planServisi.kaydet({...g,istekAnahtari:randomUUID()}))).rejects.toMatchObject({status:409});
 const sonra=await ctx(f,()=>planServisi.oku(plan.id));expect(sonra.guncel).toBe(false);expect(sonra.snapshot).toEqual(plan.snapshot);expect(sonra.karsilamaBaglari).toEqual(plan.karsilamaBaglari);
});
it('plan ve paylarda tenant RLS ve değişmezlik DB rolüyle korunur',async()=>{
 const f=await fixture(),g=await fixture(),plan=await ctx(f,async()=>planServisi.kaydet(await planGirdisi(f)));
 await expect(ctx(g,()=>planServisi.oku(plan.id))).rejects.toMatchObject({status:404});
 expect(await tx(g,t=>t.ihtiyacKarsilamaBagi.findMany({where:{planId:plan.id}}))).toEqual([]);
 await expect(tx(f,t=>t.ihtiyacPlani.update({where:{id:plan.id},data:{snapshot:{degisti:true}}}))).rejects.toThrow();
 await expect(tx(f,t=>t.ihtiyacKarsilamaBagi.deleteMany({where:{planId:plan.id}}))).rejects.toThrow();
 expect((await ctx(f,()=>planServisi.oku(plan.id))).guncel).toBe(true);
});
it('plan audit hatası planı ve bütün payları geri alır',async()=>{
 const f=await fixture(),g=await planGirdisi(f);
 const hataliPrisma={tenantIslem:(id:string,fn:any,opts:any)=>p.tenantIslem(id,t=>fn(new Proxy(t,{get(target,key){if(key==='auditLog')return {create:async()=>{throw Error('İzole plan audit arızası');}};return Reflect.get(target,key);}})),opts)};
 const hatali=new IhtiyacPlanService(hataliPrisma as never,s);
 await expect(ctx(f,()=>hatali.kaydet(g))).rejects.toThrow('İzole plan audit arızası');
 expect(await tx(f,t=>t.ihtiyacPlani.count())).toBe(0);expect(await tx(f,t=>t.ihtiyacKarsilamaBagi.count())).toBe(0);
});
it('plan listesi tarihsel etiketlerle 20/1 sayfalanır; aynı zamandaki kayıtlar atlanmaz ve snapshot taşınmaz',async()=>{
 const f=await fixture();await tx(f,t=>t.ihtiyacPlani.createMany({data:Array.from({length:21},()=>({tenantId:f.tenantId,userId:f.userId,istekAnahtari:randomUUID(),istekOzeti:'b'.repeat(64),sonucKaniti:'a'.repeat(64),createdAt:new Date('2026-10-22T12:00:00.123Z'),girdi:body(f),snapshot:{stok:{kod:'TAR-1',ad:'Tarihsel ürün',anaBirim:'adet'},depo:{ad:'Tarihsel depo'},hesap:{talep:'8.000'}}}))}));
 const zonlu=new IhtiyacPlanService({tenantIslem:(tenantId:string,fn:any,opts:any)=>p.tenantIslem(tenantId,async t=>{await t.$executeRaw`SELECT set_config('TimeZone','Europe/Istanbul',true)`;return fn(t);},opts)} as never,s);
 const ilk=await ctx(f,()=>zonlu.listele({}));expect(ilk.kayitlar).toHaveLength(20);expect(ilk.sonrakiImlec).not.toBeNull();
 expect(ilk.kayitlar[0]).toMatchObject({stokKod:'TAR-1',stokAd:'Tarihsel ürün',depoAd:'Tarihsel depo',miktar:'8.000'});expect(ilk.kayitlar[0]).not.toHaveProperty('snapshot');
 const son=await ctx(f,()=>zonlu.listele({imlec:ilk.sonrakiImlec}));expect(son.kayitlar).toHaveLength(1);expect(son.sonrakiImlec).toBeNull();expect(new Set([...ilk.kayitlar,...son.kayitlar].map(k=>k.id)).size).toBe(21);
});
it('plan listesi başka tenant imlecini ve yetkisiz rolü reddeder',async()=>{
 const f=await fixture(),g=await fixture(),plan=await ctx(f,async()=>planServisi.kaydet(await planGirdisi(f)));
 expect((await ctx(g,()=>planServisi.listele({}))).kayitlar).toEqual([]);
 await expect(ctx(g,()=>planServisi.listele({imlec:plan.id}))).rejects.toMatchObject({status:409});
 await expect(ctx(f,()=>planServisi.listele({}),'satis')).rejects.toMatchObject({status:403});
 await expect(ctx(f,()=>planServisi.listele({adet:'5000'}))).rejects.toMatchObject({status:400});
});

// Plan ile talep aynı transaction'dadır; normal satın alma bütçe/kalem kuralları korunur.
import {SatinAlmaService} from '../src/satin-alma/satin-alma.service';
import {ButceService} from '../src/butce/butce.service';
const satinAlma=new SatinAlmaService(p,{} as never,{} as never,new ButceService(p),undefined,s);
async function planliTalep(){const f=await fixture(),plan=await ctx(f,async()=>planServisi.kaydet(await planGirdisi(f)));const g={ihtiyacPlaniId:plan.id,ihtiyacTarihi:'2099-01-01',gerekce:'İhtiyaç planından satın alma',butceAnahtari:'mal_alis',kalemler:[{stokId:f.stokId,miktar:'2.000',tahminiBirimFiyat:'12.50'}]};return {f,plan,g};}
it('aynı plandan eşzamanlı iki satın alma: tek talep, bağ, olay ve audit; ağ tekrarı aynı kaydı döndürür',async()=>{
 const {f,plan,g}=await planliTalep();const yaz=()=>ctx(f,()=>satinAlma.olustur(g));const [a,b]=await Promise.all([yaz(),yaz()]);expect(a).toEqual(b);expect(await yaz()).toEqual(a);
 expect(await tx(f,t=>t.satinAlmaTalebi.count())).toBe(1);expect(await tx(f,t=>t.ihtiyacSatinAlmaBagi.count())).toBe(1);expect(await tx(f,t=>t.satinAlmaTalepOlayi.count())).toBe(1);
 expect(await tx(f,t=>t.auditLog.count({where:{varlikId:plan.id,islem:'ihtiyac_planindan_talep'}}))).toBe(1);expect((await ctx(f,()=>planServisi.oku(plan.id))).satinAlmaBagi?.talepId).toBe(a.id);
 await expect(ctx(f,()=>satinAlma.olustur({...g,gerekce:'Farklı ikinci talep'}))).rejects.toMatchObject({status:409});
});
it('eski plan, yanlış miktar/ürün/gün ve yetkisiz rol yeni talep yazamaz',async()=>{
 const {f,g}=await planliTalep();
 for(const extra of [{kalemler:[{...g.kalemler[0],miktar:'3'}]},{ihtiyacTarihi:'2099-01-02'},{kalemler:[{...g.kalemler[0],stokId:randomUUID()}]}])await expect(ctx(f,()=>satinAlma.olustur({...g,...extra}))).rejects.toMatchObject({status:400});
 await expect(ctx(f,()=>satinAlma.olustur(g),'satis')).rejects.toMatchObject({status:403});
 await tx(f,t=>t.stokDepoBakiye.updateMany({data:{mevcutMiktar:'11'}}));await expect(ctx(f,()=>satinAlma.olustur(g))).rejects.toMatchObject({status:409});expect(await tx(f,t=>t.satinAlmaTalebi.count())).toBe(0);
});
it('plan-talep bağı tenant FK, RLS ve değişmezlik sınırlarını korur',async()=>{
 const {f,plan,g}=await planliTalep(),foreign=await fixture();await expect(ctx(foreign,()=>satinAlma.olustur(g))).rejects.toMatchObject({status:404});const a=await ctx(f,()=>satinAlma.olustur(g));
 expect(await tx(foreign,t=>t.ihtiyacSatinAlmaBagi.findMany())).toEqual([]);
 await expect(tx(f,t=>t.ihtiyacSatinAlmaBagi.deleteMany())).rejects.toThrow();await expect(tx(f,t=>t.ihtiyacSatinAlmaBagi.updateMany({data:{istekOzeti:'a'.repeat(64)}}))).rejects.toThrow();
 await expect(tx(foreign,t=>t.ihtiyacSatinAlmaBagi.create({data:{tenantId:foreign.tenantId,planId:plan.id,talepId:a.id,userId:foreign.userId,istekOzeti:'a'.repeat(64)}}))).rejects.toThrow();
});
it('bağ audit hatası talebi, sayacı, olayı ve bağı birlikte geri alır',async()=>{
 const {f,g}=await planliTalep();const hataliPrisma={tenantIslem:(tenantId:string,fn:any,options:any)=>p.tenantIslem(tenantId,t=>fn(new Proxy(t,{get(target,key){if(key==='auditLog')return {create:async()=>{throw Error('Bağ audit arızası');}};return Reflect.get(target,key);}})),options)};
 const hatali=new SatinAlmaService(hataliPrisma as never,{} as never,{} as never,new ButceService(p),undefined,s);
 await expect(ctx(f,()=>hatali.olustur(g))).rejects.toThrow('Bağ audit arızası');for(const model of ['satinAlmaTalebi','satinAlmaSayac','satinAlmaTalepOlayi','ihtiyacSatinAlmaBagi'])expect(await tx(f,t=>t[model].count())).toBe(0);
});
it('bağlı taslak değiştirilemez; iptalden sonra aynı plan ikinci talep açmaz',async()=>{
 const {f,g}=await planliTalep(),a=await ctx(f,()=>satinAlma.olustur(g));await expect(ctx(f,()=>satinAlma.guncelle(a.id,{...g,ihtiyacPlaniId:undefined}))).rejects.toMatchObject({status:409});
 await tx(f,t=>t.satinAlmaTalebi.update({where:{id:a.id},data:{durum:'iptal'}}));expect(await ctx(f,()=>satinAlma.olustur(g))).toEqual(a);expect(await tx(f,t=>t.satinAlmaTalebi.count())).toBe(1);
});
it('açığı olmayan plan pozitif satın alma talebine dönüştürülemez',async()=>{
 const f=await fixture(),girdi={...body(f),miktar:'1'},sonuc=await ctx(f,()=>s.onizle(girdi,true));const plan=await ctx(f,()=>planServisi.kaydet({istekAnahtari:randomUUID(),beklenenSonucKaniti:sonuc.sonucKaniti,girdi}));
 await expect(ctx(f,()=>satinAlma.olustur({ihtiyacPlaniId:plan.id,ihtiyacTarihi:'2099-01-01',gerekce:'Açıksız plan denemesi',butceAnahtari:'mal_alis',kalemler:[{stokId:f.stokId,miktar:'1',tahminiBirimFiyat:'1'}]}))).rejects.toMatchObject({status:409});expect(await tx(f,t=>t.satinAlmaTalebi.count())).toBe(0);
});

it('pilot önizlemesi seçili örnekleri tek salt okunur snapshot ile raporlar; stok, plan, talep ve audit değişmez',async()=>{
 const f=await fixture(),foreign=await fixture();
 const snapshot=()=>tx(f,async t=>JSON.stringify([await t.stokDepoBakiye.findMany(),await t.stokHareket.findMany(),await t.ihtiyacPlani.findMany(),await t.satinAlmaTalebi.findMany(),await t.auditLog.findMany()]));const once=await snapshot();
 const r=await ctx(f,()=>s.pilotOnizle({ornekler:[{etiket:'K1',girdi:body(f)},{etiket:'Birim hatası',girdi:{...body(f),birim:'bilinmeyen'}},{etiket:'Başka şirket',girdi:{...body(f),stokId:foreign.stokId}}]}));
 expect(r).toMatchObject({raporKapsami:'secili_ornekler',dbSaltOkunur:true,kapasiteAyrildi:false,operasyonPilotuTamamlandi:false,toplamOrnek:3,ozet:{hesaplanan:1,veriBelirsiz:0,reddedilen:2,tedarikGerekli:1,erkenAcik:0}});
 expect(r.ornekler[0]).toMatchObject({etiket:'K1',durum:'hesaplandi',eksik:'2.000',anaBirim:'adet',hesap:{mevcut:'10.000',rezerve:'4.000',kullanilabilir:'6.000',talep:'8.000'}});expect(r.ornekler[1]).toMatchObject({durum:'reddedildi',httpDurumu:400});expect(r.ornekler[2]).toMatchObject({durum:'reddedildi',httpDurumu:404});expect(await snapshot()).toBe(once);
});
it('pilot kaynak dışlamalarını sayar; atanmamış üretimi veya doğrulanmamış siparişi yeterlilik diye sunmaz',async()=>{
 const f=await fixture();await siparis(f);await uretim(f);const r=await ctx(f,()=>s.pilotOnizle({ornekler:[{etiket:'Eksik kaynaklar',girdi:body(f)}]}));
 expect(r.ozet).toMatchObject({hesaplanan:1,veriBelirsiz:1,tedarikGerekli:0,reddedilen:0});expect(r.ornekler[0]).toMatchObject({veriYeterli:false,dislananKaynakSayisi:2,dislanmaNedenleri:[{neden:'tarih_dogrulanmadi',adet:2}]});expect(r.ornekler[0]).not.toHaveProperty('hareketler');
});
it('pilot rol, on örnek, tekil etiket ve sıkı girdi sınırlarını denetler',async()=>{
 const f=await fixture(),ornek={etiket:'İhtiyaç',girdi:body(f)};
 await expect(ctx(f,()=>s.pilotOnizle({ornekler:[ornek]}),'satis')).rejects.toMatchObject({status:403});
 for(const g of [{ornekler:[]},{ornekler:Array(11).fill(ornek)},{ornekler:[ornek,ornek]},{ornekler:[ornek],tenantId:randomUUID()},{ornekler:[{...ornek,girdi:{...body(f),miktar:'0'}}]}])await expect(ctx(f,()=>s.pilotOnizle(g))).rejects.toMatchObject({status:400});
});
it('pilot transaction DB seviyesinde yazmayı reddeder; beklenmeyen hata başarılı kısmi rapora çevrilmez',async()=>{
 const f=await fixture(),yazan=new IhtiyacService(p);
 yazan.onizle=async(_body,_tarihli,db)=>{await db!.stokDepoBakiye.updateMany({data:{mevcutMiktar:'999'}});throw Error('Yazma beklenmedik biçimde geçti');};
 await expect(ctx(f,()=>yazan.pilotOnizle({ornekler:[{etiket:'Yazma denemesi',girdi:body(f)}]}))).rejects.toThrow();expect((await tx(f,t=>t.stokDepoBakiye.findFirst())).mevcutMiktar.toFixed(3)).toBe('10.000');
 const arizali=new IhtiyacService(p);arizali.onizle=async()=>{throw Error('Beklenmeyen pilot hatası');};await expect(ctx(f,()=>arizali.pilotOnizle({ornekler:[{etiket:'Arıza',girdi:body(f)}]}))).rejects.toThrow('Beklenmeyen pilot hatası');
});

import {AyarlarService} from '../src/core/ayarlar/ayarlar.service';
const modul='stok_ihtiyac_plani',ayarlar=new AyarlarService(p);
const modYaz=(f:F,mod:string)=>ctx(f,()=>ayarlar.guncelle(modul,{surum:1,mod}),'yonetici');
it('ayar yoksa yeni F04 akışları yönetici dahil kapalıdır; anlık stok ve normal satın alma korunur',async()=>{
 const {f,plan,g}=await planliTalep(),planIstegi=await planGirdisi(f);await tx(f,t=>t.modulAyar.deleteMany({where:{modul}}));
 for(const fn of [()=>s.onizle(body(f),true),()=>s.pilotOnizle({ornekler:[{etiket:'K1',girdi:body(f)}]}),()=>planServisi.oku(plan.id),()=>planServisi.listele({}),()=>planServisi.kaydet(planIstegi),()=>satinAlma.olustur(g)])await expect(ctx(f,fn,'yonetici')).rejects.toMatchObject({status:403});
 expect((await run(f)).hesap.eksik).toBe('2.000');expect(await ctx(f,()=>satinAlma.olustur({...g,ihtiyacPlaniId:undefined}))).toHaveProperty('id');
});
it('salt okunur mod hesap ve güncel geçmişe izin verir; bütün F04 yazmaları ve tekrarları engeller',async()=>{
 const {f,plan,g}=await planliTalep(),pg=await planGirdisi(f);await modYaz(f,'salt_okunur');
 expect((await tarihli(f)).erisim).toMatchObject({mod:'salt_okunur',yazabilir:false});expect(await ctx(f,()=>planServisi.oku(plan.id))).toMatchObject({guncel:true,erisim:{yazabilir:false}});expect((await ctx(f,()=>planServisi.listele({}))).kayitlar).toHaveLength(1);
 expect(await ctx(f,()=>s.pilotOnizle({ornekler:[{etiket:'K1',girdi:body(f)}]}))).toMatchObject({dbSaltOkunur:true});
 const before=await tx(f,t=>t.auditLog.count());
 for(const fn of [()=>planServisi.kaydet(pg),()=>satinAlma.olustur(g),()=>girisServisi.kaydet(randomUUID(),{tarih:'2098-12-31',beklenenSurum:0,beklenenKaynakOzeti:'a'.repeat(64),gerekce:'Salt okunur teyit denemesi'}),()=>uretimTalepServisi.kaydet(randomUUID(),{depoId:f.depoId,ihtiyacTarihi:'2098-12-30',aktif:true,beklenenSurum:0,beklenenKaynakOzeti:'a'.repeat(64),gerekce:'Salt okunur atama denemesi'})])await expect(ctx(f,fn,'yonetici')).rejects.toMatchObject({status:403});
 expect(await tx(f,t=>t.auditLog.count())).toBe(before);
});
it('bozuk ayar kapalı kabul edilir; mod yalnız yöneticiyle ve audit ile değişir',async()=>{
 const f=await fixture();await expect(ctx(f,()=>ayarlar.guncelle(modul,{surum:1,mod:'acik'}))).rejects.toMatchObject({status:403});
 await expect(modYaz(f,'bilinmeyen')).rejects.toMatchObject({status:400});await modYaz(f,'acik');expect(await tx(f,t=>t.auditLog.count({where:{islem:'ihtiyac_modu_guncellendi'}}))).toBe(1);
 await tx(f,t=>t.modulAyar.updateMany({where:{modul},data:{ayarlar:{surum:2,mod:'acik'}}}));await expect(tarihli(f)).rejects.toMatchObject({status:403});
});
it('şirket modu başka tenantın hesap veya yazma iznini değiştirmez',async()=>{
 const f=await fixture(),g=await fixture();await modYaz(f,'kapali');await expect(tarihli(f)).rejects.toMatchObject({status:403});expect((await tarihli(g)).erisim.yazabilir).toBe(true);expect(await ctx(g,async()=>planServisi.kaydet(await planGirdisi(g)))).toHaveProperty('id');
});
it('başlamış plan yazması bitmeden kapatma onaylanmaz; kapandıktan sonra yeni yazma engellenir',async()=>{
 const f=await fixture(),g=await planGirdisi(f);let gir!:()=>void,serbest!:()=>void;const girdi=new Promise<void>(r=>gir=r),bekle=new Promise<void>(r=>serbest=r);
 const yavas=new IhtiyacPlanService({tenantIslem:(id:string,fn:any,opts:any)=>p.tenantIslem(id,t=>fn(new Proxy(t,{get(target,key){if(key==='ihtiyacPlani')return new Proxy(t.ihtiyacPlani,{get(model,k){if(k==='create')return async(args:any)=>{gir();await bekle;return model.create(args);};return Reflect.get(model,k);}});return Reflect.get(target,key);}})),opts)} as never,s);
 const yaz=ctx(f,()=>yavas.kaydet(g));await girdi;let kapandi=false;const kapat=modYaz(f,'kapali').then(r=>{kapandi=true;return r;});
 try{await expect.poll(async()=>Number((await p.$queryRaw<{n:bigint}[]>`SELECT count(*) AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted`)[0].n),{timeout:5000}).toBe(1);expect(kapandi).toBe(false);}finally{serbest();await Promise.allSettled([yaz,kapat]);}
 expect(await yaz).toHaveProperty('id');await kapat;await expect(ctx(f,()=>planServisi.kaydet(g))).rejects.toMatchObject({status:403});
});
it('kapatma önce kilit almışsa eski repeatable-read ayarıyla bekleyen plan yazılamaz',async()=>{
 const f=await fixture(),g=await planGirdisi(f);let gir!:()=>void,serbest!:()=>void;const girdi=new Promise<void>(r=>gir=r),bekle=new Promise<void>(r=>serbest=r);
 const yavas=new AyarlarService({tenantIslem:(id:string,fn:any)=>p.tenantIslem(id,t=>fn(new Proxy(t,{get(target,key){if(key==='modulAyar')return new Proxy(t.modulAyar,{get(model,k){if(k==='upsert')return async(args:any)=>{gir();await bekle;return model.upsert(args);};return Reflect.get(model,k);}});return Reflect.get(target,key);}})))} as never);
 const kapat=ctx(f,()=>yavas.guncelle(modul,{surum:1,mod:'kapali'}),'yonetici');await girdi;
 const yaz=ctx(f,()=>planServisi.kaydet(g)).then(v=>({ok:true as const,v}),e=>({ok:false as const,e}));
 try{await expect.poll(async()=>Number((await p.$queryRaw<{n:bigint}[]>`SELECT count(*) AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted`)[0].n),{timeout:5000}).toBe(1);}finally{serbest();await Promise.allSettled([kapat,yaz]);}
 await kapat;const r=await yaz;expect(r.ok).toBe(false);if(!r.ok)expect([403,409],String(r.e)).toContain(r.e.status);expect(await tx(f,t=>t.ihtiyacPlani.count())).toBe(0);
});
it('mod değişiminin audit hatası modu da geri alır; şirket yanlışlıkla kapanmaz',async()=>{
 const f=await fixture();const hatali=new AyarlarService({tenantIslem:(id:string,fn:any)=>p.tenantIslem(id,t=>fn(new Proxy(t,{get(target,key){if(key==='auditLog')return {create:async()=>{throw Error('Mod audit arızası');}};return Reflect.get(target,key);}})))} as never);
 await expect(ctx(f,()=>hatali.guncelle(modul,{surum:1,mod:'kapali'}),'yonetici')).rejects.toThrow('Mod audit arızası');expect((await tarihli(f)).erisim).toMatchObject({mod:'pilot',yazabilir:true});
});
