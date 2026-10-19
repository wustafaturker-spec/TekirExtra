import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { iadePaylariniOku } from "./crm-iade-paylari";
const mocks=vi.hoisted(()=>({kaynak:vi.fn(),sahiplik:vi.fn()}));
vi.mock('./crm-kapama-paylari',async original=>({...await original<typeof import('./crm-kapama-paylari')>(),kapamaPayiKaynak:mocks.kaynak}));
vi.mock('./crm-fatura-satir-sahipligi',()=>({faturaSatirSahiplikleriniOku:mocks.sahiplik}));
const D=(v:string)=>new Prisma.Decimal(v);
function kur(overflow?:string){
 const source={id:'S',no:'SAT',cariId:'C',tip:'satis',durum:'kesin',dovizCinsi:'TRY',toplamMatrah:D('100'),genelToplam:D('100')};
 const own={f:{id:'S',durum:'kesin',dovizCinsi:'TRY'},lines:[{id:'L',toplamTutar:D('100')}],path:[],links:[],satirSahipleri:[{satirId:'L',firsatId:'O',matrah:D('100')}]};
 mocks.kaynak.mockResolvedValue({f:source,own:[{id:'L'}],kanitOzeti:'a'});mocks.sahiplik.mockResolvedValue(new Map([['S',own]]));
 const ret={id:'I',no:'IAD',cariId:'C',tip:'satis_iade',durum:'kesin',dovizCinsi:'TRY',toplamMatrah:D('1'),genelToplam:D('1'),updatedAt:new Date('2026-10-19')};
 const rows:Record<string,unknown[]>={satisSatirlari:[{id:'L',matrah:D('100')}],referanslar:[{faturaId:'I'}],iadeler:[ret],tumReferanslar:[{id:'R',faturaId:'I',kaynakFaturaId:'S',belgeNo:'SAT',tarih:new Date('2026-10-18')}],kaynakBasliklari:[source],iadeSatirlari:[{id:'IL',faturaId:'I',matrah:D('1'),toplamTutar:D('1')}],gecmis:[],kapamalar:[]};
 const read=(key:string)=>Promise.resolve(overflow===key?Array.from({length:5001},()=>({})):rows[key]);
 let faturalar=0,satirlar=0,referanslar=0;
 const tx={fatura:{findFirstOrThrow:vi.fn().mockResolvedValue({toplamMatrah:D('100')}),findMany:vi.fn(()=>read(faturalar++?'kaynakBasliklari':'iadeler'))},faturaSatir:{findMany:vi.fn(()=>read(satirlar++?'iadeSatirlari':'satisSatirlari'))},faturaIadeReferansi:{findMany:vi.fn(()=>read(referanslar++?'tumReferanslar':'referanslar'))},firsatIadePayi:{findMany:vi.fn(()=>read('gecmis'))},faturaKapama:{findMany:vi.fn(()=>read('kapamalar'))}};
 return tx;
}
beforeEach(()=>vi.clearAllMocks());
describe('ticari iade okumalarında hacim koruması',()=>{
 it('sınır altındaki geçerli kaynakları tam olarak döndürür',async()=>{
  const d=await iadePaylariniOku(kur() as never,'T','C','O','S');expect(d.view.iadeler).toHaveLength(1);expect(d.view.iadeler[0]).toMatchObject({gecerli:true,azamiMatrah:'1.00'});
 });
 it.each(['satisSatirlari','referanslar','iadeler','tumReferanslar','kaynakBasliklari','iadeSatirlari','gecmis','kapamalar'])('%s 5001 kayıt içerirse kısmi görünüm yerine 409 döner',async field=>{
  await expect(iadePaylariniOku(kur(field) as never,'T','C','O','S')).rejects.toMatchObject({status:409});
 });
});
