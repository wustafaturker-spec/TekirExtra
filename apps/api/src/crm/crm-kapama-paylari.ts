import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

type Tx=Prisma.TransactionClient;
const D=(v:Prisma.Decimal.Value)=>new Prisma.Decimal(v);
export const payOzeti=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function sinir(n:number){if(n>5000)throw new ConflictException('Kapama dağıtımı 5000 kayıt sınırını aşıyor; eksik sonuç gösterilmedi');}

/** Faturanın bütün kaynak yolları hash'e girer: sahiplik değişince eski paylar kullanılmaz. */
export async function kapamaPayiKaynak(tx:Tx,tenantId:string,cariId:string,firsatId:string,faturaId:string){
 const f=await tx.fatura.findFirst({where:{id:faturaId,tenantId,cariId,tip:'satis'},select:{id:true,no:true,durum:true,dovizCinsi:true,genelToplam:true,updatedAt:true}});
 if(!f)throw new NotFoundException('Bu fırsatın carisine ait satış faturası bulunamadı');
 const lines=await tx.faturaSatir.findMany({where:{tenantId,faturaId},select:{id:true,stokId:true,toplamTutar:true,kaynakBelgeSatirId:true},orderBy:{id:'asc'},take:5001});sinir(lines.length);
 const sel={id:true,belgeId:true,stokId:true,kaynakSatirId:true,belge:{select:{id:true,tur:true,durum:true,kaynakBelgeId:true,faturaId:true,dovizCinsi:true}}} satisfies Prisma.BelgeSatirSelect;
 type Source=Prisma.BelgeSatirGetPayload<{select:typeof sel}>;
 const path=new Map<string,Source>();let ids=lines.flatMap(r=>r.kaynakBelgeSatirId?[r.kaynakBelgeSatirId]:[]);
 for(let depth=0;depth<3 && ids.length;depth++){
  const found=await tx.belgeSatir.findMany({where:{tenantId,id:{in:ids},belge:{tenantId,cariId,yon:'satis'}},select:sel,take:5001});
  for(const r of found)path.set(r.id,r);sinir(path.size);ids=found.flatMap(r=>r.kaynakSatirId && !path.has(r.kaynakSatirId)?[r.kaynakSatirId]:[]);
 }
 const roots=[...path.values()].filter(r=>r.belge.tur==='teklif').map(r=>r.belgeId);
 const links=await tx.firsatBelgeBagi.findMany({where:{tenantId,cariId,belgeId:{in:roots},cozulduAt:null},select:{id:true,belgeId:true,firsatId:true},orderBy:{id:'asc'},take:5001});sinir(links.length);
 const owner=new Map(links.map(l=>[l.belgeId,l.firsatId]));
 const sahibi=(r:typeof lines[number])=>{
  let s=r.kaynakBelgeSatirId?path.get(r.kaynakBelgeSatirId):undefined;
  if(!s || s.belge.faturaId!==f.id || s.belge.dovizCinsi!==f.dovizCinsi || !['siparis','irsaliye'].includes(s.belge.tur))return null;
  for(let i=0;s && i<3;i++){
   if(s.stokId!==r.stokId || s.belge.durum==='iptal')return null;
   if(s.belge.tur==='teklif')return owner.get(s.belgeId)??null;
   const parent:typeof s|undefined=s.kaynakSatirId?path.get(s.kaynakSatirId):undefined;
   if(!parent || parent.belgeId!==s.belge.kaynakBelgeId || !(s.belge.tur==='irsaliye' && parent.belge.tur==='siparis' || s.belge.tur==='siparis' && parent.belge.tur==='teklif'))return null;
   s=parent;
  }return null;
 };
 const counts=new Map<string,number>();for(const r of lines)if(r.kaynakBelgeSatirId)counts.set(r.kaynakBelgeSatirId,(counts.get(r.kaynakBelgeSatirId)??0)+1);
 const consistent=f.durum==='kesin' && lines.length>0 && lines.every(r=>!r.toplamTutar.isNegative()) && lines.reduce((v,r)=>v.add(r.toplamTutar),D(0)).equals(f.genelToplam);
 const own=consistent?lines.filter(r=>r.kaynakBelgeSatirId && counts.get(r.kaynakBelgeSatirId)===1 && sahibi(r)===firsatId):[];
 const pay=own.reduce((v,r)=>v.add(r.toplamTutar),D(0));
 const kanitOzeti=payOzeti({f,lines,path:[...path.values()].sort((a,b)=>a.id.localeCompare(b.id)),links});
 const closings=await tx.faturaKapama.findMany({where:{tenantId,cariId,faturaId},select:{id:true,tutar:true,createdAt:true,kasaBankaHareketId:true,iadeFaturaId:true,krediKartiHareketId:true,cekSenetId:true,
  kasaBankaHareket:{select:{tenantId:true,cariId:true,tip:true,tutar:true,dovizCinsi:true,kaynakTur:true}},iadeFatura:{select:{tenantId:true,cariId:true,tip:true,durum:true,updatedAt:true}},krediKartiHareket:{select:{tenantId:true,cariId:true,tutar:true,cariOdemeTutari:true}},cekSenet:{select:{tenantId:true,cariId:true,tutar:true,durum:true,yon:true,dovizCinsi:true}}},orderBy:{id:'asc'},take:5001});sinir(closings.length);
 const kapamalar=closings.map(k=>{
  const s=k.kasaBankaHareket??k.iadeFatura??k.krediKartiHareket??k.cekSenet;
  const valid=consistent && !!s && s.tenantId===tenantId && s.cariId===cariId && k.tutar.gt(0) && [k.kasaBankaHareketId,k.iadeFaturaId,k.krediKartiHareketId,k.cekSenetId].filter(Boolean).length===1 && (!k.kasaBankaHareket || k.kasaBankaHareket.tip==='tahsilat') && (!k.iadeFatura || k.iadeFatura.tip==='satis_iade' && k.iadeFatura.durum==='kesin');
  return {id:k.id,tutar:k.tutar,kaynakOzeti:payOzeti(k),gecerli:valid,tur:k.kasaBankaHareket?'kasa_banka':k.iadeFatura?'iade':'diger'};
 });
 const toplam=closings.reduce((v,k)=>v.add(k.tutar),D(0));
 if(toplam.gt(f.genelToplam) || closings.some(k=>k.tutar.isNegative()))for(const k of kapamalar)k.gecerli=false;
 const history=await tx.firsatKapamaPayi.findMany({where:{tenantId,faturaId},orderBy:{surum:'desc'},take:5001});sinir(history.length);
 const latest=new Map<string,typeof history[number]>();for(const r of history){const key=r.kapamaId+':'+r.firsatId;if(!latest.has(key))latest.set(key,r);}
 const current=[...latest.values()].filter(r=>r.kanitOzeti===kanitOzeti && kapamalar.some(k=>k.id===r.kapamaId && k.gecerli && k.kaynakOzeti===r.kaynakOzeti));
 const ownTotal=current.filter(r=>r.firsatId===firsatId).reduce((v,r)=>v.add(r.tutar),D(0));
 return {f,kanitOzeti,pay,own,kapamalar,history,latest,current,ownTotal};
}

