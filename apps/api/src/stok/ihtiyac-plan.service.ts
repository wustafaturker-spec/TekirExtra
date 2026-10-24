import {ihtiyacErisiminiDogrula} from './ihtiyac-erisim';
import { BadRequestException,ConflictException,ForbiddenException,Inject,Injectable,NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { aktifBaglam } from '../core/istek-baglami';
import { PrismaService } from '../core/prisma.service';
import { IhtiyacService,ihtiyacOnizlemeSemasi } from './ihtiyac.service';
import { ihtiyacSonucKaniti } from './ihtiyac-sonuc-kaniti';
const sema=z.object({istekAnahtari:z.uuid(),beklenenSonucKaniti:z.string().regex(/^[a-f0-9]{64}$/),girdi:ihtiyacOnizlemeSemasi}).strict();
@Injectable()
export class IhtiyacPlanService{
 constructor(@Inject(PrismaService) private readonly prisma:PrismaService,@Inject(IhtiyacService) private readonly ihtiyac:IhtiyacService){}
 private baglam(){const b=aktifBaglam();if(!['yonetici','muhasebe','depo'].includes(b.rol))throw new ForbiddenException('İhtiyaç planı için yetkiniz yok');return b;}
 async listele(sorgu:unknown){
  const {tenantId}=this.baglam(),p=z.object({imlec:z.uuid().optional()}).strict().safeParse(sorgu);
  if(!p.success)throw new BadRequestException('Geçersiz plan listesi sorgusu');
  return this.prisma.tenantIslem(tenantId,async tx=>{
   await ihtiyacErisiminiDogrula(tx);
   const imlec=p.data.imlec?await tx.ihtiyacPlani.findFirst({where:{id:p.data.imlec,tenantId},select:{id:true,createdAt:true}}):null;
   if(p.data.imlec&&!imlec)throw new ConflictException('Plan listesi değişti; baştan yükleyin');
   // Büyük snapshot'ları listeye taşımadan tarihsel etiketleri DB'de çıkar.
   const satirlar=await tx.$queryRaw<{id:string;createdAt:Date;stokKod:string;stokAd:string;depoAd:string;anaBirim:string;miktar:string;ihtiyacTarihi:string}[]>(Prisma.sql`
    SELECT id,created_at AS "createdAt",snapshot#>>'{stok,kod}' AS "stokKod",snapshot#>>'{stok,ad}' AS "stokAd",
     snapshot#>>'{depo,ad}' AS "depoAd",snapshot#>>'{stok,anaBirim}' AS "anaBirim",snapshot#>>'{hesap,talep}' AS miktar,
     girdi->>'ihtiyacTarihi' AS "ihtiyacTarihi"
    FROM ihtiyac_planlari WHERE tenant_id=${tenantId}::uuid
     ${imlec?Prisma.sql`AND (created_at,id)<(${imlec.createdAt.toISOString().slice(0,-1)}::timestamp,${imlec.id}::uuid)`:Prisma.empty}
    ORDER BY created_at DESC,id DESC LIMIT 21`);
   return {kayitlar:satirlar.slice(0,20),sonrakiImlec:satirlar.length>20?satirlar[19].id:null};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
 async kaydet(body:unknown){
  const {tenantId,userId}=this.baglam(),p=sema.safeParse(body);if(!p.success)throw new BadRequestException(p.error.issues.map(e=>e.message).join('; '));const g=p.data;
  const istekOzeti=createHash('sha256').update(JSON.stringify([userId,g.beklenenSonucKaniti,g.girdi])).digest('hex');
  const tekrar=(plan:{istekOzeti:string})=>{if(plan.istekOzeti!==istekOzeti)throw new ConflictException('İstek anahtarı başka bir plan girdisiyle kullanılmış');return plan;};
  try{return await this.prisma.tenantIslem(tenantId,async tx=>{
   await ihtiyacErisiminiDogrula(tx,true);
   const eski=await tx.ihtiyacPlani.findUnique({where:{tenantId_istekAnahtari:{tenantId,istekAnahtari:g.istekAnahtari}},include:{karsilamaBaglari:true}});if(eski){tekrar(eski);return eski;}
   const sonuc=await this.ihtiyac.onizle(g.girdi,true,tx);
   if(!('tarihli' in sonuc)||!sonuc.tarihli.veriYeterli)throw new ConflictException('Eksik kaynaklı ihtiyaç planı saklanamaz; üretim atamalarını doğrulayın');
   if(ihtiyacSonucKaniti({...sonuc,tarihli:sonuc.tarihli})!==g.beklenenSonucKaniti)throw new ConflictException('İhtiyaç kaynakları değişti; önizlemeyi yenileyin');
   const {karsilama}=sonuc.tarihli;
   const plan=await tx.ihtiyacPlani.create({data:{tenantId,userId,istekAnahtari:g.istekAnahtari,istekOzeti,sonucKaniti:g.beklenenSonucKaniti,girdi:g.girdi,snapshot:JSON.parse(JSON.stringify(sonuc)) as Prisma.InputJsonValue,
    karsilamaBaglari:{create:karsilama.baglar.map(b=>({tur:b.tur,kaynakId:b.kaynakId,miktar:b.miktar}))}},include:{karsilamaBaglari:true}});
   await tx.auditLog.create({data:{tenantId,userId,islem:'ihtiyac_plani_saklandi',varlik:'ihtiyac_plani',varlikId:plan.id,detay:{surum:1,sonucKaniti:plan.sonucKaniti,karsilamaBagSayisi:karsilama.baglar.length}}});
   return plan;
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000});}
  catch(e){
   if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002'){
    const plan=await this.prisma.tenantIslem(tenantId,async tx=>{await ihtiyacErisiminiDogrula(tx,true);return tx.ihtiyacPlani.findUnique({where:{tenantId_istekAnahtari:{tenantId,istekAnahtari:g.istekAnahtari}},include:{karsilamaBaglari:true}});});
    if(plan){tekrar(plan);return plan;}
   }
   throw e;
  }
 }
 async oku(id:string){
  const {tenantId}=this.baglam();if(!z.uuid().safeParse(id).success)throw new BadRequestException('Geçersiz plan');
  return this.prisma.tenantIslem(tenantId,async tx=>{
   const erisim=await ihtiyacErisiminiDogrula(tx);
   const plan=await tx.ihtiyacPlani.findFirst({where:{id,tenantId},include:{karsilamaBaglari:true,satinAlmaBagi:{select:{talepId:true}}}});if(!plan)throw new NotFoundException('İhtiyaç planı bulunamadı');
   try{const sonuc=await this.ihtiyac.onizle(plan.girdi,true,tx);return {...plan,erisim,guncel:'tarihli' in sonuc&&ihtiyacSonucKaniti(sonuc)===plan.sonucKaniti};}
   catch(e){if(e instanceof BadRequestException||e instanceof NotFoundException||e instanceof ConflictException)return {...plan,erisim,guncel:false,neden:'Kaynak veya ihtiyaç günü artık doğrulanamıyor'};throw e;}
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:15000});
 }
}
