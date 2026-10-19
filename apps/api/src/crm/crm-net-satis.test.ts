import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { referansliIadeleriOku } from "./crm-net-satis";
import { karmaIadeKaniti, karmaIadeKaynakKaniti } from "./crm-iade-paylari";
const ownership=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("./crm-fatura-satir-sahipligi",()=>({faturaSatirSahiplikleriniOku:ownership.read}));
const D=(s:string)=>new Prisma.Decimal(s);
function kur(invalid=false){
 const sources=['A','B','C'].map(id=>({id,no:id,cariId:'cari',tip:'satis',durum:'kesin',dovizCinsi:'TRY',toplamMatrah:D(invalid&&id==='A'?'30':'100.10'),genelToplam:D(invalid&&id==='A'?'36':'120.12')}));
 const owns=new Map(sources.map(s=>[s.id,{f:{id:s.id,dovizCinsi:'TRY',durum:'kesin'},lines:[{id:'L'+s.id,toplamTutar:s.genelToplam}],path:[],links:[],satirSahipleri:[{satirId:'L'+s.id,firsatId:'O'+s.id,matrah:s.toplamMatrah}]}]));ownership.read.mockResolvedValue(owns);
 const returns=[{id:'X',no:'I-X',cariId:'cari',tip:'satis_iade',durum:'kesin',dovizCinsi:'TRY',toplamMatrah:D('50.05'),genelToplam:D('60.06'),updatedAt:new Date('2026-10-19')},{id:'Y',no:'I-Y',cariId:'cari',tip:'satis_iade',durum:'kesin',dovizCinsi:'TRY',toplamMatrah:D('20'),genelToplam:D('24'),updatedAt:new Date('2026-10-19')}];
 const refs=[['X','A'],['X','B'],['Y','B'],['Y','C']].map(([faturaId,kaynakFaturaId],n)=>({id:'R'+n,faturaId,kaynakFaturaId,belgeNo:kaynakFaturaId,tarih:new Date('2026-10-18')}));
 const rows=returns.map(f=>({id:'IL'+f.id,faturaId:f.id,matrah:f.toplamMatrah,toplamTutar:f.genelToplam}));
 const history=refs.map((r,n)=>{
  const f=returns.find(f=>f.id===r.faturaId)!,sourceIds=refs.filter(x=>x.faturaId===f.id).map(x=>x.kaynakFaturaId).sort();
  const kanitOzeti=karmaIadeKaniti(sourceIds.map(id=>{const header=sources.find(s=>s.id===id)!;return{id,proof:karmaIadeKaynakKaniti(header,owns.get(id)!),header};}),f,refs.filter(x=>x.faturaId===f.id),rows.filter(x=>x.faturaId===f.id));
  return{id:'H'+n,cariId:'cari',faturaId:r.kaynakFaturaId,iadeFaturaId:r.faturaId,firsatId:'O'+r.kaynakFaturaId,surum:1,kanitOzeti,matrah:D((invalid?['40','10.05','10','10']:['20.05','30','10','10'])[n])};
 });
 const tx={faturaIadeReferansi:{findMany:vi.fn().mockResolvedValueOnce(refs.map(r=>({kaynakFaturaId:r.kaynakFaturaId,fatura:{...returns.find(f=>f.id===r.faturaId)!,tenantId:'tenant'}}))).mockResolvedValueOnce(refs)},fatura:{findMany:vi.fn().mockResolvedValueOnce(returns).mockResolvedValueOnce(sources)},faturaSatir:{findMany:vi.fn().mockImplementation(async q=>rows.map(r=>q.select?r:{...r,stokId:'hizmet',miktar:D('1')}))},firsatIadePayi:{findMany:vi.fn().mockResolvedValue(history)}};
 return{tx};
}
beforeEach(()=>vi.clearAllMocks());
describe('çok kaynaklı iadenin satış özetine aktarılması',()=>{
 it('yazma ekranının kanıtıyla saklanan payları aynı kaynak alanlarıyla doğrular',async()=>{
  const{tx}=kur();const oku=await referansliIadeleriOku(tx as never,'tenant','cari',['A','B','C']);
  expect(oku('A','TRY',D('100.10'),[],'OA')).toMatchObject({durum:'referans_kapsaminda',iadeMatrahi:'20.05',netMatrah:'80.05'});
  expect(oku('B','TRY',D('100.10'),[],'OB')).toMatchObject({iadeMatrahi:'40.00',netMatrah:'60.10'});
  expect(oku('C','TRY',D('100.10'),[],'OC')).toMatchObject({netMatrah:'90.10'});
 });
 it('kapasitesi aşılan iade, başka kaynakta tamamlanmış ilişkisiz iadeyi bozmaz',async()=>{
  const{tx}=kur(true);const oku=await referansliIadeleriOku(tx as never,'tenant','cari',['A','B','C']);
  expect(oku('A','TRY',D('100.10'),[],'OA').netMatrah).toBeNull();
  expect(oku('C','TRY',D('100.10'),[],'OC')).toMatchObject({durum:'referans_kapsaminda',netMatrah:'90.10'});
 });
 it('5000 referans sınırı kabul edilir; kesin olmayan iadeler satıştan düşülmez',async()=>{
  const{tx}=kur();tx.faturaIadeReferansi.findMany.mockReset().mockResolvedValue(Array.from({length:5000},()=>({kaynakFaturaId:'A',fatura:{id:'taslak',durum:'taslak'}})));tx.firsatIadePayi.findMany.mockResolvedValue([]);
  const oku=await referansliIadeleriOku(tx as never,'tenant','cari',['A']);
  expect(oku('A','TRY',D('100.10'),[],'OA')).toMatchObject({iadeMatrahi:'0.00',netMatrah:'100.10'});
 });
 it('5001 referansta kısmi sonuç üretmez ve diğer kaynakları sorgulamaz',async()=>{
  const{tx}=kur();tx.faturaIadeReferansi.findMany.mockReset().mockResolvedValue(Array.from({length:5001},()=>({})));
  await expect(referansliIadeleriOku(tx as never,'tenant','cari',['A'])).rejects.toMatchObject({status:409});
  expect(tx.fatura.findMany).not.toHaveBeenCalled();expect(ownership.read).not.toHaveBeenCalled();
 });
});