export type PayKaynak=Awaited<ReturnType<typeof kapamaPayiKaynak>>;
export function kapamaPayiGorunumu(c:PayKaynak,firsatId:string){
 return {fatura:{id:c.f.id,no:c.f.no,dovizCinsi:c.f.dovizCinsi},kanitOzeti:c.kanitOzeti,faturaPayi:c.pay.toFixed(2),dagitilanToplam:c.ownTotal.toFixed(2),
  kapamalar:c.kapamalar.map(k=>{
   const old=c.latest.get(k.id+':'+firsatId),active=c.current.find(r=>r.id===old?.id);
   const others=c.current.filter(r=>r.kapamaId===k.id && r.firsatId!==firsatId).reduce((v,r)=>v.add(r.tutar),D(0));
   const otherOwn=c.ownTotal.sub(active?.tutar??0);
   const max=Prisma.Decimal.max(Prisma.Decimal.min(k.tutar.sub(others),c.pay.sub(otherOwn)),0);
   return {id:k.id,tur:k.tur,tutar:k.tutar.toFixed(2),kaynakOzeti:k.kaynakOzeti,gecerli:k.gecerli,surum:old?.surum??0,pay:active?.tutar.toFixed(2)??null,azamiTutar:k.gecerli?max.toFixed(2):'0.00',gecersizEskiPay:!!old && !active};
  }),gecmis:c.history.filter(r=>r.firsatId===firsatId).map(r=>({id:r.id,kapamaId:r.kapamaId,surum:r.surum,tutar:r.tutar.toFixed(2),gerekce:r.gerekce,createdAt:r.createdAt,gecerli:c.current.some(a=>a.id===r.id)}))};
}
