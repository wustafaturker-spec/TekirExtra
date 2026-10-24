import 'reflect-metadata';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {beforeAll,afterAll,it,expect} from 'vitest';
const url=process.env.F01_YARIS_DB_URL,dist=process.env.F04_API_DIST,asama=process.env.F04_ILERI_ASAMA;
if(!url||!dist||!process.env.F01_YARIS_NONCE||!['once','sonra'].includes(asama??''))throw Error('Yalnız --f04-ileri-prova runner gerekli');
const u=new URL(url);if(u.hostname!=='127.0.0.1'||!/^\/f01_yaris_[a-f0-9]{16}$/.test(u.pathname)||u.username!=='tekir_app'||['5432','5433'].includes(u.port))throw Error('İzole ileri geçiş DB kapsamı geçersiz');
const req=createRequire(import.meta.url),load=(p:string)=>req(resolve(dist,p+'.js'));
load('ayar-tanimlari');
const {PrismaService}=load('core/prisma.service'),{baglamlaCalistir}=load('core/istek-baglami'),{IhtiyacService}=load('stok/ihtiyac.service'),{IhtiyacPlanService}=load('stok/ihtiyac-plan.service'),{IhtiyacUretimTalebiService}=load('stok/ihtiyac-uretim-talebi.service'),{SiparisGirisTarihiService}=load('stok/siparis-giris-tarihi.service'),{SatinAlmaService}=load('satin-alma/satin-alma.service'),{ButceService}=load('butce/butce.service'),{AyarlarService}=load('core/ayarlar/ayarlar.service');
const db=new PrismaService({datasourceUrl:url}),ihtiyac=new IhtiyacService(db),plan=new IhtiyacPlanService(db,ihtiyac),uretim=new IhtiyacUretimTalebiService(db),giris=new SiparisGirisTarihiService(db),satinAlma=new SatinAlmaService(db,new AyarlarService(db),{} as never,new ButceService(db),undefined,ihtiyac);
const evidence=resolve(process.env.F04_HTTP_EVIDENCE!),fixtureFile=resolve(evidence,'ileri-fixture.json');
let f:any;
const ctx=(fn:()=>Promise<any>)=>baglamlaCalistir({tenantId:f.tenantId,userId:f.userId,rol:'yonetici'},fn);
const tx=(fn:(t:any)=>Promise<any>)=>ctx(()=>db.tenantIslem(f.tenantId,fn));
const girdi=()=>({stokId:f.stokId,depoId:f.depoId,miktar:'10',birim:'adet',ihtiyacTarihi:'2099-01-01'});
beforeAll(async()=>{
 const [r]=await db.$queryRaw`SELECT current_setting('tekir.f01_yaris_nonce',true) AS nonce,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;expect(r).toEqual({nonce:process.env.F01_YARIS_NONCE,rolsuper:false,rolbypassrls:false});
 if(asama==='sonra'){f=JSON.parse(await readFile(fixtureFile,'utf8'));if(Object.values(f).some(v=>typeof v!=='string'||!/^[a-f0-9-]{36}$/.test(v)))throw Error('İleri geçiş fixture kimlikleri geçersiz');}
});
afterAll(()=>db.$disconnect());
if(asama==='once'){
 it('F04 tabloları yokken kısmi sipariş, çok depolu üretim rezervi ve eski satın alma taslağı oluşturulur',async()=>{
  expect(await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('siparis_giris_tarihleri','ihtiyac_uretim_talepleri','ihtiyac_planlari','ihtiyac_karsilama_baglari','ihtiyac_satin_alma_baglari')`).toEqual([]);
  const tenantId=randomUUID();
  f=await db.$transaction(async(t:any)=>{
   await t.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
   await t.tenant.create({data:{id:tenantId,vkn:tenantId,unvan:'F04 öncesi izole iş verisi'}});
   const user=await t.user.create({data:{tenantId,eposta:tenantId+'@test.invalid',parolaHash:'yalnız fixture',adSoyad:'Geçiş yöneticisi',rol:'yonetici'}});
   const stok=await t.stokKart.create({data:{tenantId,kod:'H1',ad:'Eski hammadde',tip:'urun',anaBirim:'adet'}}),mamul=await t.stokKart.create({data:{tenantId,kod:'M1',ad:'Eski mamul',tip:'urun',anaBirim:'adet'}});
   const depo=await t.depo.create({data:{tenantId,kod:'D1',ad:'Eski hammadde deposu'}}),diger=await t.depo.create({data:{tenantId,kod:'D2',ad:'İkinci depo'}});
   await t.stokDepoBakiye.createMany({data:[{tenantId,stokId:stok.id,depoId:depo.id,mevcutMiktar:'10',rezerveMiktar:'4',yoldakiMiktar:'5'},{tenantId,stokId:stok.id,depoId:diger.id,mevcutMiktar:'5',rezerveMiktar:'1'}]});
   const cari=await t.cariHesap.create({data:{tenantId,kod:'T1',unvan:'Eski tedarikçi',tip:'tedarikci'}});
   const belge=await t.belge.create({data:{tenantId,cariId:cari.id,depoId:depo.id,tur:'siparis',yon:'alis',durum:'kismen_kapandi',tarih:new Date('2026-10-22'),toplamBrut:0,toplamSatirIskontosu:0,genelIskontoToplam:0,toplamMatrah:0,toplamKdv:0,toplamTevkifat:0,toplamNetKdv:0,genelToplam:0}});
   const satir=await t.belgeSatir.create({data:{tenantId,belgeId:belge.id,stokId:stok.id,miktar:'8',teslimEdilenMiktar:'3',birim:'adet',birimFiyat:0,matrah:0,kdvTutari:0,netKdvTutari:0,toplamTutar:0}});
   const emir=await t.uretimEmri.create({data:{tenantId,no:'ESKI-UR1',stokId:mamul.id,hedefDepoId:diger.id,planlananMiktar:'1',tarih:new Date('2026-10-22'),durum:'malzeme_bekliyor'}});
   const kalem=await t.uretimEmriKalem.create({data:{tenantId,uretimEmriId:emir.id,malzemeStokId:stok.id,planlananMiktar:'8',sarfEdilenMiktar:'2'}});
   await t.uretimMalzemeRezervasyon.createMany({data:[{tenantId,uretimEmriKalemId:kalem.id,depoId:depo.id,rezerveMiktar:'4',sarfEdilenMiktar:'1',cozulenMiktar:'1'},{tenantId,uretimEmriKalemId:kalem.id,depoId:diger.id,rezerveMiktar:'1'}]});
   const talep=await t.satinAlmaTalebi.create({data:{tenantId,no:'ESKI-STL1',talepEdenUserId:user.id,ihtiyacTarihi:new Date('2099-01-01'),gerekce:'Geçiş öncesi normal taslak',butceAnahtari:'mal_alis',tahminiToplam:'20',kalemler:{create:[{tenantId,sira:0,stokId:stok.id,miktar:'2',birim:'adet',tahminiBirimFiyat:'10'}]}}});
   await t.satinAlmaTalepOlayi.create({data:{tenantId,talepId:talep.id,tur:'olusturuldu',userId:user.id}});
   return {tenantId,userId:user.id,stokId:stok.id,mamulId:mamul.id,depoId:depo.id,digerDepoId:diger.id,satirId:satir.id,belgeId:belge.id,emirId:emir.id,kalemId:kalem.id,legacyTalepId:talep.id};
  });
  expect((await ctx(()=>ihtiyac.onizle({...girdi(),miktar:'8'}))).hesap).toMatchObject({mevcut:'10.000',rezerve:'4.000',kullanilabilir:'6.000',eksik:'2.000'});
  await writeFile(fixtureFile,JSON.stringify(f,null,2)+'\n');
 });
}else{
 it('ilk migration eski kaynağa tarih, üretim ataması veya talep bağı uydurmaz; eski taslak hâlâ okunur',async()=>{
  for(const model of ['siparisGirisTarihi','ihtiyacUretimTalebi','ihtiyacPlani','ihtiyacKarsilamaBagi','ihtiyacSatinAlmaBagi'])expect(await tx((t:any)=>t[model].count())).toBe(0);
  expect(await ctx(()=>satinAlma.getir(f.legacyTalepId))).toMatchObject({id:f.legacyTalepId,durum:'taslak',yetkiler:{duzenle:true}});
  const satir=await tx((t:any)=>t.belgeSatir.findUnique({where:{id:f.satirId}}));expect(satir.teslimEdilenMiktar.toFixed(3)).toBe('3.000');
 });
 it('eski doğrulanmamış sipariş ve rezerv dışı üretim belirsiz kalır; plan saklama iyimser sonucu kabul etmez',async()=>{
  await expect(ctx(()=>ihtiyac.onizle(girdi(),true))).rejects.toMatchObject({status:403});
  await ctx(()=>new AyarlarService(db).guncelle('stok_ihtiyac_plani',{surum:1,mod:'pilot'}));
  const k=await ctx(()=>uretim.oku(f.kalemId));expect(k).toMatchObject({rezervDisi:'3.000',aktifRezerv:'3.000',atama:null});
  const sonuc=await ctx(()=>ihtiyac.onizle(girdi(),true));expect(sonuc.tarihli).toMatchObject({veriYeterli:false,durum:'dogrulanamadi'});expect(sonuc.tarihli.dislananlar).toHaveLength(2);
  await expect(ctx(()=>plan.kaydet({istekAnahtari:randomUUID(),beklenenSonucKaniti:sonuc.sonucKaniti,girdi:girdi()}))).rejects.toMatchObject({status:409});
 });
 it('eski kaynaklar açık kullanıcı teyidiyle yeni plan ve tek bağlı satın alma talebi oluşturabilir',async()=>{
  const kaynak=await ctx(()=>uretim.oku(f.kalemId));await ctx(()=>uretim.kaydet(f.kalemId,{depoId:f.depoId,ihtiyacTarihi:'2098-12-30',aktif:true,beklenenSurum:0,beklenenKaynakOzeti:kaynak.kaynakOzeti,gerekce:'Geçiş sonrası açık hammadde planı'}));
  const satir=await ctx(()=>giris.oku(f.satirId));expect(satir.kalanMiktar).toBe('5.000');await ctx(()=>giris.kaydet(f.satirId,{tarih:'2098-12-31',beklenenSurum:0,beklenenKaynakOzeti:satir.kaynakOzeti,gerekce:'Geçiş sonrası tedarikçi teyidi'}));
  const sonuc=await ctx(()=>ihtiyac.onizle(girdi(),true));expect(sonuc.tarihli).toMatchObject({veriYeterli:true,tarihliGiris:'5.000',ekTalep:'3.000',eksik:'2.000'});
  const p=await ctx(()=>plan.kaydet({istekAnahtari:randomUUID(),beklenenSonucKaniti:sonuc.sonucKaniti,girdi:girdi()}));
  const body={ihtiyacPlaniId:p.id,ihtiyacTarihi:'2099-01-01',gerekce:'Eski kaynaklı yeni plan talebi',butceAnahtari:'mal_alis',kalemler:[{stokId:f.stokId,miktar:'2.000',tahminiBirimFiyat:'10'}]};
  const a=await ctx(()=>satinAlma.olustur(body));expect(await ctx(()=>satinAlma.olustur(body))).toEqual(a);expect(await tx((t:any)=>t.ihtiyacSatinAlmaBagi.count())).toBe(1);expect(await tx((t:any)=>t.satinAlmaTalebi.count())).toBe(2);
  expect(await ctx(()=>satinAlma.getir(f.legacyTalepId))).toMatchObject({id:f.legacyTalepId,durum:'taslak',yetkiler:{duzenle:true}});
  const bakiye=await tx((t:any)=>t.stokDepoBakiye.findUnique({where:{tenantId_stokId_depoId:{tenantId:f.tenantId,stokId:f.stokId,depoId:f.depoId}}}));expect([bakiye.mevcutMiktar,bakiye.rezerveMiktar,bakiye.yoldakiMiktar].map(x=>x.toFixed(3))).toEqual(['10.000','4.000','5.000']);
  await writeFile(resolve(evidence,'ileri-yeni-akis.json'),JSON.stringify({durum:'gecti',eskiTaslakKorundu:true,kismiTeslimKalan:'5.000',rezervDisiUretim:'3.000',tarihliAcik:'2.000',tekBagliYeniTalep:true,stokBakiyesiDegismedi:true,otomatikTarihVeyaAtama:false,gercekSirketPilotu:false},null,2));
 });
}
