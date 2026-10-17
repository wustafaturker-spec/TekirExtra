import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

const D = (n: Prisma.Decimal | string | number) => new Prisma.Decimal(n);
function sinir(rows: unknown[]) { if (rows.length > 5000) throw new ConflictException("Ticari sonuç 5000 satır sınırını aşıyor; eksik sonuç gösterilmedi"); }

/** Başlık, stok veya tutar benzerliği kaynak satır kanıtının yerine geçmez. */
export async function ticariSonucuOku(tx: Prisma.TransactionClient, tenantId: string, cariId: string, teklifIds: string[], belgeIds: string[], faturaIds: string[]) {
 if (!faturaIds.length) return [];
 const docs = await tx.belge.findMany({ where: { tenantId, cariId, yon: "satis", id: { in: [...teklifIds, ...belgeIds] } }, select: { id:true, tur:true, durum:true, kaynakBelgeId:true, faturaId:true, dovizCinsi:true } });
 const rows = await tx.belgeSatir.findMany({ where: { tenantId, belgeId: { in: docs.map(d=>d.id) } }, select: { id:true, belgeId:true, stokId:true, kaynakSatirId:true }, take:5001 });sinir(rows);
 const invoices = await tx.fatura.findMany({ where: { tenantId, cariId, tip:"satis", id:{in:faturaIds} }, select:{id:true,no:true,durum:true,dovizCinsi:true,genelToplam:true}, orderBy:{id:"asc"} });
 const invoiceRows = await tx.faturaSatir.findMany({ where:{tenantId,faturaId:{in:invoices.map(f=>f.id)}}, select:{id:true,faturaId:true,kaynakBelgeSatirId:true,stokId:true,toplamTutar:true},take:5001 });sinir(invoiceRows);
 const closings = await tx.faturaKapama.findMany({where:{tenantId,cariId,faturaId:{in:invoices.filter(f=>f.durum==="kesin").map(f=>f.id)}},select:{faturaId:true,tutar:true,kasaBankaHareketId:true,iadeFaturaId:true,krediKartiHareketId:true,cekSenetId:true,
  kasaBankaHareket:{select:{tenantId:true,cariId:true,tip:true}},iadeFatura:{select:{tenantId:true,cariId:true,tip:true,durum:true}},krediKartiHareket:{select:{tenantId:true,cariId:true}},cekSenet:{select:{tenantId:true,cariId:true}}},take:5001});sinir(closings);
 const docMap=new Map(docs.map(d=>[d.id,d])),rowMap=new Map(rows.map(r=>[r.id,r])),roots=new Set(teklifIds);
 const kanitli = (sourceId:string,invoiceId:string,stokId:string,dovizCinsi:string) => {
  let row=rowMap.get(sourceId);const source=row && docMap.get(row.belgeId);
  if (!source || source.faturaId!==invoiceId || source.dovizCinsi!==dovizCinsi || !["siparis","irsaliye"].includes(source.tur)) return false;
  for(let depth=0;row && depth<3;depth++) {
   const doc=docMap.get(row.belgeId);if(!doc || doc.durum==="iptal" || row.stokId!==stokId)return false;
   if(doc.tur==="teklif")return roots.has(doc.id);
   const parent=row.kaynakSatirId ? rowMap.get(row.kaynakSatirId) : undefined;
   if(!parent || doc.kaynakBelgeId!==parent.belgeId)return false;
   const parentDoc=docMap.get(parent.belgeId);
   if(!parentDoc || !(doc.tur==="irsaliye" && parentDoc.tur==="siparis" || doc.tur==="siparis" && parentDoc.tur==="teklif"))return false;
   row=parent;
  }
  return false;
 };
 return invoices.map(f=>{
  const lines=invoiceRows.filter(r=>r.faturaId===f.id),counts=new Map<string,number>();
  for(const r of lines)if(r.kaynakBelgeSatirId)counts.set(r.kaynakBelgeSatirId,(counts.get(r.kaynakBelgeSatirId)??0)+1);
  const tutarTutarli=lines.every(r=>!r.toplamTutar.isNegative()) && lines.reduce((a,r)=>a.add(r.toplamTutar),D(0)).equals(f.genelToplam);
  const matched=tutarTutarli ? lines.filter(r=>r.kaynakBelgeSatirId && counts.get(r.kaynakBelgeSatirId)===1 && kanitli(r.kaynakBelgeSatirId,f.id,r.stokId,f.dovizCinsi)) : [];
  const pay=matched.reduce((a,r)=>a.add(r.toplamTutar),D(0));
  const complete=lines.length>0 && matched.length===lines.length && pay.equals(f.genelToplam);
  let kasa=D(0),iade=D(0),diger=D(0),valid=true;
  for(const k of closings.filter(k=>k.faturaId===f.id)) {
   const ids=[k.kasaBankaHareketId,k.iadeFaturaId,k.krediKartiHareketId,k.cekSenetId].filter(Boolean);
   const s=k.kasaBankaHareket??k.iadeFatura??k.krediKartiHareket??k.cekSenet;
   if(ids.length!==1 || !s || s.tenantId!==tenantId || s.cariId!==cariId || k.tutar.isNegative()) {valid=false;continue;}
   if(k.kasaBankaHareket) {if(k.kasaBankaHareket.tip!=="tahsilat")valid=false;else kasa=kasa.add(k.tutar);}
   else if(k.iadeFatura) {if(k.iadeFatura.tip!=="satis_iade" || k.iadeFatura.durum!=="kesin")valid=false;else iade=iade.add(k.tutar);}
   else diger=diger.add(k.tutar);
  }
  const kalan=f.genelToplam.sub(kasa).sub(iade).sub(diger);
  const kapamaTam=f.durum==="kesin" && complete && valid && !kalan.isNegative();
  return {id:f.id,no:f.no,durum:f.durum,dovizCinsi:f.dovizCinsi,
   faturaPayi:f.durum==="kesin" && matched.length ? pay.toFixed(2) : null,
   payKapsami:f.durum!=="kesin" ? "kesin_degil" : !matched.length ? "dagitilamadi" : complete ? "tam" : "kismi",
   payDisiVeyaBelirsizSatirSayisi:lines.length-matched.length,
   kapama:{durum:kapamaTam?"tam":"dagitilamadi",kasaBanka:kapamaTam?kasa.toFixed(2):null,iade:kapamaTam?iade.toFixed(2):null,diger:kapamaTam?diger.toFixed(2):null,kalan:kapamaTam?kalan.toFixed(2):null}};
 });
}
