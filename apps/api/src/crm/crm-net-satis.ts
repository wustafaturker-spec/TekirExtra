import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { faturaSatirSahiplikleriniOku } from "./crm-fatura-satir-sahipligi";
import { karmaIadeKaniti, karmaIadeKaynakKaniti } from "./crm-iade-paylari";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
function sinir(rows: unknown[]) {
 if (rows.length > 5000) throw new ConflictException("Satış/iade sonucu 5000 kayıt sınırını aşıyor; eksik sonuç gösterilmedi");
}
export const belirsizNetSatis = (neden: string) => ({
 durum: "dagitilamadi", neden, satisMatrahi: null, iadeMatrahi: null, netMatrah: null,
});

/** Kaynak sahipliği ve manuel dağıtım birlikte doğrulanmadan çok kaynaklı iade net satışa girmez. */
export async function referansliIadeleriOku(tx: Prisma.TransactionClient, tenantId: string, cariId: string, faturaIds: string[]) {
 const refs = await tx.faturaIadeReferansi.findMany({
  where: { tenantId, kaynakFaturaId: { in: faturaIds } },
  select: { kaynakFaturaId: true, fatura: { select: { id: true, tenantId: true, cariId: true, tip: true, durum: true, dovizCinsi: true, toplamMatrah: true, genelToplam: true } } }, take: 5001,
 });
 sinir(refs);
 const ids = [...new Set(refs.filter(r => r.fatura.durum === "kesin").map(r => r.fatura.id))].sort();
 const allRefs = ids.length ? await tx.faturaIadeReferansi.findMany({ where: { tenantId, faturaId: { in: ids } }, select: { id:true,faturaId:true,kaynakFaturaId:true,belgeNo:true,tarih:true }, orderBy:{id:"asc"}, take: 5001 }) : [];
 sinir(allRefs);
 const returns = ids.length ? await tx.fatura.findMany({ where:{tenantId,id:{in:ids}}, select:{id:true,no:true,cariId:true,tip:true,durum:true,dovizCinsi:true,toplamMatrah:true,genelToplam:true,updatedAt:true}, orderBy:{id:"asc"}, take:5001 }) : [];
 sinir(returns);
 const returnMap = new Map(returns.map(f=>[f.id,f]));
 const lines = ids.length ? await tx.faturaSatir.findMany({ where: { tenantId, faturaId: { in: ids } }, select: { id: true, faturaId: true, matrah: true, toplamTutar: true }, orderBy:{id:"asc"}, take: 5001 }) : [];
 sinir(lines);
 const refsBySource=new Map<string,typeof refs>();for(const row of refs){if(!row.kaynakFaturaId)continue;const bucket=refsBySource.get(row.kaynakFaturaId)??[];bucket.push(row);refsBySource.set(row.kaynakFaturaId,bucket);}
 const allRefsByReturn=new Map<string,typeof allRefs>();for(const row of allRefs){const bucket=allRefsByReturn.get(row.faturaId)??[];bucket.push(row);allRefsByReturn.set(row.faturaId,bucket);}
 const linesByReturn=new Map<string,typeof lines>();for(const row of lines){const bucket=linesByReturn.get(row.faturaId)??[];bucket.push(row);linesByReturn.set(row.faturaId,bucket);}
 const sourceIds = [...new Set(allRefs.flatMap(r=>r.kaynakFaturaId?[r.kaynakFaturaId]:[]))].sort();
 sinir(sourceIds);
 const sourceInvoices = sourceIds.length ? await tx.fatura.findMany({where:{tenantId,id:{in:sourceIds}},select:{id:true,no:true,cariId:true,tip:true,durum:true,dovizCinsi:true,toplamMatrah:true,genelToplam:true},orderBy:{id:"asc"},take:5001}) : [];
 sinir(sourceInvoices);
 const sourceMap = new Map(sourceInvoices.map(f=>[f.id,f]));
 const ownership = await faturaSatirSahiplikleriniOku(tx,tenantId,cariId,sourceIds);
 const history = ids.length ? await tx.firsatIadePayi.findMany({where:{tenantId,iadeFaturaId:{in:ids}},orderBy:{surum:"desc"},take:5001}) : [];
 sinir(history);
 const latest = new Map<string,typeof history[number]>();
 for(const row of history){const key=row.faturaId+":"+row.iadeFaturaId+":"+row.firsatId;if(!latest.has(key))latest.set(key,row);}

 const sourceProof=(id:string)=>{
  const invoice=sourceMap.get(id),own=ownership.get(id);if(!invoice||!own)return null;
  return karmaIadeKaynakKaniti(invoice,{f:own.f,lines:own.lines,path:own.path,links:own.links,satirSahipleri:own.satirSahipleri});
 };
 const multi = new Map<string,{valid:boolean;complete:boolean}>();
 const current:typeof history[number][]=[];
 for(const id of ids){
  const f=returnMap.get(id);if(!f)continue;
  const returnRefs=allRefsByReturn.get(id)??[],returnLines=linesByReturn.get(id)??[];
  const sourceIdsForReturn=[...new Set(returnRefs.flatMap(r=>r.kaynakFaturaId?[r.kaynakFaturaId]:[]))].sort();
  if(sourceIdsForReturn.length<=1)continue;
  const sources=sourceIdsForReturn.map(sourceId=>({id:sourceId,invoice:sourceMap.get(sourceId),ownership:ownership.get(sourceId),proof:sourceProof(sourceId)}));
  const valid=returnRefs.length>1&&returnRefs.every(r=>!!r.kaynakFaturaId)&&sourceIdsForReturn.length===returnRefs.length&&
   f.cariId===cariId&&f.tip==="satis_iade"&&f.durum==="kesin"&&
   sources.every(s=>{
    const invoice=s.invoice,own=s.ownership;
    if(!invoice||invoice.cariId!==cariId||invoice.tip!=="satis"||invoice.durum!=="kesin"||invoice.dovizCinsi!==f.dovizCinsi||!own||!s.proof||!own.lines.length||own.lines.some(line=>line.toplamTutar.isNegative())||own.satirSahipleri.some(line=>line.matrah.isNegative()))return false;
    return own.satirSahipleri.reduce((sum,line)=>sum.add(line.matrah),D(0)).equals(invoice.toplamMatrah)&&own.lines.reduce((sum,line)=>sum.add(line.toplamTutar),D(0)).equals(invoice.genelToplam);
   })&&returnLines.length>0&&returnLines.every(line=>!line.matrah.isNegative()&&!line.toplamTutar.isNegative())&&
   returnLines.reduce((sum,line)=>sum.add(line.matrah),D(0)).equals(f.toplamMatrah)&&returnLines.reduce((sum,line)=>sum.add(line.toplamTutar),D(0)).equals(f.genelToplam);
  const digest=karmaIadeKaniti(sources.map(s=>({id:s.id,proof:s.proof,header:s.invoice??null})),f,returnRefs,returnLines);
  const refSet=new Set(sourceIdsForReturn);
  for(const row of latest.values())if(row.cariId===cariId&&row.iadeFaturaId===id&&refSet.has(row.faturaId)&&row.kanitOzeti===digest&&valid)current.push(row);
  multi.set(id,{valid,complete:false});
 }
 const currentByReturn=new Map<string,typeof current>();for(const row of current){const bucket=currentByReturn.get(row.iadeFaturaId)??[];bucket.push(row);currentByReturn.set(row.iadeFaturaId,bucket);}

 const sourceOwnerCapacity=new Map<string,Prisma.Decimal>();
 for(const [sourceId,own] of ownership)for(const row of own.satirSahipleri)if(row.firsatId){const key=sourceId+":"+row.firsatId;sourceOwnerCapacity.set(key,(sourceOwnerCapacity.get(key)??D(0)).add(row.matrah));}
 const capacity=(sourceId:string,ownerId:string)=>sourceOwnerCapacity.get(sourceId+":"+ownerId)??D(0);
 const totals=new Map<string,Prisma.Decimal>();
 for(const row of current){const key=row.faturaId+":"+row.firsatId;totals.set(key,(totals.get(key)??D(0)).add(row.matrah));}
 const invalidCapacityKeys=new Set([...totals].flatMap(([key,sum])=>{const [sourceId,ownerId]=key.split(":");return sum.gt(capacity(sourceId,ownerId))?[key]:[];}));
 for(const [id,state] of multi){
  const f=returnMap.get(id)!;
  const returnRows=currentByReturn.get(id)??[];
  const total=returnRows.reduce((sum,row)=>sum.add(row.matrah),D(0));
  const invalidCapacity=returnRows.some(row=>row.matrah.isNegative()||invalidCapacityKeys.has(row.faturaId+":"+row.firsatId));
  state.complete=state.valid&&!invalidCapacity&&total.equals(f.toplamMatrah);
 }

 return (faturaId: string, dovizCinsi: string, satisMatrahi: Prisma.Decimal, kapamaIadeIds: string[], firsatId:string) => {
  const relevant = (refsBySource.get(faturaId)??[]).filter(r => r.fatura.durum === "kesin");
  const seen = new Set<string>();
  let iade = D(0);
  for (const { fatura: f } of relevant) {
   if (seen.has(f.id)) return belirsizNetSatis("iade_referansi_belirsiz");
   seen.add(f.id);
   const sources = allRefsByReturn.get(f.id)??[], rows = linesByReturn.get(f.id)??[];
   if(sources.length>1){
    const state=multi.get(f.id);
    if(!state?.valid)return belirsizNetSatis("cok_kaynakli_iade_kaynagi_dogrulanamadi");
    if(!state.complete)return belirsizNetSatis("cok_kaynakli_iade_dagitim_eksik_veya_gecersiz");
    iade=iade.add((currentByReturn.get(f.id)??[]).filter(row=>row.faturaId===faturaId&&row.firsatId===firsatId).reduce((sum,row)=>sum.add(row.matrah),D(0)));
    continue;
   }
   if (f.tenantId !== tenantId || f.cariId !== cariId || f.tip !== "satis_iade" || f.dovizCinsi !== dovizCinsi || sources.length !== 1 || sources[0].kaynakFaturaId !== faturaId)
    return belirsizNetSatis("iade_referansi_belirsiz");
   if (!rows.length || rows.some(r => r.matrah.isNegative() || r.toplamTutar.isNegative()) || !rows.reduce((v,r) => v.add(r.matrah), D(0)).equals(f.toplamMatrah) || !rows.reduce((v,r) => v.add(r.toplamTutar), D(0)).equals(f.genelToplam))
    return belirsizNetSatis("iade_tutarlari_tutarsiz");
   iade = iade.add(f.toplamMatrah);
  }
  if (kapamaIadeIds.some(id => !seen.has(id))) return belirsizNetSatis("kapama_iadesinin_referansi_dogrulanamadi");
  if (iade.gt(satisMatrahi)) return belirsizNetSatis("iade_satis_matrahini_asiyor");
  return { durum: "referans_kapsaminda", neden: null, satisMatrahi: satisMatrahi.toFixed(2), iadeMatrahi: iade.toFixed(2), netMatrah: satisMatrahi.sub(iade).toFixed(2) };
 };
}
