import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { faturaSatirSahiplikleriniOku } from "./crm-fatura-satir-sahipligi";
import { kapamaPayiKaynak, payOzeti } from "./crm-kapama-paylari";

const D=(v:Prisma.Decimal.Value)=>new Prisma.Decimal(v);
function sinir(rows:unknown[]){if(rows.length>5000)throw new ConflictException('Ticari iade dağıtımı 5000 kayıt sınırını aşıyor');}
export const karmaIadeKaniti=(sources:{id:string;proof:string|null;header:unknown}[],f:unknown,refs:unknown[],rows:unknown[])=>payOzeti({sources,f,refs,rows});
export const karmaIadeKaynakKaniti=(invoice:unknown,ownership:{f:unknown;lines:unknown[];path:unknown[];links:unknown[];satirSahipleri:unknown[]})=>payOzeti({invoice,ownership});

/** Kaynak faturalar arasında elle belirtilen, fırsat ve kaynak kapsamlı iade payları. */
export async function iadePaylariniOku(tx:Prisma.TransactionClient,tenantId:string,cariId:string,firsatId:string,faturaId:string){
 const source=await kapamaPayiKaynak(tx,tenantId,cariId,firsatId,faturaId);
 const header=await tx.fatura.findFirstOrThrow({where:{id:faturaId,tenantId,cariId},select:{toplamMatrah:true}});
 const lines=await tx.faturaSatir.findMany({where:{tenantId,faturaId},select:{id:true,matrah:true},orderBy:{id:'asc'},take:5001});sinir(lines);
 const ownIds=new Set(source.own.map(r=>r.id));
 const satis=lines.filter(r=>ownIds.has(r.id)).reduce((v,r)=>v.add(r.matrah),D(0));
 const valid=source.f.durum==='kesin' && source.own.length>0 && lines.every(r=>!r.matrah.isNegative()) && lines.reduce((v,r)=>v.add(r.matrah),D(0)).equals(header.toplamMatrah);
 const refs=await tx.faturaIadeReferansi.findMany({where:{tenantId,kaynakFaturaId:faturaId},select:{faturaId:true},take:5001});sinir(refs);
 const ids=[...new Set(refs.map(r=>r.faturaId))].sort();
 const iadeler=ids.length?await tx.fatura.findMany({where:{tenantId,id:{in:ids}},select:{id:true,no:true,cariId:true,tip:true,durum:true,dovizCinsi:true,toplamMatrah:true,genelToplam:true,updatedAt:true},orderBy:{id:'asc'},take:5001}):[];sinir(iadeler);
 const allRefs=ids.length?await tx.faturaIadeReferansi.findMany({where:{tenantId,faturaId:{in:ids}},select:{id:true,faturaId:true,kaynakFaturaId:true,belgeNo:true,tarih:true},orderBy:{id:'asc'},take:5001}):[];sinir(allRefs);
 const refsByReturn=new Map<string,typeof allRefs>();for(const row of allRefs){const bucket=refsByReturn.get(row.faturaId)??[];bucket.push(row);refsByReturn.set(row.faturaId,bucket);}
 const sourceIds=[...new Set(allRefs.flatMap(r=>r.kaynakFaturaId?[r.kaynakFaturaId]:[]))].sort();sinir(sourceIds);
 const sourceHeaders=sourceIds.length?await tx.fatura.findMany({where:{tenantId,id:{in:sourceIds}},select:{id:true,no:true,cariId:true,tip:true,durum:true,dovizCinsi:true,toplamMatrah:true,genelToplam:true},take:5001}):[];sinir(sourceHeaders);
 const sourceHeaderMap=new Map(sourceHeaders.map(f=>[f.id,f]));
 const ownership=await faturaSatirSahiplikleriniOku(tx,tenantId,cariId,sourceIds);
 const returnLines=ids.length?await tx.faturaSatir.findMany({where:{tenantId,faturaId:{in:ids}},select:{id:true,faturaId:true,matrah:true,toplamTutar:true},orderBy:{id:'asc'},take:5001}):[];sinir(returnLines);
 const linesByReturn=new Map<string,typeof returnLines>();for(const row of returnLines){const bucket=linesByReturn.get(row.faturaId)??[];bucket.push(row);linesByReturn.set(row.faturaId,bucket);}
 const history=await tx.firsatIadePayi.findMany({where:{tenantId,OR:[{faturaId},{iadeFaturaId:{in:ids}}]},orderBy:{surum:'desc'},take:5001});sinir(history);
 const latest=new Map<string,typeof history[number]>();for(const r of history){const key=r.faturaId+':'+r.iadeFaturaId+':'+r.firsatId;if(!latest.has(key))latest.set(key,r);}
 const sourceProof=(id:string)=>{
  const own=ownership.get(id); if(!own)return null;
  const f=sourceHeaderMap.get(id); if(!f)return null;
  const headerProof={toplamMatrah:f.toplamMatrah};
  const ownedLines=own.satirSahipleri.map(r=>({id:r.satirId,matrah:r.matrah}));
  return {proof:karmaIadeKaynakKaniti(f,{f:own.f,lines:own.lines,path:own.path,links:own.links,satirSahipleri:own.satirSahipleri}),header:headerProof,lines:ownedLines};
 };
 const candidates=iadeler.map(f=>{
  const r=refsByReturn.get(f.id)??[],rows=linesByReturn.get(f.id)??[];
  const distinctSources=[...new Set(r.flatMap(x=>x.kaynakFaturaId?[x.kaynakFaturaId]:[]))].sort();
  const sources=distinctSources.map(id=>({id,header:sourceHeaderMap.get(id),ownership:ownership.get(id),proof:sourceProof(id)}));
  const sourceValid=r.length>0 && r.every(x=>!!x.kaynakFaturaId) && distinctSources.length===r.length && sources.every(x=>{
   if(!x.header||x.header.cariId!==cariId||x.header.tip!=='satis'||x.header.durum!=='kesin'||x.header.dovizCinsi!==f.dovizCinsi||!x.ownership||!x.proof||!x.ownership.lines.length||x.ownership.lines.some(line=>line.toplamTutar.isNegative())||x.ownership.satirSahipleri.some(line=>line.matrah.isNegative()))return false;
   const matrah=x.ownership.satirSahipleri.reduce((v,line)=>v.add(line.matrah),D(0));
   const brut=x.ownership.lines.reduce((v,line)=>v.add(line.toplamTutar),D(0));
   return matrah.equals(x.header.toplamMatrah)&&brut.equals(x.header.genelToplam);
  });
  const gecerli=sourceValid && f.cariId===cariId && f.tip==='satis_iade' && f.durum==='kesin' && rows.length>0 && rows.every(x=>!x.matrah.isNegative()&&!x.toplamTutar.isNegative()) && rows.reduce((v,x)=>v.add(x.matrah),D(0)).equals(f.toplamMatrah) && rows.reduce((v,x)=>v.add(x.toplamTutar),D(0)).equals(f.genelToplam);
  const kanitOzeti=distinctSources.length===1&&distinctSources[0]===faturaId
   ? payOzeti({source:source.kanitOzeti,header,lines,f,refs:r,rows})
   : karmaIadeKaniti(sources.map(x=>({id:x.id,proof:x.proof?.proof??null,header:x.header})),f,r,rows);
  return {...f,gecerli,kanitOzeti,kaynakFaturalar:sources.map(x=>({id:x.id,no:x.header?.no??null}))};
 });
 const candidateMap=new Map(candidates.map(i=>[i.id,i]));
 const sourceSetByReturn=new Map([...refsByReturn].map(([id,rows])=>[id,new Set(rows.flatMap(row=>row.kaynakFaturaId?[row.kaynakFaturaId]:[]))]));
 const current=[...latest.values()].filter(r=>{const i=candidateMap.get(r.iadeFaturaId);return r.cariId===cariId&&!!i?.gecerli&&i.kanitOzeti===r.kanitOzeti&&sourceSetByReturn.get(i.id)?.has(r.faturaId)===true;});
 const currentByReturn=new Map<string,typeof current>();for(const row of current){const bucket=currentByReturn.get(row.iadeFaturaId)??[];bucket.push(row);currentByReturn.set(row.iadeFaturaId,bucket);}
 const currentById=new Map(current.map(row=>[row.id,row]));
 const currentIds=new Set(currentById.keys());
 const opportunityHistory=history.filter(row=>row.firsatId===firsatId);
 const sourceOwnerCapacity=new Map<string,Prisma.Decimal>();
 for(const [sourceId,own] of ownership)for(const row of own.satirSahipleri)if(row.firsatId){const key=sourceId+':'+row.firsatId;sourceOwnerCapacity.set(key,(sourceOwnerCapacity.get(key)??D(0)).add(row.matrah));}
 const capacity=(sourceId:string,ownerId:string)=>sourceOwnerCapacity.get(sourceId+':'+ownerId)??D(0);
 const allocatedBySourceOwner=new Map<string,Prisma.Decimal>();
 for(const row of current){const key=row.faturaId+':'+row.firsatId;allocatedBySourceOwner.set(key,(allocatedBySourceOwner.get(key)??D(0)).add(row.matrah));}
 const invalidCapacityKeys=new Set([...allocatedBySourceOwner].flatMap(([key,total])=>{
  const [sourceId,ownerId]=key.split(':');return total.gt(capacity(sourceId,ownerId))?[key]:[];
 }));
 const allocationInvalid=current.some(r=>r.matrah.isNegative())||invalidCapacityKeys.size>0;
 const ownKey=faturaId+':'+firsatId;
 const ownTotal=allocatedBySourceOwner.get(ownKey)??D(0);
 const closings=await tx.faturaKapama.findMany({where:{tenantId,cariId,faturaId,iadeFaturaId:{not:null}},select:{iadeFaturaId:true},take:5001});sinir(closings);
 const invalidClosing=closings.some(k=>!k.iadeFaturaId||!candidateMap.get(k.iadeFaturaId)?.gecerli);
 const kesin=candidates.filter(i=>i.durum==='kesin');
 const dagitimTam=valid&&!invalidClosing&&!allocationInvalid&&ownTotal.lte(satis)&&kesin.every(i=>i.gecerli&&(currentByReturn.get(i.id)??[]).reduce((v,r)=>v.add(r.matrah),D(0)).equals(i.toplamMatrah));
 return {
  hasHistory:opportunityHistory.length>0,historyCount:history.length,
  view:{fatura:{id:faturaId,no:source.f.no,dovizCinsi:source.f.dovizCinsi},
   sonuc:{durum:dagitimTam?'tam':'eksik_veya_gecersiz',satisMatrahi:valid?satis.toFixed(2):null,belirtilenIadeMatrahi:ownTotal.toFixed(2),netMatrah:dagitimTam?satis.sub(ownTotal).toFixed(2):null},
   iadeler:candidates.map(i=>{
    const old=latest.get(faturaId+':'+i.id+':'+firsatId),active=old?currentById.get(old.id):undefined;
    const returnRows=currentByReturn.get(i.id)??[],dagitilan=returnRows.reduce((v,r)=>v.add(r.matrah),D(0));
    const returnCapacityInvalid=returnRows.some(row=>row.matrah.isNegative()||invalidCapacityKeys.has(row.faturaId+':'+row.firsatId));
    const dagitimDurumu=!i.gecerli||returnCapacityInvalid||dagitilan.gt(i.toplamMatrah)?'gecersiz':dagitilan.equals(i.toplamMatrah)?'tam':'eksik';
    const others=returnRows.filter(r=>r.faturaId!==faturaId||r.firsatId!==firsatId).reduce((v,r)=>v.add(r.matrah),D(0));
    // Mevcut pay zaten toplamdan çıkarıldı; satış kapasitesine yeniden eklenmez.
    const usedOnSource=Prisma.Decimal.max((allocatedBySourceOwner.get(ownKey)??D(0)).sub(active?.matrah??0),0);
    const roomForReturn=Prisma.Decimal.max(i.toplamMatrah.sub(others),0),roomForSale=Prisma.Decimal.max(satis.sub(usedOnSource),0);
    const max=Prisma.Decimal.min(roomForReturn,roomForSale,capacity(faturaId,firsatId).sub(usedOnSource));
    return {id:i.id,no:i.no,durum:i.durum,matrah:i.toplamMatrah.toFixed(2),dagitilanMatrah:dagitilan.toFixed(2),kalanMatrah:Prisma.Decimal.max(i.toplamMatrah.sub(dagitilan),0).toFixed(2),dagitimDurumu,gecerli:i.gecerli,kanitOzeti:i.kanitOzeti,surum:old?.surum??0,pay:active?.matrah.toFixed(2)??null,azamiMatrah:i.gecerli?Prisma.Decimal.max(max,0).toFixed(2):'0.00',gecersizEskiPay:!!old&&!active,kaynakFaturalar:i.kaynakFaturalar};
   }),
   gecmis:opportunityHistory.filter(r=>r.faturaId===faturaId).map(r=>({id:r.id,iadeFaturaId:r.iadeFaturaId,surum:r.surum,matrah:r.matrah.toFixed(2),gerekce:r.gerekce,gecerli:currentIds.has(r.id)}))},
 };
}
