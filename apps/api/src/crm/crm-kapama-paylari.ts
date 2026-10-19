import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { faturaSatirSahiplikleriniOku } from "./crm-fatura-satir-sahipligi";

type Tx=Prisma.TransactionClient;
const D=(v:Prisma.Decimal.Value)=>new Prisma.Decimal(v);
export const payOzeti=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function sinir(n:number){if(n>5000)throw new ConflictException('Kapama dağıtımı 5000 kayıt sınırını aşıyor; eksik sonuç gösterilmedi');}

/** Faturanın bütün kaynak yolları hash'e girer: sahiplik değişince eski paylar kullanılmaz. */
export async function kapamaPayiKaynak(tx:Tx,tenantId:string,cariId:string,firsatId:string,faturaId:string){
 const f=await tx.fatura.findFirst({where:{id:faturaId,tenantId,cariId,tip:'satis'},select:{id:true,no:true,durum:true,dovizCinsi:true,genelToplam:true,updatedAt:true}});
 if(!f)throw new NotFoundException('Bu fırsatın carisine ait satış faturası bulunamadı');
 const sahiplik=await faturaSatirSahiplikleriniOku(tx,tenantId,cariId,[faturaId]);
 const kanit=sahiplik.get(faturaId);if(!kanit)throw new NotFoundException('Bu fırsatın carisine ait satış faturası bulunamadı');
 const lines=kanit.lines,path=kanit.path,links=kanit.links;
 const counts=new Map<string,number>();for(const r of lines)if(r.kaynakBelgeSatirId)counts.set(r.kaynakBelgeSatirId,(counts.get(r.kaynakBelgeSatirId)??0)+1);
 const consistent=f.durum==='kesin' && lines.length>0 && lines.every(r=>!r.toplamTutar.isNegative()) && lines.reduce((v,r)=>v.add(r.toplamTutar),D(0)).equals(f.genelToplam);
 const ownerMap=new Map(kanit.satirSahipleri.map(r=>[r.satirId,r.firsatId]));
 const own=consistent?lines.filter(r=>r.kaynakBelgeSatirId && counts.get(r.kaynakBelgeSatirId)===1 && ownerMap.get(r.id)===firsatId):[];
 const pay=own.reduce((v,r)=>v.add(r.toplamTutar),D(0));
 const kanitOzeti=payOzeti({f,lines,path,links});
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
 const satirSahiplik=consistent?kanit.satirSahipleri.map(s=>({satirId:s.satirId,firsatId:s.firsatId,matrah:s.matrah})):[];
 return {f,kanitOzeti,pay,own,satirSahiplik,kapamalar,history,latest,current,ownTotal};
}

export type PayKaynak=Awaited<ReturnType<typeof kapamaPayiKaynak>>;
/** Eksik dağıtım sıfır tahsilat değildir; kalan yalnız dağıtılmamış payı ifade eder. */
export function kapamaDagitimOzeti(c:Pick<PayKaynak,'pay'|'kapamalar'|'current'>,firsatId:string){
 let kasa=D(0),iade=D(0),diger=D(0),tam=true;
 const belirsiz={durum:'dagitilamadi',kasaBanka:null,iade:null,diger:null,dagitilmamisPay:null};
 if(!c.pay.gt(0))return belirsiz;
 for(const k of c.kapamalar){
  const paylar=c.current.filter(r=>r.kapamaId===k.id);
  const toplam=paylar.reduce((v,r)=>v.add(r.tutar),D(0));
  if(!k.gecerli || paylar.some(r=>r.tutar.isNegative()) || toplam.gt(k.tutar))return belirsiz;
  if(!toplam.equals(k.tutar))tam=false;
  const own=paylar.filter(r=>r.firsatId===firsatId).reduce((v,r)=>v.add(r.tutar),D(0));
  if(k.tur==='kasa_banka')kasa=kasa.add(own);
  else if(k.tur==='iade')iade=iade.add(own);
  else diger=diger.add(own);
 }
 const kalan=c.pay.sub(kasa).sub(iade).sub(diger);
 if(kalan.isNegative())return belirsiz;
 return {durum:tam?'tam':'kismi',kasaBanka:kasa.toFixed(2),iade:iade.toFixed(2),diger:diger.toFixed(2),dagitilmamisPay:kalan.toFixed(2)};
}
export function kapamaPayiGorunumu(c:PayKaynak,firsatId:string){
 return {fatura:{id:c.f.id,no:c.f.no,dovizCinsi:c.f.dovizCinsi},kanitOzeti:c.kanitOzeti,faturaPayi:c.pay.toFixed(2),dagitilanToplam:c.ownTotal.toFixed(2),ozet:kapamaDagitimOzeti(c,firsatId),
  kapamalar:c.kapamalar.map(k=>{
   const old=c.latest.get(k.id+':'+firsatId),active=c.current.find(r=>r.id===old?.id);
   const others=c.current.filter(r=>r.kapamaId===k.id && r.firsatId!==firsatId).reduce((v,r)=>v.add(r.tutar),D(0));
   const otherOwn=c.ownTotal.sub(active?.tutar??0);
   const max=Prisma.Decimal.max(Prisma.Decimal.min(k.tutar.sub(others),c.pay.sub(otherOwn)),0);
   return {id:k.id,tur:k.tur,tutar:k.tutar.toFixed(2),kaynakOzeti:k.kaynakOzeti,gecerli:k.gecerli,surum:old?.surum??0,pay:active?.tutar.toFixed(2)??null,azamiTutar:k.gecerli?max.toFixed(2):'0.00',gecersizEskiPay:!!old && !active};
  }),gecmis:c.history.filter(r=>r.firsatId===firsatId).map(r=>({id:r.id,kapamaId:r.kapamaId,surum:r.surum,tutar:r.tutar.toFixed(2),gerekce:r.gerekce,createdAt:r.createdAt,gecerli:c.current.some(a=>a.id===r.id)}))};
}
