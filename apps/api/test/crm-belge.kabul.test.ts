import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeAll, afterAll, expect, it } from "vitest";
import type { Rol } from "@tekirextra/shared";
import { PrismaService } from "../src/core/prisma.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { CrmFirsatService } from "../src/crm/crm-firsat.service";
import { CrmBelgeService } from "../src/crm/crm-belge.service";
import { BelgelerService } from "../src/belgeler/belgeler.service";
import { DonemKilidiService } from "../src/donem-kapatma/donem-kilidi.service";
const belgeler=(p:PrismaService)=>new BelgelerService(p,undefined as never,undefined as never,new DonemKilidiService(p));
const url = process.env.F01_YARIS_DB_URL;
if (!url || !process.env.F01_YARIS_NONCE) throw Error("Yalnız geçici --f03 runner'ıyla çalıştırın");
const parsed = new URL(url);
if (parsed.hostname!=="127.0.0.1" || !/^\/f01_yaris_[a-f0-9]{16}$/.test(parsed.pathname) || parsed.username!=="tekir_app" || ["5432","5433"].includes(parsed.port)) throw Error("Geçici DB kapsamı geçersiz");
const totals={toplamBrut:'1200.25',toplamSatirIskontosu:'0',genelIskontoToplam:'0',toplamMatrah:'1200.25',toplamKdv:'0',toplamNetKdv:'0',genelToplam:'1200.25'};
const a=new PrismaService({datasourceUrl:url}),b=new PrismaService({datasourceUrl:url}),s=new CrmBelgeService(a,belgeler(a)),s2=new CrmBelgeService(b,belgeler(b));
beforeAll(async()=>{const [r]=await a.$queryRaw<any[]>`SELECT current_database() AS db,current_setting('tekir.f01_yaris_nonce',true) AS marker,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;expect(r).toEqual({db:parsed.pathname.slice(1),marker:process.env.F01_YARIS_NONCE,rolsuper:false,rolbypassrls:false});const [rls]=await a.$queryRaw<any[]>`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='firsat_belge_baglari'`;expect(rls).toEqual({relrowsecurity:true,relforcerowsecurity:true});});
afterAll(async()=>{await Promise.all([a.$disconnect(),b.$disconnect()]);});
async function fixture(mod: string | null="pilot") {
 const tenantId=randomUUID();return a.$transaction(async t=>{await t.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
  await t.tenant.create({data:{id:tenantId,vkn:tenantId,unvan:"F03 geçici kabul"}});
  const u=await t.user.create({data:{tenantId,eposta:tenantId+'@test.invalid',parolaHash:'test',adSoyad:'Satış',rol:'satis'}});
  const c=await t.cariHesap.create({data:{tenantId,kod:'C',unvan:'F03 cari',tip:'musteri'}});
  const f=await t.crmFirsat.create({data:{tenantId,cariId:c.id,baslik:'Satış fırsatı',tahminiTutar:'9000'}});
  const d=await t.belge.create({data:{tenantId,cariId:c.id,...totals,tur:'teklif',yon:'satis',durum:'onaylandi',no:'TEK-1',tarih:new Date('2026-10-17'),dovizCinsi:'USD',genelToplam:'1200.25'}});
  if(mod)await t.modulAyar.create({data:{tenantId,modul:'crm_belge_baglari',ayarlar:{surum:1,mod}}});
  return {tenantId,userId:u.id,cariId:c.id,firsatId:f.id,belgeId:d.id,firsatZamani:f.updatedAt.toISOString(),belgeZamani:d.updatedAt.toISOString()};
 });
}
type F=Awaited<ReturnType<typeof fixture>>;
const ctx=<T>(f:F,work:()=>Promise<T>,rol:Rol='satis')=>baglamlaCalistir({...f,rol},work);
const tx=<T>(f:F,work:(t:Prisma.TransactionClient)=>Promise<T>)=>ctx(f,()=>a.tenantIslem(f.tenantId,work));
const body=(f:F)=>({belgeId:f.belgeId,istekAnahtari:randomUUID(),gerekce:'Müşterinin teklif talebi',beklenenFirsatZamani:f.firsatZamani,beklenenBelgeZamani:f.belgeZamani});
const add=(f:F,g=body(f))=>ctx(f,()=>s.bagla(f.firsatId,g));
const closeBody=()=>({istekAnahtari:randomUUID(),beklenenSurum:1,gerekce:'Yanlış fırsat seçildi'});
const resources=(f:F)=>tx(f,async t=>JSON.stringify([await t.belge.findMany(),await t.crmFirsat.findMany(),await t.fatura.findMany(),await t.cariHareket.findMany(),await t.kasaBankaHareket.findMany()]));
it('varsayılan kapalıdır; salt okunur liste açık, yazma kapalıdır',async()=>{const f=await fixture(null);await expect(ctx(f,()=>s.listele(f.firsatId))).rejects.toMatchObject({status:403});await tx(f,t=>t.modulAyar.create({data:{tenantId:f.tenantId,modul:'crm_belge_baglari',ayarlar:{surum:1,mod:'salt_okunur'}}}));expect((await ctx(f,()=>s.listele(f.firsatId))).mod).toBe('salt_okunur');await expect(add(f)).rejects.toMatchObject({status:403});});
it('bağlama tekrarında tek bağ/audit oluşur; kaynak ve finans kayıtları değişmez',async()=>{const f=await fixture(),g=body(f),before=await resources(f),link=await add(f,g);expect(await add(f,g)).toEqual(link);expect(await resources(f)).toBe(before);expect(await tx(f,t=>t.firsatBelgeBagi.count())).toBe(1);expect(await tx(f,t=>t.auditLog.count({where:{islem:'firsat_teklif_baglandi'}}))).toBe(1);const list=await ctx(f,()=>s.listele(f.firsatId));expect(list.baglar[0].belge).toMatchObject({genelToplam:'1200.25',dovizCinsi:'USD'});expect(JSON.stringify(list)).not.toMatch(/maliyet|parolaHash|tahminiTutar/);});
it('iki fırsat ve iki bağlantı aynı teklifi eşzamanlı bağlayamaz',async()=>{const f=await fixture(),f2=await tx(f,t=>t.crmFirsat.create({data:{tenantId:f.tenantId,cariId:f.cariId,baslik:'İkinci fırsat',tahminiTutar:'3000'}})),g=body(f);const results=await Promise.allSettled([add(f,g),ctx(f,()=>s2.bagla(f2.id,{...g,istekAnahtari:randomUUID(),beklenenFirsatZamani:f2.updatedAt.toISOString()}))]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.status).toBe(409);expect(await tx(f,t=>t.firsatBelgeBagi.count({where:{cozulduAt:null}}))).toBe(1);});
it('aynı istek iki bağlantıda tek kayıt üretir; anahtar/gövde çakışması reddedilir',async()=>{const f=await fixture(),g=body(f);const [x,y]=await Promise.all([add(f,g),ctx(f,()=>s2.bagla(f.firsatId,g))]);expect(x).toEqual(y);await expect(add(f,{...g,gerekce:'Değişen gerekçe'})).rejects.toMatchObject({status:409});});
it('başka cari, tenant, alış ve sipariş bağlanamaz; eski kaynak zamanı 409 olur',async()=>{const f=await fixture(),foreign=await fixture();await expect(add(f,{...body(f),belgeId:foreign.belgeId})).rejects.toMatchObject({status:404});const c=await tx(f,t=>t.cariHesap.create({data:{tenantId:f.tenantId,kod:'C2',unvan:'Başka cari',tip:'musteri'}}));for(const data of [{cariId:c.id},{yon:'alis' as const},{tur:'siparis' as const}]){await tx(f,t=>t.belge.update({where:{id:f.belgeId},data}));await expect(add(f)).rejects.toMatchObject({status:404});await tx(f,t=>t.belge.update({where:{id:f.belgeId},data:{cariId:f.cariId,yon:'satis',tur:'teklif'}}));}await expect(add(f)).rejects.toMatchObject({status:409});await expect(ctx(f,()=>s.listele(foreign.firsatId))).rejects.toMatchObject({status:404});});
it('güncellenmiş fırsat veya iptal/eski sürüm teklif bağlanamaz',async()=>{const f=await fixture();await tx(f,t=>t.crmFirsat.update({where:{id:f.firsatId},data:{baslik:'Değişen başlık'}}));await expect(add(f)).rejects.toMatchObject({status:409});for(const durum of ['iptal','revize_edildi'] as const){const b=await tx(f,t=>t.belge.update({where:{id:f.belgeId},data:{durum}}));const current=await tx(f,t=>t.crmFirsat.findUniqueOrThrow({where:{id:f.firsatId}}));await expect(add(f,{...body(f),beklenenFirsatZamani:current.updatedAt.toISOString(),beklenenBelgeZamani:b.updatedAt.toISOString()})).rejects.toMatchObject({status:409});}});
it('çözme geçmişi korur, tekrarı tek audit üretir; yeni bağ eskiyi yeniden açmaz',async()=>{const f=await fixture(),g=body(f),before=await resources(f),link=await add(f,g),c=closeBody();const closed=await ctx(f,()=>s.coz(f.firsatId,link.id,c));expect(closed.surum).toBe(2);expect(await ctx(f,()=>s.coz(f.firsatId,link.id,c))).toEqual(closed);await expect(ctx(f,()=>s.coz(f.firsatId,link.id,{...c,gerekce:'Başka neden'}))).rejects.toMatchObject({status:409});expect((await add(f,g)).cozulduAt).not.toBeNull();const next=await add(f);expect(next.id).not.toBe(link.id);expect((await ctx(f,()=>s.listele(f.firsatId))).baglar).toHaveLength(2);expect(await resources(f)).toBe(before);expect(await tx(f,t=>t.auditLog.count({where:{islem:'firsat_teklif_bagi_cozuldu'}}))).toBe(1);});
it('veritabanı kapsamı, kimlik değişmezliği, kaynak silme ve RLS korunur',async()=>{const f=await fixture(),foreign=await fixture(),link=await add(f),row=await tx(f,t=>t.firsatBelgeBagi.findUniqueOrThrow({where:{id:link.id}}));await expect(tx(f,t=>t.firsatBelgeBagi.update({where:{id:link.id},data:{gerekce:'Değiştir'}}))).rejects.toThrow();await expect(tx(f,t=>t.firsatBelgeBagi.delete({where:{id:link.id}}))).rejects.toThrow();await expect(tx(f,t=>t.belge.delete({where:{id:f.belgeId}}))).rejects.toThrow();await expect(tx(f,t=>t.crmFirsat.update({where:{id:f.firsatId},data:{cariId:foreign.cariId}}))).rejects.toThrow();expect(await tx(foreign,t=>t.firsatBelgeBagi.findMany({where:{id:link.id}}))).toEqual([]);await expect(tx(f,t=>t.firsatBelgeBagi.create({data:{tenantId:f.tenantId,cariId:f.cariId,firsatId:f.firsatId,belgeId:foreign.belgeId,olusturanUserId:f.userId,gerekce:'Doğrudan SQL kapsamı',istekAnahtari:randomUUID(),girdiOzeti:row.girdiOzeti}}))).rejects.toThrow();});
it('muhasebe yalnız okur; kapalı mod ve pasif sorumlu yazamaz',async()=>{const f=await fixture();expect((await ctx(f,()=>s.listele(f.firsatId),'muhasebe')).baglar).toEqual([]);await expect(ctx(f,()=>s.bagla(f.firsatId,body(f)),'muhasebe')).rejects.toMatchObject({status:403});await expect(ctx(f,()=>s.listele(f.firsatId),'depo')).rejects.toMatchObject({status:403});await tx(f,t=>t.user.update({where:{id:f.userId},data:{aktif:false}}));await expect(add(f)).rejects.toMatchObject({status:403});});
it('audit hatasında ilişki de geri alınır',async()=>{const f=await fixture();const adapter={tenantIslem:(tenantId:string,work:(t:Prisma.TransactionClient)=>Promise<unknown>)=>a.tenantIslem(tenantId,t=>work(new Proxy(t,{get(target,key){return key==='auditLog'?{create:async()=>{throw Error('Sentetik audit hatası');}}:Reflect.get(target,key);}})))};await expect(ctx(f,()=>new CrmBelgeService(adapter as unknown as PrismaService,belgeler(a)).bagla(f.firsatId,body(f)))).rejects.toThrow('Sentetik audit');expect(await tx(f,t=>t.firsatBelgeBagi.count())).toBe(0);});
it('adaylar cari/tür/sürüm kapsamında sayfalanır; bağlı teklif seçilemez',async()=>{const f=await fixture();await add(f);await tx(f,async t=>{for(let i=0;i<51;i++)await t.belge.create({data:{tenantId:f.tenantId,cariId:f.cariId,...totals,tur:'teklif',yon:'satis',no:'TEK-EK-'+i,tarih:new Date('2026-10-17')}});});const first=await ctx(f,()=>s.adaylar(f.firsatId,{arama:'TEK'}));expect(first.kayitlar).toHaveLength(50);expect(first.sonrakiImlec).not.toBeNull();const last=await ctx(f,()=>s.adaylar(f.firsatId,{arama:'TEK',imlec:first.sonrakiImlec}));expect(last.kayitlar).toHaveLength(2);const all=[...first.kayitlar,...last.kayitlar];expect(new Set(all.map(b=>b.id)).size).toBe(52);expect(all.find(b=>b.id===f.belgeId)?.bagli).toBe(true);await expect(ctx(f,()=>s.adaylar(f.firsatId,{imlec:randomUUID()}))).rejects.toMatchObject({status:409});});

it('fırsat cari düzeltmesi yabancı şirketi ve bağ geçmişini reddeder',async()=>{const f=await fixture(),foreign=await fixture(),service=new CrmFirsatService(a);await expect(ctx(f,()=>service.guncelle(f.tenantId,f.firsatId,{cariId:foreign.cariId}))).rejects.toMatchObject({status:404});const c=await tx(f,t=>t.cariHesap.create({data:{tenantId:f.tenantId,kod:'C-YENI',unvan:'Aynı şirket yeni cari',tip:'musteri'}}));await add(f);await expect(ctx(f,()=>service.guncelle(f.tenantId,f.firsatId,{cariId:c.id}))).rejects.toMatchObject({status:409});});

async function zincirBelgesi(f:F,tur:'siparis'|'irsaliye',kaynakBelgeId:string,extra:Partial<Prisma.BelgeUncheckedCreateInput>={}) {
 return tx(f,t=>t.belge.create({data:{tenantId:f.tenantId,cariId:f.cariId,...totals,tur,yon:'satis',tarih:new Date('2026-10-17'),kaynakBelgeId,...extra}}));
}
it('aktif tekliften iki kısmi irsaliyeye ulaşır; finans ve fırsat kayıtlarına yazmaz',async()=>{
 const f=await fixture();await add(f);
 const order=await zincirBelgesi(f,'siparis',f.belgeId),d1=await zincirBelgesi(f,'irsaliye',order.id),d2=await zincirBelgesi(f,'irsaliye',order.id,{durum:'iptal'});
 const before=await resources(f),list=await ctx(f,()=>s.listele(f.firsatId));
 expect(new Set(list.zincir.belgeler.map(b=>b.id))).toEqual(new Set([order.id,d1.id,d2.id]));
 expect(list.zincir.belgeler.find(b=>b.id===d2.id)?.durum).toBe('iptal');
 expect(JSON.stringify(list.zincir)).not.toMatch(/genelToplam|tahminiTutar|maliyet|tahsilat/);
 expect(await resources(f)).toBe(before);
});
it('ortak fatura tek gösterilir; fırsat dışı kaynak bilgisi yalnız işaret olarak döner',async()=>{
 const f=await fixture();await add(f);
 const invoice=await tx(f,t=>t.fatura.create({data:{tenantId:f.tenantId,cariId:f.cariId,...totals,toplamTevkifat:'0',tip:'satis',tarih:new Date('2026-10-17'),no:'FAT-ORTAK'}}));
 const o=await zincirBelgesi(f,'siparis',f.belgeId),d1=await zincirBelgesi(f,'irsaliye',o.id,{faturaId:invoice.id}),d2=await zincirBelgesi(f,'irsaliye',o.id,{faturaId:invoice.id});
 const outside=await zincirBelgesi(f,'siparis',f.belgeId,{kaynakBelgeId:null,faturaId:invoice.id,no:'GIZLI-DIGER-KAYNAK'});
 const list=await ctx(f,()=>s.listele(f.firsatId));
 expect(list.zincir.faturalar).toHaveLength(1);expect(list.zincir.faturalar[0]).toMatchObject({id:invoice.id,ortakKaynak:true});
 expect(new Set(list.zincir.faturalar[0].kaynakBelgeIds)).toEqual(new Set([d1.id,d2.id]));
 expect(JSON.stringify(list.zincir)).not.toContain(outside.id);expect(JSON.stringify(list.zincir)).not.toContain('GIZLI-DIGER-KAYNAK');
 await tx(f,t=>t.belge.update({where:{id:outside.id},data:{faturaId:null}}));
 expect((await ctx(f,()=>s.listele(f.firsatId))).zincir.faturalar[0].ortakKaynak).toBe(false);
});
it('çözülmüş bağın zinciri aktif görünümden kalkar; aynı carinin ilgisiz belgeleri alınmaz',async()=>{
 const f=await fixture(),link=await add(f);await zincirBelgesi(f,'siparis',f.belgeId);
 await zincirBelgesi(f,'siparis',f.belgeId,{kaynakBelgeId:null});
 await ctx(f,()=>s.coz(f.firsatId,link.id,closeBody()));
 const list=await ctx(f,()=>s.listele(f.firsatId));expect(list.baglar).toHaveLength(1);expect(list.zincir).toEqual({belgeler:[],faturalar:[]});
});
it('kaynak kimliği eşleşse de başka tenant, cari veya alış belgesi zincire sızmaz',async()=>{
 const f=await fixture(),other=await fixture();await add(f);
 await zincirBelgesi(other,'siparis',f.belgeId);
 const c=await tx(f,t=>t.cariHesap.create({data:{tenantId:f.tenantId,kod:'Z2',unvan:'Başka cari',tip:'musteri'}}));
 await zincirBelgesi(f,'siparis',f.belgeId,{cariId:c.id});await zincirBelgesi(f,'siparis',f.belgeId,{yon:'alis'});
 expect((await ctx(f,()=>s.listele(f.firsatId))).zincir).toEqual({belgeler:[],faturalar:[]});
});
it('büyük zincirde eksik sonuç yerine açık çatışma döner',async()=>{
 const f=await fixture();await add(f);await tx(f,t=>t.belge.createMany({data:Array.from({length:1001},()=>({tenantId:f.tenantId,cariId:f.cariId,...totals,tur:'siparis' as const,yon:'satis' as const,tarih:new Date('2026-10-17'),kaynakBelgeId:f.belgeId}))}));
 await expect(ctx(f,()=>s.listele(f.firsatId))).rejects.toMatchObject({status:409});
});

async function yeniTeklif(f:F) {
 const stok=await tx(f,t=>t.stokKart.create({data:{tenantId:f.tenantId,kod:randomUUID(),ad:'F03 hizmet',tip:'hizmet'}}));
 return {istekAnahtari:randomUUID(),gerekce:'Fırsatın yeni teklifi',beklenenFirsatZamani:f.firsatZamani,belge:{tur:'teklif',yon:'satis',cariId:f.cariId,tarih:'2026-10-17',dovizCinsi:'TRY',kur:'1',satirlar:[{stokId:stok.id,miktar:'2',birimFiyat:'500',iskontoOrani:'10',kdvOrani:'20'}]}};
}
it('fırsattan teklif gerçek hesaplama servisiyle taslak ve bağlı oluşur; tekrarında tek belge/satır/audit kalır',async()=>{
 const f=await fixture(),g=await yeniTeklif(f),result=await ctx(f,()=>s.teklifOlustur(f.firsatId,g));
 expect(await ctx(f,()=>s.teklifOlustur(f.firsatId,g))).toEqual(result);
 const data=await tx(f,async t=>({doc:await t.belge.findUniqueOrThrow({where:{id:result.id},include:{satirlar:true}}),link:await t.firsatBelgeBagi.findUniqueOrThrow({where:{id:result.bagId}}),audit:await t.auditLog.count({where:{islem:'firsattan_teklif_olusturuldu'}}),invoices:await t.fatura.count(),moves:await t.cariHareket.count(),docs:await t.belge.count()}));
 expect(data.doc.durum).toBe('taslak');expect(data.doc.genelToplam.toFixed(2)).toBe('1080.00');expect(data.doc.satirlar).toHaveLength(1);expect(data.doc.satirlar[0].miktar.toString()).toBe('2');expect(data.link.belgeId).toBe(result.id);expect(data.audit).toBe(1);expect(data.docs).toBe(2);expect(data.invoices).toBe(0);expect(data.moves).toBe(0);
 await ctx(f,()=>s.coz(f.firsatId,result.bagId,closeBody()));
 const replay=await ctx(f,()=>s.teklifOlustur(f.firsatId,g));expect(replay.id).toBe(result.id);expect(replay.cozulduAt).not.toBeNull();
});
it('iki eşzamanlı aynı oluşturma isteği tek taslak ve tek bağ döndürür',async()=>{
 const f=await fixture(),g=await yeniTeklif(f);const [x,y]=await Promise.all([ctx(f,()=>s.teklifOlustur(f.firsatId,g)),ctx(f,()=>s2.teklifOlustur(f.firsatId,g))]);expect(x).toEqual(y);expect(await tx(f,t=>t.belge.count())).toBe(2);
 await expect(ctx(f,()=>s.teklifOlustur(f.firsatId,{...g,gerekce:'Başka gerekçe'}))).rejects.toMatchObject({status:409});
});
it('eski fırsat, farklı cari/tenant ve yanlış belge türü oluşturma yazmadan reddedilir',async()=>{
 const f=await fixture(),other=await fixture(),g=await yeniTeklif(f);
 await expect(ctx(f,()=>s.teklifOlustur(other.firsatId,g))).rejects.toMatchObject({status:404});
 await expect(ctx(f,()=>s.teklifOlustur(f.firsatId,{...g,belge:{...g.belge,cariId:other.cariId}}))).rejects.toMatchObject({status:409});
 for(const change of [{tur:'siparis'},{yon:'alis'},{faturaId:randomUUID()}])await expect(ctx(f,()=>s.teklifOlustur(f.firsatId,{...g,belge:{...g.belge,...change}}))).rejects.toMatchObject({status:400});
 await tx(f,t=>t.crmFirsat.update({where:{id:f.firsatId},data:{baslik:'Yeni başlık'}}));await expect(ctx(f,()=>s.teklifOlustur(f.firsatId,g))).rejects.toMatchObject({status:409});expect(await tx(f,t=>t.belge.count())).toBe(1);
});
it('oluşturmada muhasebe, salt okunur/kapalı mod ve pasif kullanıcı yazamaz',async()=>{
 const f=await fixture(),g=await yeniTeklif(f);await expect(ctx(f,()=>s.teklifOlustur(f.firsatId,g),'muhasebe')).rejects.toMatchObject({status:403});
 for(const mod of ['salt_okunur','kapali']){await tx(f,t=>t.modulAyar.update({where:{tenantId_modul:{tenantId:f.tenantId,modul:'crm_belge_baglari'}},data:{ayarlar:{surum:1,mod}}}));await expect(ctx(f,()=>s.teklifOlustur(f.firsatId,g))).rejects.toMatchObject({status:403});}
 await tx(f,t=>t.modulAyar.update({where:{tenantId_modul:{tenantId:f.tenantId,modul:'crm_belge_baglari'}},data:{ayarlar:{surum:1,mod:'pilot'}}}));await tx(f,t=>t.user.update({where:{id:f.userId},data:{aktif:false}}));await expect(ctx(f,()=>s.teklifOlustur(f.firsatId,g))).rejects.toMatchObject({status:403});
 expect(await tx(f,t=>t.belge.count())).toBe(1);
});
it('oluşturma audit hatasında teklif ve satırları da geri alır',async()=>{
 const f=await fixture(),g=await yeniTeklif(f);
 const adapter={tenantIslem:(tenantId:string,work:(t:Prisma.TransactionClient)=>Promise<unknown>)=>a.tenantIslem(tenantId,t=>work(new Proxy(t,{get(target,key){return key==='auditLog'?{create:async()=>{throw Error('Oluşturma audit hatası');}}:Reflect.get(target,key);}})))};
 const service=new CrmBelgeService(adapter as unknown as PrismaService,belgeler(a));
 await expect(ctx(f,()=>service.teklifOlustur(f.firsatId,g))).rejects.toThrow('Oluşturma audit hatası');expect(await tx(f,t=>t.belge.count())).toBe(1);expect(await tx(f,t=>t.belgeSatir.count())).toBe(0);expect(await tx(f,t=>t.firsatBelgeBagi.count())).toBe(0);
});
it('mevcut cari blokajı, ürün/birim ve iskonto denetimi oluşturma yolunda korunur',async()=>{
 const f=await fixture(),g=await yeniTeklif(f);
 await tx(f,t=>t.cariHesap.update({where:{id:f.cariId},data:{karaListe:true}}));await expect(ctx(f,()=>s.teklifOlustur(f.firsatId,g))).rejects.toMatchObject({status:400});
 await tx(f,t=>t.cariHesap.update({where:{id:f.cariId},data:{karaListe:false}}));
 await tx(f,t=>t.user.update({where:{id:f.userId},data:{maksIskontoYuzdesi:'5'}}));await expect(ctx(f,()=>s.teklifOlustur(f.firsatId,g))).rejects.toMatchObject({status:400});
 await tx(f,t=>t.user.update({where:{id:f.userId},data:{maksIskontoYuzdesi:null}}));
 await expect(ctx(f,()=>s.teklifOlustur(f.firsatId,{...g,belge:{...g.belge,satirlar:[{...g.belge.satirlar[0],birim:'gecersiz_birim'}]}}))).rejects.toMatchObject({status:400});
 expect(await tx(f,t=>t.belge.count())).toBe(1);expect(await tx(f,t=>t.belgeSatir.count())).toBe(0);
});
it('kapalı mali dönem yeni teklifi engeller; önceden tamamlanmış isteğin tekrarı yeni yazım yapmaz',async()=>{
 const f=await fixture(),g=await yeniTeklif(f),result=await ctx(f,()=>s.teklifOlustur(f.firsatId,g));
 await tx(f,t=>t.maliDonem.create({data:{tenantId:f.tenantId,yil:2026,ay:10,durum:'kapali'}}));
 expect(await ctx(f,()=>s.teklifOlustur(f.firsatId,g))).toEqual(result);
 await expect(ctx(f,()=>s.teklifOlustur(f.firsatId,{...g,istekAnahtari:randomUUID()}))).rejects.toMatchObject({status:409});
 expect(await tx(f,t=>t.belge.count())).toBe(2);
});

async function kanitliFatura(f:F) {
 const g=await yeniTeklif(f);g.belge.satirlar[0]={...g.belge.satirlar[0],miktar:'1',birimFiyat:'100.10',iskontoOrani:'0',kdvOrani:'0'};
 const quote=await ctx(f,()=>s.teklifOlustur(f.firsatId,g));
 await tx(f,t=>t.belge.update({where:{id:quote.id},data:{durum:'onaylandi'}}));
 const order=await ctx(f,()=>belgeler(a).donustur(quote.id,'siparis'));
 if(!('belgeId' in order))throw Error('Sipariş oluşmadı');
 await tx(f,t=>t.belge.update({where:{id:order.belgeId},data:{durum:'onaylandi'}}));
 const invoice=await ctx(f,()=>belgeler(a).donustur(order.belgeId!,'fatura'));
 if(!('faturaId' in invoice))throw Error('Fatura oluşmadı');
 await tx(f,t=>t.fatura.update({where:{id:invoice.faturaId},data:{durum:'kesin'}}));
 return {quoteId:quote.id,orderId:order.belgeId!,invoiceId:invoice.faturaId!};
}
const sonuc=(f:F,id:string)=>ctx(f,async()=>{const l=await s.listele(f.firsatId);return l.ticariSonuc.find(r=>r.id===id)!;});
async function referansliIade(f:F,invoiceId:string,matrah='20.05',kdv='4.01'){
 return tx(f,async t=>{
  const source=await t.faturaSatir.findFirstOrThrow({where:{faturaId:invoiceId}});
  const total=new Prisma.Decimal(matrah).add(kdv).toFixed(2);
  const iade=await t.fatura.create({data:{tenantId:f.tenantId,cariId:f.cariId,...totals,toplamMatrah:matrah,toplamKdv:kdv,toplamNetKdv:kdv,genelToplam:total,toplamTevkifat:'0',tip:'satis_iade',durum:'kesin',tarih:new Date('2026-10-18'),dovizCinsi:'TRY'}});
  await t.faturaSatir.create({data:{tenantId:f.tenantId,faturaId:iade.id,stokId:source.stokId,miktar:'1',birimFiyat:matrah,matrah,toplamTutar:total,kdvTutari:kdv,netKdvTutari:kdv}});
  await t.faturaIadeReferansi.create({data:{tenantId:f.tenantId,faturaId:iade.id,kaynakFaturaId:invoiceId,sira:1,belgeNo:'SAT2026000000001',tarih:new Date('2026-10-17')}});
  return iade;
 });
}
it('tek kaynaklı ticari iade kapama gerektirmeden KDV hariç sonucu azaltır; iptal ve taslak sonucu geri getirir',async()=>{
 const f=await fixture(),k=await kanitliFatura(f);
 expect((await sonuc(f,k.invoiceId)).netSatis).toMatchObject({durum:'referans_kapsaminda',satisMatrahi:'100.10',iadeMatrahi:'0.00',netMatrah:'100.10'});
 const i=await referansliIade(f,k.invoiceId),before=await resources(f);
 expect((await sonuc(f,k.invoiceId)).netSatis).toMatchObject({durum:'referans_kapsaminda',satisMatrahi:'100.10',iadeMatrahi:'20.05',netMatrah:'80.05'});
 expect((await sonuc(f,k.invoiceId)).kapama.iade).toBe('0.00');expect(await resources(f)).toBe(before);
 for(const durum of ['iptal','taslak'] as const){await tx(f,t=>t.fatura.update({where:{id:i.id},data:{durum}}));expect((await sonuc(f,k.invoiceId)).netSatis.netMatrah).toBe('100.10');}
});
it('çok kaynaklı iade, farklı döviz ve tutarsız iade satırında net satış bilinmez kalır',async()=>{
 const f=await fixture(),k=await kanitliFatura(f),second=await kanitliFatura(f),i=await referansliIade(f,k.invoiceId);
 const ref=await tx(f,t=>t.faturaIadeReferansi.create({data:{tenantId:f.tenantId,faturaId:i.id,kaynakFaturaId:second.invoiceId,sira:2,belgeNo:'SAT2026000000002',tarih:new Date('2026-10-17')}}));
 expect((await sonuc(f,k.invoiceId)).netSatis).toMatchObject({durum:'dagitilamadi',netMatrah:null});
 await tx(f,t=>t.faturaIadeReferansi.delete({where:{id:ref.id}}));
 await tx(f,t=>t.fatura.update({where:{id:i.id},data:{dovizCinsi:'USD'}}));expect((await sonuc(f,k.invoiceId)).netSatis.netMatrah).toBeNull();
 await tx(f,t=>t.fatura.update({where:{id:i.id},data:{dovizCinsi:'TRY'}}));
 await tx(f,t=>t.faturaSatir.updateMany({where:{faturaId:i.id},data:{matrah:'19.99'}}));expect((await sonuc(f,k.invoiceId)).netSatis).toMatchObject({neden:'iade_tutarlari_tutarsiz',netMatrah:null});
});
it('karma sahiplik, referanssız iade kapaması ve satıştan fazla iade net tutara dönüşmez',async()=>{
 const {f,invoiceId}=await acikDagitim();expect((await sonuc(f,invoiceId)).netSatis).toMatchObject({neden:'tam_fatura_sahipligi_yok',netMatrah:null});
 const own=await fixture(),k=await kanitliFatura(own),i=await referansliIade(own,k.invoiceId);
 await tx(own,t=>t.faturaIadeReferansi.deleteMany({where:{faturaId:i.id}}));
 await tx(own,t=>t.faturaKapama.create({data:{tenantId:own.tenantId,cariId:own.cariId,faturaId:k.invoiceId,iadeFaturaId:i.id,tutar:'5'}}));
 expect((await sonuc(own,k.invoiceId)).netSatis).toMatchObject({neden:'kapama_iadesinin_referansi_dogrulanamadi',netMatrah:null});
 await tx(own,t=>t.faturaKapama.deleteMany({where:{faturaId:k.invoiceId}}));await referansliIade(own,k.invoiceId,'101.00','0');
 expect((await sonuc(own,k.invoiceId)).netSatis).toMatchObject({neden:'iade_satis_matrahini_asiyor',netMatrah:null});
});
it('birden fazla iade tam ondalıkla toplanır; başka cari ve tutarsız satış matrahı gizlenir',async()=>{
 const f=await fixture(),k=await kanitliFatura(f);await referansliIade(f,k.invoiceId,'0.01','0');const i=await referansliIade(f,k.invoiceId,'0.02','0');
 expect((await sonuc(f,k.invoiceId)).netSatis).toMatchObject({iadeMatrahi:'0.03',netMatrah:'100.07'});
 const c=await tx(f,t=>t.cariHesap.create({data:{tenantId:f.tenantId,kod:'IADE-BASKA',unvan:'Başka cari',tip:'musteri'}}));
 await tx(f,t=>t.fatura.update({where:{id:i.id},data:{cariId:c.id}}));expect((await sonuc(f,k.invoiceId)).netSatis).toMatchObject({neden:'iade_referansi_belirsiz',netMatrah:null});
 await tx(f,t=>t.fatura.update({where:{id:i.id},data:{cariId:f.cariId}}));
 await tx(f,t=>t.fatura.update({where:{id:k.invoiceId},data:{toplamMatrah:'99.99'}}));expect((await sonuc(f,k.invoiceId)).netSatis).toMatchObject({neden:'satis_matrahi_tutarsiz',netMatrah:null});
});
it('gerçek belge dönüşümü satır kaynağını saklar; kesin fatura payı ondalık olarak hesaplanır',async()=>{
 const f=await fixture(),k=await kanitliFatura(f),before=await resources(f);
 const row=await tx(f,t=>t.faturaSatir.findFirstOrThrow({where:{faturaId:k.invoiceId}}));expect(row.kaynakBelgeSatirId).not.toBeNull();
 expect(await sonuc(f,k.invoiceId)).toMatchObject({faturaPayi:'100.10',payKapsami:'tam',dovizCinsi:'TRY',kapama:{durum:'tam',kasaBanka:'0.00',iade:'0.00',kalan:'100.10'}});
 expect(await resources(f)).toBe(before);expect(JSON.stringify(await sonuc(f,k.invoiceId))).not.toMatch(/maliyet|tahminiTutar|parola/);
 for(const durum of ['taslak','iptal'] as const){await tx(f,t=>t.fatura.update({where:{id:k.invoiceId},data:{durum}}));expect(await sonuc(f,k.invoiceId)).toMatchObject({faturaPayi:null,payKapsami:'kesin_degil',kapama:{durum:'dagitilamadi'}});}
});
it('kaynak kanıtı olmayan eski satır ve kırılmış sipariş satırı dağıtılamadı kalır',async()=>{
 const f=await fixture(),k=await kanitliFatura(f),row=await tx(f,t=>t.faturaSatir.findFirstOrThrow({where:{faturaId:k.invoiceId}}));
 await tx(f,t=>t.faturaSatir.update({where:{id:row.id},data:{kaynakBelgeSatirId:null}}));expect(await sonuc(f,k.invoiceId)).toMatchObject({faturaPayi:null,payKapsami:'dagitilamadi'});
 await tx(f,t=>t.faturaSatir.update({where:{id:row.id},data:{kaynakBelgeSatirId:row.kaynakBelgeSatirId}}));
 await tx(f,t=>t.belgeSatir.updateMany({where:{belgeId:k.orderId},data:{kaynakSatirId:null}}));expect((await sonuc(f,k.invoiceId)).faturaPayi).toBeNull();
});
it('karma faturada yalnız kanıtlı satır tutarı görünür; bütün kapama iki fırsata dağıtılmaz',async()=>{
 const f=await fixture(),k=await kanitliFatura(f),row=await tx(f,t=>t.faturaSatir.findFirstOrThrow({where:{faturaId:k.invoiceId}}));
 await tx(f,async t=>{const {id,...data}=row;await t.faturaSatir.create({data:{...data,kaynakBelgeSatirId:null,toplamTutar:'200.20',partiBilgileri:undefined,ekVergiler:undefined}});await t.fatura.update({where:{id:k.invoiceId},data:{genelToplam:'300.30'}});});
 expect(await sonuc(f,k.invoiceId)).toMatchObject({faturaPayi:'100.10',payKapsami:'kismi',payDisiVeyaBelirsizSatirSayisi:1,kapama:{durum:'dagitilamadi',kasaBanka:null,iade:null,kalan:null}});
});
it('tam kaynaklı faturada iade kapaması nakit sayılmaz; kapama çözülmesi bakiyeye yansır',async()=>{
 const f=await fixture(),k=await kanitliFatura(f);
 const iade=await tx(f,t=>t.fatura.create({data:{tenantId:f.tenantId,cariId:f.cariId,...totals,toplamTevkifat:'0',tip:'satis_iade',durum:'kesin',tarih:new Date('2026-10-17'),genelToplam:'20.05'}}));
 const closing=await tx(f,t=>t.faturaKapama.create({data:{tenantId:f.tenantId,cariId:f.cariId,faturaId:k.invoiceId,iadeFaturaId:iade.id,tutar:'20.05'}}));
 expect((await sonuc(f,k.invoiceId)).kapama).toMatchObject({durum:'tam',kasaBanka:'0.00',iade:'20.05',kalan:'80.05'});
 await tx(f,t=>t.fatura.update({where:{id:iade.id},data:{durum:'iptal'}}));expect((await sonuc(f,k.invoiceId)).kapama.durum).toBe('dagitilamadi');
 await tx(f,t=>t.faturaKapama.delete({where:{id:closing.id}}));expect((await sonuc(f,k.invoiceId)).kapama.kalan).toBe('100.10');
});
it('tutar tutarsızlığı ve yinelenen kaynak satır yanlış fatura payı üretmez',async()=>{
 const f=await fixture(),k=await kanitliFatura(f);
 await tx(f,t=>t.fatura.update({where:{id:k.invoiceId},data:{genelToplam:'999'}}));expect((await sonuc(f,k.invoiceId)).faturaPayi).toBeNull();
 await tx(f,async t=>{const row=await t.faturaSatir.findFirstOrThrow({where:{faturaId:k.invoiceId}});const {id,...data}=row;await t.faturaSatir.create({data:{...data,partiBilgileri:undefined,ekVergiler:undefined}});await t.fatura.update({where:{id:k.invoiceId},data:{genelToplam:'200.20'}});});
 expect((await sonuc(f,k.invoiceId)).faturaPayi).toBeNull();
});
it('satır kaynak FK tenant ve stok kapsamını korur; kaynak silinirse kanıt sıfırlanır',async()=>{
 const f=await fixture(),other=await fixture(),k=await kanitliFatura(f),foreign=await kanitliFatura(other);
 const row=await tx(f,t=>t.faturaSatir.findFirstOrThrow({where:{faturaId:k.invoiceId}})),otherRow=await tx(other,t=>t.faturaSatir.findFirstOrThrow({where:{faturaId:foreign.invoiceId}}));
 await expect(tx(f,t=>t.faturaSatir.update({where:{id:row.id},data:{kaynakBelgeSatirId:otherRow.kaynakBelgeSatirId}}))).rejects.toThrow();
 await tx(f,t=>t.belgeSatir.delete({where:{id:row.kaynakBelgeSatirId!}}));expect((await tx(f,t=>t.faturaSatir.findUniqueOrThrow({where:{id:row.id}}))).kaynakBelgeSatirId).toBeNull();expect((await sonuc(f,k.invoiceId)).faturaPayi).toBeNull();
});
it('iki fırsatın ortak faturasındaki kaynak payları toplamı faturayı aşmaz; kapamalar ikiye yazılmaz',async()=>{
 const f=await fixture(),first=await kanitliFatura(f);
 const opp=await tx(f,t=>t.crmFirsat.create({data:{tenantId:f.tenantId,cariId:f.cariId,baslik:'İkinci satış',tahminiTutar:'99999'}}));
 const other={...f,firsatId:opp.id,firsatZamani:opp.updatedAt.toISOString()},second=await kanitliFatura(other);
 await tx(f,async t=>{await t.faturaSatir.updateMany({where:{faturaId:second.invoiceId},data:{faturaId:first.invoiceId}});await t.belge.update({where:{id:second.orderId},data:{faturaId:first.invoiceId}});await t.fatura.update({where:{id:first.invoiceId},data:{genelToplam:'200.20'}});});
 const x=await sonuc(f,first.invoiceId),y=await sonuc(other,first.invoiceId);
 expect(x.faturaPayi).toBe('100.10');expect(y.faturaPayi).toBe('100.10');expect(x.kapama.kasaBanka).toBeNull();expect(y.kapama.iade).toBeNull();
});
it('kasa/banka kapaması ayrı görünür; fazla kapama ve değiştirilmiş döviz güvenilir sonuç üretmez',async()=>{
 const f=await fixture(),k=await kanitliFatura(f);
 const hareket=await tx(f,t=>t.kasaBankaHareket.create({data:{tenantId:f.tenantId,cariId:f.cariId,tip:'tahsilat',tutar:'30.02',tutarTry:'30.02',tarih:new Date('2026-10-17')}}));
 const cap=await tx(f,t=>t.faturaKapama.create({data:{tenantId:f.tenantId,cariId:f.cariId,faturaId:k.invoiceId,kasaBankaHareketId:hareket.id,tutar:'30.02'}}));
 expect((await sonuc(f,k.invoiceId)).kapama).toMatchObject({durum:'tam',kasaBanka:'30.02',iade:'0.00',kalan:'70.08'});
 await tx(f,t=>t.faturaKapama.update({where:{id:cap.id},data:{tutar:'200'}}));expect((await sonuc(f,k.invoiceId)).kapama.kalan).toBeNull();
 await tx(f,t=>t.fatura.update({where:{id:k.invoiceId},data:{dovizCinsi:'USD'}}));expect((await sonuc(f,k.invoiceId)).faturaPayi).toBeNull();
});

async function acikDagitim(){
 const f=await fixture(),first=await kanitliFatura(f);
 const opp=await tx(f,t=>t.crmFirsat.create({data:{tenantId:f.tenantId,cariId:f.cariId,baslik:'Diğer fırsat',tahminiTutar:'800'}}));
 const other={...f,firsatId:opp.id,firsatZamani:opp.updatedAt.toISOString()},second=await kanitliFatura(other);
 await tx(f,async t=>{await t.faturaSatir.updateMany({where:{faturaId:second.invoiceId},data:{faturaId:first.invoiceId}});await t.belge.update({where:{id:second.orderId},data:{faturaId:first.invoiceId}});await t.fatura.update({where:{id:first.invoiceId},data:{genelToplam:'200.20',toplamMatrah:'200.20'}});await t.user.update({where:{id:f.userId},data:{rol:'muhasebe'}});});
 const hareket=await tx(f,t=>t.kasaBankaHareket.create({data:{tenantId:f.tenantId,cariId:f.cariId,tip:'tahsilat',tutar:'150.15',tutarTry:'150.15',tarih:new Date('2026-10-17')}}));
 const cap=await tx(f,t=>t.faturaKapama.create({data:{tenantId:f.tenantId,cariId:f.cariId,faturaId:first.invoiceId,kasaBankaHareketId:hareket.id,tutar:'150.15'}}));
 return {f,other,invoiceId:first.invoiceId,cap,quoteId:first.quoteId};
}
const payOku=(f:F,id:string)=>ctx(f,()=>s.kapamaPaylari(f.firsatId,id));
async function payGirdisi(f:F,id:string,tutar:string){const d=await payOku(f,id),k=d.kapamalar[0];return {kapamaId:k.id,istekAnahtari:randomUUID(),gerekce:'Müşterinin ödeme bildirimi',beklenenSurum:k.surum,kanitOzeti:d.kanitOzeti,kaynakOzeti:k.kaynakOzeti,tutar};}
const payYaz=(f:F,id:string,g:Awaited<ReturnType<typeof payGirdisi>>,service=s)=>ctx(f,()=>service.kapamaPayiYaz(f.firsatId,id,g),'muhasebe');
it('karma kapama açıkça belirtilir; aynı istek tek olay/audit üretir ve muhasebe defteri değişmez',async()=>{
 const {f,other,invoiceId}=await acikDagitim(),before=await resources(f),g=await payGirdisi(f,invoiceId,'80.00');
 const r=await payYaz(f,invoiceId,g);expect(await payYaz(f,invoiceId,g)).toEqual(r);
 expect(await tx(f,t=>t.firsatKapamaPayi.count())).toBe(1);expect(await tx(f,t=>t.auditLog.count({where:{islem:'firsat_kapama_payi_belirtildi'}}))).toBe(1);
 expect((await payOku(f,invoiceId)).dagitilanToplam).toBe('80.00');expect((await payOku(other,invoiceId)).kapamalar[0].azamiTutar).toBe('70.15');expect(await resources(f)).toBe(before);
 await expect(payYaz(f,invoiceId,{...g,tutar:'81'})).rejects.toMatchObject({status:409});
});
it('iki fırsat eşzamanlı aynı kapamanın toplamından fazlasını ayıramaz',async()=>{
 const {f,other,invoiceId}=await acikDagitim(),g=await payGirdisi(f,invoiceId,'100.10'),h=await payGirdisi(other,invoiceId,'100.10');
 const results=await Promise.allSettled([payYaz(f,invoiceId,g),payYaz(other,invoiceId,h,s2)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.status).toBe(409);
 expect(await tx(f,t=>t.firsatKapamaPayi.count())).toBe(1);
});
it('sürüm, kaynak ve fatura payı sınırları korunur; sıfır yeni sürümle payı kaldırır',async()=>{
 const {f,invoiceId,cap}=await acikDagitim(),g=await payGirdisi(f,invoiceId,'101');await expect(payYaz(f,invoiceId,g)).rejects.toMatchObject({status:409});
 await payYaz(f,invoiceId,{...g,tutar:'70'});await expect(payYaz(f,invoiceId,{...g,istekAnahtari:randomUUID(),tutar:'60'})).rejects.toMatchObject({status:409});
 const zero=await payGirdisi(f,invoiceId,'0');await payYaz(f,invoiceId,zero);expect((await payOku(f,invoiceId)).kapamalar[0]).toMatchObject({pay:'0.00',surum:2});
 expect((await payOku(f,invoiceId)).gecmis).toHaveLength(2);expect(await payYaz(f,invoiceId,{...g,tutar:'70'})).toMatchObject({surum:1});expect((await payOku(f,invoiceId)).dagitilanToplam).toBe('0.00');
 const stale=await payGirdisi(f,invoiceId,'20');await tx(f,t=>t.faturaKapama.update({where:{id:cap.id},data:{tutar:'140'}}));await expect(payYaz(f,invoiceId,stale)).rejects.toMatchObject({status:409});
});
it('denkleştirme kapamayı yenilerse ve teklif bağı çözülürse eski paylar geçersizleşir; geçmiş erişilebilir kalır',async()=>{
 const {f,invoiceId,cap,quoteId}=await acikDagitim();await payYaz(f,invoiceId,await payGirdisi(f,invoiceId,'50'));
 await tx(f,t=>t.faturaKapama.delete({where:{id:cap.id}}));expect((await payOku(f,invoiceId)).dagitilanToplam).toBe('0.00');expect((await payOku(f,invoiceId)).gecmis[0].gecerli).toBe(false);
 const next=await tx(f,t=>t.faturaKapama.create({data:{tenantId:f.tenantId,cariId:f.cariId,faturaId:invoiceId,kasaBankaHareketId:cap.kasaBankaHareketId,tutar:'150.15'}}));
 const d=await payOku(f,invoiceId);expect(d.kapamalar[0]).toMatchObject({id:next.id,surum:0,pay:null});await payYaz(f,invoiceId,await payGirdisi(f,invoiceId,'50'));
 await tx(f,t=>t.user.update({where:{id:f.userId},data:{rol:'yonetici'}}));const link=await tx(f,t=>t.firsatBelgeBagi.findFirstOrThrow({where:{belgeId:quoteId,cozulduAt:null}}));
 await ctx(f,()=>s.coz(f.firsatId,link.id,closeBody()),'yonetici');expect((await payOku(f,invoiceId)).dagitilanToplam).toBe('0.00');expect((await ctx(f,()=>s.listele(f.firsatId))).payFaturaGecmisi).toContainEqual({id:invoiceId,no:null});
});
it('satış yazamaz; salt okunur mod, yabancı şirket/cari ve pasif kullanıcı reddedilir',async()=>{
 const {f,invoiceId}=await acikDagitim(),g=await payGirdisi(f,invoiceId,'20'),foreign=await fixture();
 await expect(ctx(f,()=>s.kapamaPayiYaz(f.firsatId,invoiceId,g))).rejects.toMatchObject({status:403});await expect(payOku(foreign,invoiceId)).rejects.toMatchObject({status:404});
 await tx(f,t=>t.modulAyar.update({where:{tenantId_modul:{tenantId:f.tenantId,modul:'crm_belge_baglari'}},data:{ayarlar:{surum:1,mod:'salt_okunur'}}}));await expect(payYaz(f,invoiceId,g)).rejects.toMatchObject({status:403});
 await tx(f,t=>t.modulAyar.update({where:{tenantId_modul:{tenantId:f.tenantId,modul:'crm_belge_baglari'}},data:{ayarlar:{surum:1,mod:'pilot'}}}));await tx(f,t=>t.user.update({where:{id:f.userId},data:{aktif:false}}));await expect(payYaz(f,invoiceId,g)).rejects.toMatchObject({status:403});
});
it('dağıtım geçmişi değiştirilemez/silinemez; RLS ve audit geri alma korunur',async()=>{
 const {f,invoiceId}=await acikDagitim(),g=await payGirdisi(f,invoiceId,'20');
 const adapter={tenantIslem:(tenantId:string,work:(t:Prisma.TransactionClient)=>Promise<unknown>)=>a.tenantIslem(tenantId,t=>work(new Proxy(t,{get(target,key){return key==='auditLog'?{create:async()=>{throw Error('Pay audit hatası');}}:Reflect.get(target,key);}})))};
 await expect(payYaz(f,invoiceId,g,new CrmBelgeService(adapter as unknown as PrismaService,belgeler(a)))).rejects.toThrow('Pay audit hatası');expect(await tx(f,t=>t.firsatKapamaPayi.count())).toBe(0);
 const r=await payYaz(f,invoiceId,g),foreign=await fixture();expect(await tx(foreign,t=>t.firsatKapamaPayi.findMany({where:{id:r.id}}))).toEqual([]);
 await expect(tx(f,t=>t.firsatKapamaPayi.update({where:{id:r.id},data:{tutar:'90'}}))).rejects.toThrow();await expect(tx(f,t=>t.firsatKapamaPayi.delete({where:{id:r.id}}))).rejects.toThrow();
});
it('birden fazla kapamada fırsatın toplam fatura payı aşılmaz',async()=>{
 const {f,invoiceId,cap}=await acikDagitim();await tx(f,t=>t.faturaKapama.update({where:{id:cap.id},data:{tutar:'80'}}));
 const extra=await tx(f,t=>t.faturaKapama.create({data:{tenantId:f.tenantId,cariId:f.cariId,faturaId:invoiceId,kasaBankaHareketId:cap.kasaBankaHareketId,tutar:'80'}}));
 await payYaz(f,invoiceId,{...await payGirdisi(f,invoiceId,'70'),kapamaId:cap.id,kaynakOzeti:(await payOku(f,invoiceId)).kapamalar.find(k=>k.id===cap.id)!.kaynakOzeti});
 const d=await payOku(f,invoiceId),k=d.kapamalar.find(k=>k.id===extra.id)!;expect(k.azamiTutar).toBe('30.10');
 const g={kapamaId:k.id,istekAnahtari:randomUUID(),gerekce:'İkinci ödeme payı',beklenenSurum:k.surum,kanitOzeti:d.kanitOzeti,kaynakOzeti:k.kaynakOzeti,tutar:'40'};
 await expect(payYaz(f,invoiceId,g)).rejects.toMatchObject({status:409});await payYaz(f,invoiceId,{...g,tutar:'30.10'});expect((await payOku(f,invoiceId)).dagitilanToplam).toBe('100.10');
});
it('karma faturanın iade kapaması açık pay alır; iade iptal edilince dağıtım kendiliğinden geçersizleşir',async()=>{
 const {f,invoiceId}=await acikDagitim();const iade=await tx(f,t=>t.fatura.create({data:{tenantId:f.tenantId,cariId:f.cariId,...totals,toplamTevkifat:'0',tip:'satis_iade',durum:'kesin',tarih:new Date('2026-10-17'),genelToplam:'20.05'}}));
 const cap=await tx(f,t=>t.faturaKapama.create({data:{tenantId:f.tenantId,cariId:f.cariId,faturaId:invoiceId,iadeFaturaId:iade.id,tutar:'20.05'}}));
 const d=await payOku(f,invoiceId),k=d.kapamalar.find(k=>k.id===cap.id)!;
 await payYaz(f,invoiceId,{kapamaId:k.id,istekAnahtari:randomUUID(),gerekce:'İadenin fırsata ait kapaması',beklenenSurum:k.surum,kanitOzeti:d.kanitOzeti,kaynakOzeti:k.kaynakOzeti,tutar:'20.05'});
 expect((await payOku(f,invoiceId)).kapamalar.find(k=>k.id===cap.id)).toMatchObject({tur:'iade',pay:'20.05'});
 expect((await payOku(f,invoiceId)).ozet).toEqual({durum:'kismi',kasaBanka:'0.00',iade:'20.05',diger:'0.00',dagitilmamisPay:'80.05'});
 await tx(f,t=>t.fatura.update({where:{id:iade.id},data:{durum:'iptal'}}));expect((await payOku(f,invoiceId)).kapamalar.find(k=>k.id===cap.id)).toMatchObject({pay:null,gecersizEskiPay:true,gecerli:false});
 expect((await payOku(f,invoiceId)).ozet).toEqual({durum:'dagitilamadi',kasaBanka:null,iade:null,diger:null,dagitilmamisPay:null});
});
it('karma kapama özeti iki fırsatın dağıtımını ayrı tutar; sıfır revizyonu özeti eksik yapar',async()=>{
 const {f,other,invoiceId}=await acikDagitim(),before=await resources(f);
 expect((await payOku(f,invoiceId)).ozet).toMatchObject({durum:'kismi',kasaBanka:'0.00',dagitilmamisPay:'100.10'});
 await payYaz(f,invoiceId,await payGirdisi(f,invoiceId,'80.00'));
 expect((await payOku(f,invoiceId)).ozet).toMatchObject({durum:'kismi',kasaBanka:'80.00',dagitilmamisPay:'20.10'});
 await payYaz(other,invoiceId,await payGirdisi(other,invoiceId,'70.15'));
 expect((await payOku(f,invoiceId)).ozet).toMatchObject({durum:'tam',kasaBanka:'80.00',dagitilmamisPay:'20.10'});
 expect((await payOku(other,invoiceId)).ozet).toMatchObject({durum:'tam',kasaBanka:'70.15',dagitilmamisPay:'29.95'});
 await payYaz(f,invoiceId,await payGirdisi(f,invoiceId,'0'));
 expect((await payOku(f,invoiceId)).ozet).toMatchObject({durum:'kismi',kasaBanka:'0.00',dagitilmamisPay:'100.10'});
 expect(await resources(f)).toBe(before);
});

const iadeOku=(f:F,id:string)=>ctx(f,()=>s.iadePaylari(f.firsatId,id));
async function iadeGirdisi(f:F,id:string,iadeFaturaId:string,matrah:string){const d=await iadeOku(f,id),i=d.iadeler.find(i=>i.id===iadeFaturaId)!;return {iadeFaturaId,matrah,istekAnahtari:randomUUID(),gerekce:'İade edilen ürünlerin fırsat dağılımı',beklenenSurum:i.surum,kanitOzeti:i.kanitOzeti};}
const iadeYaz=(f:F,id:string,g:Awaited<ReturnType<typeof iadeGirdisi>>,service=s)=>ctx(f,()=>service.iadePayiYaz(f.firsatId,id,g),'muhasebe');
it('karma ticari iade iki fırsata açık dağıtılır; eksik sonuç bilinmez ve kapama defteri değişmez',async()=>{
 const {f,other,invoiceId}=await acikDagitim(),i=await referansliIade(f,invoiceId,'50.05','10.01'),before=await resources(f);
 expect((await iadeOku(f,invoiceId)).sonuc.netMatrah).toBeNull();
 const g=await iadeGirdisi(f,invoiceId,i.id,'20.05'),r=await iadeYaz(f,invoiceId,g);expect(await iadeYaz(f,invoiceId,g)).toEqual(r);
 expect((await iadeOku(f,invoiceId)).sonuc).toMatchObject({durum:'eksik_veya_gecersiz',belirtilenIadeMatrahi:'20.05',netMatrah:null});
 await iadeYaz(other,invoiceId,await iadeGirdisi(other,invoiceId,i.id,'30.00'));
 expect((await iadeOku(f,invoiceId)).sonuc).toEqual({durum:'tam',satisMatrahi:'100.10',belirtilenIadeMatrahi:'20.05',netMatrah:'80.05'});
 expect((await iadeOku(other,invoiceId)).sonuc.netMatrah).toBe('70.10');expect(await resources(f)).toBe(before);
 expect(await tx(f,t=>t.firsatIadePayi.count())).toBe(2);expect(await tx(f,t=>t.auditLog.count({where:{islem:'firsat_iade_payi_belirtildi'}}))).toBe(2);
 await expect(iadeYaz(f,invoiceId,{...g,matrah:'21'})).rejects.toMatchObject({status:409});
});
it('iki bağlantı aynı iade matrahını eşzamanlı aşamaz; tüm iadelerde fırsat satış sınırı korunur',async()=>{
 const {f,other,invoiceId}=await acikDagitim(),i=await referansliIade(f,invoiceId,'50','0');
 const g=await iadeGirdisi(f,invoiceId,i.id,'40'),h=await iadeGirdisi(other,invoiceId,i.id,'40');
 const r=await Promise.allSettled([iadeYaz(f,invoiceId,g),iadeYaz(other,invoiceId,h,s2)]);expect(r.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((r.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.status).toBe(409);
 const winner=r[0].status==='fulfilled'?f:other;
 const second=await referansliIade(f,invoiceId,'80','0');
 const d=await iadeOku(winner,invoiceId);expect(d.iadeler.find(r=>r.id===second.id)!.azamiMatrah).toBe('60.10');
 await expect(iadeYaz(winner,invoiceId,await iadeGirdisi(winner,invoiceId,second.id,'61'))).rejects.toMatchObject({status:409});
});
it('sıfır sürümü payı kaldırır; eski sürüm reddedilir ve kaynak değişirse pay geçersizleşir',async()=>{
 const {f,invoiceId}=await acikDagitim(),i=await referansliIade(f,invoiceId,'20','0'),g=await iadeGirdisi(f,invoiceId,i.id,'20');await iadeYaz(f,invoiceId,g);
 await expect(iadeYaz(f,invoiceId,{...g,istekAnahtari:randomUUID()})).rejects.toMatchObject({status:409});
 await iadeYaz(f,invoiceId,await iadeGirdisi(f,invoiceId,i.id,'0'));expect((await iadeOku(f,invoiceId)).iadeler[0]).toMatchObject({surum:2,pay:'0.00'});
 await iadeYaz(f,invoiceId,await iadeGirdisi(f,invoiceId,i.id,'10'));const stale=await iadeGirdisi(f,invoiceId,i.id,'5');
 await tx(f,t=>t.fatura.update({where:{id:i.id},data:{no:'IADE-DEGISTI'}}));expect((await iadeOku(f,invoiceId)).iadeler[0]).toMatchObject({pay:null,gecersizEskiPay:true});
 await expect(iadeYaz(f,invoiceId,stale)).rejects.toMatchObject({status:409});expect((await iadeOku(f,invoiceId)).gecmis).toHaveLength(3);
});
it('çok kaynak, döviz ve iptal ticari dağıtımı engeller; iptal iade satış sonucundan çıkar',async()=>{
 const {f,invoiceId}=await acikDagitim(),i=await referansliIade(f,invoiceId,'20','0');
 const ref=await tx(f,t=>t.faturaIadeReferansi.create({data:{tenantId:f.tenantId,faturaId:i.id,sira:2,belgeNo:'HAR2026000000001',tarih:new Date('2026-10-18')}}));
 expect((await iadeOku(f,invoiceId)).iadeler[0].gecerli).toBe(false);await tx(f,t=>t.faturaIadeReferansi.delete({where:{id:ref.id}}));
 await tx(f,t=>t.fatura.update({where:{id:i.id},data:{dovizCinsi:'USD'}}));expect((await iadeOku(f,invoiceId)).iadeler[0].gecerli).toBe(false);
 await tx(f,t=>t.fatura.update({where:{id:i.id},data:{dovizCinsi:'TRY'}}));await iadeYaz(f,invoiceId,await iadeGirdisi(f,invoiceId,i.id,'20'));
 await tx(f,t=>t.fatura.update({where:{id:i.id},data:{durum:'iptal'}}));const d=await iadeOku(f,invoiceId);expect(d.iadeler[0]).toMatchObject({gecerli:false,pay:null});expect(d.sonuc.netMatrah).toBe('100.10');
});
it('ticari dağıtımda satış yazamaz; kapalı/salt okunur mod, pasif kullanıcı ve yabancı tenant engellenir',async()=>{
 const {f,invoiceId}=await acikDagitim(),i=await referansliIade(f,invoiceId),g=await iadeGirdisi(f,invoiceId,i.id,'10'),foreign=await fixture();
 await expect(ctx(f,()=>s.iadePayiYaz(f.firsatId,invoiceId,g))).rejects.toMatchObject({status:403});await expect(iadeOku(foreign,invoiceId)).rejects.toMatchObject({status:404});
 for(const mod of ['salt_okunur','kapali']){await tx(f,t=>t.modulAyar.update({where:{tenantId_modul:{tenantId:f.tenantId,modul:'crm_belge_baglari'}},data:{ayarlar:{surum:1,mod}}}));await expect(iadeYaz(f,invoiceId,g)).rejects.toMatchObject({status:403});}
 await tx(f,t=>t.modulAyar.update({where:{tenantId_modul:{tenantId:f.tenantId,modul:'crm_belge_baglari'}},data:{ayarlar:{surum:1,mod:'pilot'}}}));await tx(f,t=>t.user.update({where:{id:f.userId},data:{aktif:false}}));await expect(iadeYaz(f,invoiceId,g)).rejects.toMatchObject({status:403});
});
it('ticari iade geçmişi değişmez; RLS, bileşik FK ve audit rollback uygulanır',async()=>{
 const {f,invoiceId}=await acikDagitim(),i=await referansliIade(f,invoiceId),g=await iadeGirdisi(f,invoiceId,i.id,'10');
 const adapter={tenantIslem:(tenantId:string,work:(t:Prisma.TransactionClient)=>Promise<unknown>)=>a.tenantIslem(tenantId,t=>work(new Proxy(t,{get(target,key){return key==='auditLog'?{create:async()=>{throw Error('İade audit hatası');}}:Reflect.get(target,key);}})))};
 await expect(iadeYaz(f,invoiceId,g,new CrmBelgeService(adapter as unknown as PrismaService,belgeler(a)))).rejects.toThrow('İade audit hatası');expect(await tx(f,t=>t.firsatIadePayi.count())).toBe(0);
 const r=await iadeYaz(f,invoiceId,g),foreign=await fixture(),foreignInvoice=await kanitliFatura(foreign);expect(await tx(foreign,t=>t.firsatIadePayi.findMany({where:{id:r.id}}))).toEqual([]);
 await expect(tx(f,t=>t.firsatIadePayi.update({where:{id:r.id},data:{matrah:'11'}}))).rejects.toThrow();await expect(tx(f,t=>t.firsatIadePayi.delete({where:{id:r.id}}))).rejects.toThrow();
 const row=await tx(f,t=>t.firsatIadePayi.findUniqueOrThrow({where:{id:r.id}}));const {id,createdAt,...data}=row;
 await expect(tx(f,t=>t.firsatIadePayi.create({data:{...data,iadeFaturaId:foreignInvoice.invoiceId,surum:2,istekAnahtari:randomUUID()}}))).rejects.toThrow();
 const [rls]=await a.$queryRaw<{relrowsecurity:boolean;relforcerowsecurity:boolean}[]>`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='firsat_iade_paylari'`;expect(rls).toEqual({relrowsecurity:true,relforcerowsecurity:true});
 await tx(f,t=>t.user.update({where:{id:f.userId},data:{rol:'satis'}}));await expect(tx(f,t=>t.firsatIadePayi.create({data:{...data,surum:2,istekAnahtari:randomUUID()}}))).rejects.toThrow();
});
it('fırsat bağı çözülünce ticari iade geçmişi kaybolmaz ve güncel net sonuç hesaplanmaz',async()=>{
 const {f,invoiceId,quoteId}=await acikDagitim(),i=await referansliIade(f,invoiceId);await iadeYaz(f,invoiceId,await iadeGirdisi(f,invoiceId,i.id,'10'));
 await tx(f,t=>t.user.update({where:{id:f.userId},data:{rol:'yonetici'}}));const link=await tx(f,t=>t.firsatBelgeBagi.findFirstOrThrow({where:{belgeId:quoteId,cozulduAt:null}}));
 await ctx(f,()=>s.coz(f.firsatId,link.id,closeBody()),'yonetici');const d=await iadeOku(f,invoiceId);expect(d.sonuc.netMatrah).toBeNull();expect(d.gecmis[0].gecerli).toBe(false);
 expect((await ctx(f,()=>s.listele(f.firsatId))).payFaturaGecmisi).toContainEqual({id:invoiceId,no:null});
});
it('iadenin kaynak faturası düzeltilince eski pay geçersiz kalır ve yeni faturada sürüm oluşturulabilir',async()=>{
 const {f,invoiceId}=await acikDagitim(),i=await referansliIade(f,invoiceId,'20','0');await iadeYaz(f,invoiceId,await iadeGirdisi(f,invoiceId,i.id,'10'));
 await tx(f,t=>t.user.update({where:{id:f.userId},data:{rol:'yonetici'}}));const next=await kanitliFatura(f);await tx(f,t=>t.user.update({where:{id:f.userId},data:{rol:'muhasebe'}}));
 await tx(f,t=>t.faturaIadeReferansi.updateMany({where:{faturaId:i.id},data:{kaynakFaturaId:next.invoiceId}}));
 const old=await iadeOku(f,invoiceId);expect(old.gecmis[0].gecerli).toBe(false);
 await iadeYaz(f,next.invoiceId,await iadeGirdisi(f,next.invoiceId,i.id,'20'));expect((await iadeOku(f,next.invoiceId)).sonuc.netMatrah).toBe('80.10');
});

it('iade payı revizyonunda eski pay satış kapasitesine ikinci kez eklenmez',async()=>{
 const {f,invoiceId}=await acikDagitim(),i=await referansliIade(f,invoiceId,'150','0');
 await iadeYaz(f,invoiceId,await iadeGirdisi(f,invoiceId,i.id,'80'));
 const before=await resources(f),sayim=()=>tx(f,async t=>({pay:await t.firsatIadePayi.count(),audit:await t.auditLog.count({where:{islem:'firsat_iade_payi_belirtildi'}})})),once=await sayim();
 expect((await iadeOku(f,invoiceId)).iadeler.find(x=>x.id===i.id)?.azamiMatrah).toBe('100.10');
 await expect(iadeYaz(f,invoiceId,await iadeGirdisi(f,invoiceId,i.id,'100.11'))).rejects.toMatchObject({status:409});
 expect(await sayim()).toEqual(once);
 await iadeYaz(f,invoiceId,await iadeGirdisi(f,invoiceId,i.id,'100.10'));
 expect((await iadeOku(f,invoiceId)).iadeler.find(x=>x.id===i.id)).toMatchObject({pay:'100.10',surum:2,azamiMatrah:'100.10'});
 expect(await resources(f)).toBe(before);
});
it('revize edilen iade payının sınırı diğer iadelerde kullanılan satış payını düşer',async()=>{
 const {f,invoiceId}=await acikDagitim(),ilk=await referansliIade(f,invoiceId,'150','0'),diger=await referansliIade(f,invoiceId,'20','0');
 await iadeYaz(f,invoiceId,await iadeGirdisi(f,invoiceId,ilk.id,'40'));
 await iadeYaz(f,invoiceId,await iadeGirdisi(f,invoiceId,diger.id,'20'));
 expect((await iadeOku(f,invoiceId)).iadeler.find(x=>x.id===ilk.id)?.azamiMatrah).toBe('80.10');
 await expect(iadeYaz(f,invoiceId,await iadeGirdisi(f,invoiceId,ilk.id,'80.11'))).rejects.toMatchObject({status:409});
 await iadeYaz(f,invoiceId,await iadeGirdisi(f,invoiceId,ilk.id,'80.10'));
 const d=await iadeOku(f,invoiceId);expect(d.sonuc.belirtilenIadeMatrahi).toBe('100.10');
 expect(d.iadeler.find(x=>x.id===diger.id)).toMatchObject({pay:'20.00',surum:1});
});

it('5000 gerçek iade okunur ve pay yazılır; 5001 kayıtta okuma/yazma 409 ile bütün olarak reddedilir',async()=>{
 const f=await fixture(),k=await kanitliFatura(f),ids=Array.from({length:5000},()=>randomUUID());
 await tx(f,t=>t.user.update({where:{id:f.userId},data:{rol:'muhasebe'}}));
 await ctx(f,()=>a.tenantIslem(f.tenantId,async t=>{
  const source=await t.faturaSatir.findFirstOrThrow({where:{faturaId:k.invoiceId}});
  for(let n=0;n<ids.length;n+=500){const batch=ids.slice(n,n+500);
   await t.fatura.createMany({data:batch.map(id=>({id,tenantId:f.tenantId,cariId:f.cariId,...totals,toplamBrut:'0.01',toplamMatrah:'0.01',genelToplam:'0.01',toplamTevkifat:'0',tip:'satis_iade' as const,durum:'kesin',tarih:new Date('2026-10-18'),dovizCinsi:'TRY' as const}))});
   await t.faturaSatir.createMany({data:batch.map(faturaId=>({tenantId:f.tenantId,faturaId,stokId:source.stokId,miktar:'1',birimFiyat:'0.01',matrah:'0.01',toplamTutar:'0.01',kdvOrani:'0',kdvTutari:'0',netKdvTutari:'0'}))});
   await t.faturaIadeReferansi.createMany({data:batch.map(faturaId=>({tenantId:f.tenantId,faturaId,kaynakFaturaId:k.invoiceId,sira:1,belgeNo:'SAT2026000000001',tarih:new Date('2026-10-17')}))});
  }
 },{timeout:30000}));
 const view=await iadeOku(f,k.invoiceId);expect(view.iadeler).toHaveLength(5000);expect(view.iadeler.every(i=>i.gecerli)).toBe(true);
 const g=await iadeGirdisi(f,k.invoiceId,ids[0],'0.01');await iadeYaz(f,k.invoiceId,g);
 const counts=()=>tx(f,async t=>({pay:await t.firsatIadePayi.count(),audit:await t.auditLog.count({where:{islem:'firsat_iade_payi_belirtildi'}})}));
 const once=await counts();expect(once).toEqual({pay:1,audit:1});
 await referansliIade(f,k.invoiceId,'0.01','0');
 await expect(iadeOku(f,k.invoiceId)).rejects.toMatchObject({status:409});
 await expect(iadeYaz(f,k.invoiceId,{...g,istekAnahtari:randomUUID(),beklenenSurum:1})).rejects.toMatchObject({status:409});
 expect(await counts()).toEqual(once);
},60000);

it('5000 pay geçmişi okunur ama yeni pay yazılmaz; 5001 geçmişte kısmi okuma da yapılmaz',async()=>{
 const f=await fixture(),k=await kanitliFatura(f);await tx(f,t=>t.user.update({where:{id:f.userId},data:{rol:'muhasebe'}}));
 const target=await referansliIade(f,k.invoiceId,'0.01','0'),oldIds:string[]=[];
 for(let i=0;i<26;i++)oldIds.push((await referansliIade(f,k.invoiceId,'0.01','0')).id);
 const row=(iadeFaturaId:string,surum:number)=>({tenantId:f.tenantId,cariId:f.cariId,firsatId:f.firsatId,faturaId:k.invoiceId,iadeFaturaId,surum,matrah:'0',kanitOzeti:'a'.repeat(64),istekAnahtari:randomUUID(),girdiOzeti:'b'.repeat(64),gerekce:'Hacim testi geçmiş kaydı',olusturanUserId:f.userId});
 await ctx(f,()=>a.tenantIslem(f.tenantId,async t=>{
  for(const id of oldIds.slice(0,25))await t.firsatIadePayi.createMany({data:Array.from({length:200},(_,n)=>row(id,n+1))});
 },{timeout:30000}));
 const view=await iadeOku(f,k.invoiceId);expect(view.gecmis).toHaveLength(5000);expect(view.iadeler.find(i=>i.id===target.id)?.surum).toBe(0);
 const g=await iadeGirdisi(f,k.invoiceId,target.id,'0.01');
 await expect(iadeYaz(f,k.invoiceId,g)).rejects.toMatchObject({status:409,message:'Ticari iade geçmişi sınırına ulaşıldı'});
 expect(await tx(f,t=>t.firsatIadePayi.count())).toBe(5000);
 expect(await tx(f,t=>t.auditLog.count({where:{islem:'firsat_iade_payi_belirtildi'}}))).toBe(0);
 await tx(f,t=>t.firsatIadePayi.create({data:row(oldIds[25],1)}));
 await expect(iadeOku(f,k.invoiceId)).rejects.toMatchObject({status:409});
 await expect(iadeYaz(f,k.invoiceId,{...g,istekAnahtari:randomUUID()})).rejects.toMatchObject({status:409});
 expect(await tx(f,t=>t.firsatIadePayi.count())).toBe(5001);
 expect(await tx(f,t=>t.auditLog.count({where:{islem:'firsat_iade_payi_belirtildi'}}))).toBe(0);
},60000);

async function hacimKapamalari(f:F,invoiceId:string,adet:number){
 const ids=Array.from({length:adet},()=>({id:randomUUID(),hareketId:randomUUID()}));
 await ctx(f,()=>a.tenantIslem(f.tenantId,async t=>{
  for(let n=0;n<ids.length;n+=500){const batch=ids.slice(n,n+500);
   await t.kasaBankaHareket.createMany({data:batch.map(r=>({id:r.hareketId,tenantId:f.tenantId,cariId:f.cariId,tip:'tahsilat' as const,tutar:'0.01',tutarTry:'0.01',dovizCinsi:'TRY' as const,kur:'1',kaynakTur:'manuel',tarih:new Date('2026-10-17')}))});
   await t.faturaKapama.createMany({data:batch.map(r=>({id:r.id,tenantId:f.tenantId,cariId:f.cariId,faturaId:invoiceId,kasaBankaHareketId:r.hareketId,tutar:'0.01'}))});
  }
 },{timeout:30000}));return ids;
}
it('5000 gerçek kapama tam okunur ve pay yazılır; 5001 kapamada okuma/yazma kısmi sonuç vermez',async()=>{
 const f=await fixture(),k=await kanitliFatura(f);await tx(f,t=>t.user.update({where:{id:f.userId},data:{rol:'muhasebe'}}));
 await hacimKapamalari(f,k.invoiceId,5000);
 const view=await payOku(f,k.invoiceId);expect(view.kapamalar).toHaveLength(5000);expect(view.kapamalar.every(k=>k.gecerli)).toBe(true);
 const g=await payGirdisi(f,k.invoiceId,'0.01');await payYaz(f,k.invoiceId,g);
 const count=()=>tx(f,async t=>({pay:await t.firsatKapamaPayi.count(),audit:await t.auditLog.count({where:{islem:'firsat_kapama_payi_belirtildi'}})}));
 const before=await count();expect(before).toEqual({pay:1,audit:1});
 await hacimKapamalari(f,k.invoiceId,1);
 await expect(payOku(f,k.invoiceId)).rejects.toMatchObject({status:409});
 await expect(payYaz(f,k.invoiceId,{...g,istekAnahtari:randomUUID(),beklenenSurum:1})).rejects.toMatchObject({status:409});
 expect(await count()).toEqual(before);
},60000);
it('5000 kapama payı geçmişi okunur ama yazılmaz; 5001 geçmişte okuma da bütünüyle reddedilir',async()=>{
 const f=await fixture(),k=await kanitliFatura(f);await tx(f,t=>t.user.update({where:{id:f.userId},data:{rol:'muhasebe'}}));
 const caps=await hacimKapamalari(f,k.invoiceId,27);
 const row=(kapamaId:string,surum:number)=>({tenantId:f.tenantId,cariId:f.cariId,firsatId:f.firsatId,faturaId:k.invoiceId,kapamaId,surum,tutar:'0',kanitOzeti:'a'.repeat(64),kaynakOzeti:'b'.repeat(64),istekAnahtari:randomUUID(),girdiOzeti:'c'.repeat(64),gerekce:'Kapama hacim testi geçmişi',olusturanUserId:f.userId});
 await ctx(f,()=>a.tenantIslem(f.tenantId,async t=>{for(const c of caps.slice(1,26))await t.firsatKapamaPayi.createMany({data:Array.from({length:200},(_,i)=>row(c.id,i+1))});},{timeout:30000}));
 const view=await payOku(f,k.invoiceId);expect(view.gecmis).toHaveLength(5000);
 const cap=view.kapamalar.find(c=>c.id===caps[0].id)!;expect(cap.surum).toBe(0);
 const g={kapamaId:cap.id,istekAnahtari:randomUUID(),gerekce:'Geçmiş sınırında yeni pay',beklenenSurum:0,kanitOzeti:view.kanitOzeti,kaynakOzeti:cap.kaynakOzeti,tutar:'0.01'};
 await expect(payYaz(f,k.invoiceId,g)).rejects.toMatchObject({status:409,message:'Dağıtım geçmişi sınırına ulaşıldı'});
 expect(await tx(f,t=>t.firsatKapamaPayi.count())).toBe(5000);
 await tx(f,t=>t.firsatKapamaPayi.create({data:row(caps[26].id,1)}));
 await expect(payOku(f,k.invoiceId)).rejects.toMatchObject({status:409});
 await expect(payYaz(f,k.invoiceId,{...g,istekAnahtari:randomUUID()})).rejects.toMatchObject({status:409});
 expect(await tx(f,t=>t.firsatKapamaPayi.count())).toBe(5001);
 expect(await tx(f,t=>t.auditLog.count({where:{islem:'firsat_kapama_payi_belirtildi'}}))).toBe(0);
},60000);
