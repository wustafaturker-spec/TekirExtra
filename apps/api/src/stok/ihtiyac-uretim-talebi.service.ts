import {ihtiyacErisiminiDogrula} from './ihtiyac-erisim';
import { BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { aktifBaglam } from '../core/istek-baglami';
import { PrismaService } from '../core/prisma.service';
import { uretimTalepKaniti,uretimTalepSecimi } from './ihtiyac-uretim-kaynak';
const gun=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;});
const sema=z.object({depoId:z.uuid(),ihtiyacTarihi:gun,aktif:z.boolean(),beklenenSurum:z.number().int().min(0).max(2147483646),beklenenKaynakOzeti:z.string().regex(/^[a-f0-9]{64}$/),gerekce:z.string().trim().min(5).max(1000)}).strict();
@Injectable()
export class IhtiyacUretimTalebiService{
 constructor(private readonly prisma:PrismaService){}
 private baglam(id:string){const b=aktifBaglam();if(!['yonetici','muhasebe','depo'].includes(b.rol))throw new ForbiddenException('Üretim ihtiyaç ataması için yetkiniz yok');if(!z.uuid().safeParse(id).success)throw new BadRequestException('Geçersiz üretim kalemi');return b;}
 async oku(id:string){const {tenantId}=this.baglam(id);return this.prisma.tenantIslem(tenantId,async tx=>{const erisim=await ihtiyacErisiminiDogrula(tx);const k=await tx.uretimEmriKalem.findFirst({where:{id,tenantId},select:uretimTalepSecimi});if(!k)throw new NotFoundException('Üretim kalemi bulunamadı');return {erisim,kalemId:id,emirNo:k.uretimEmri.no,emirId:k.uretimEmriId,malzeme:{kod:k.malzeme.kod,ad:k.malzeme.ad},...uretimTalepKaniti(k),atama:k.ihtiyacTalebi};});}
 async kaydet(id:string,body:unknown){
  const {tenantId,userId}=this.baglam(id),p=sema.safeParse(body);if(!p.success)throw new BadRequestException(p.error.issues.map(e=>e.message).join('; '));const g=p.data;
  return this.prisma.tenantIslem(tenantId,async tx=>{
   await ihtiyacErisiminiDogrula(tx,true);
   const kilit=await tx.$queryRaw<{id:string}[]>`SELECT e.id FROM uretim_emirleri e JOIN uretim_emri_kalemleri k ON k.uretim_emri_id=e.id AND k.tenant_id=e.tenant_id WHERE k.tenant_id=${tenantId}::uuid AND k.id=${id}::uuid FOR UPDATE OF e`;
   if(!kilit.length)throw new NotFoundException('Üretim kalemi bulunamadı');
   await tx.$queryRaw`SELECT id FROM uretim_emri_kalemleri WHERE tenant_id=${tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
   const k=await tx.uretimEmriKalem.findFirst({where:{id,tenantId},select:uretimTalepSecimi});if(!k)throw new NotFoundException('Üretim kalemi bulunamadı');
   const h=uretimTalepKaniti(k),a=k.ihtiyacTalebi;
   if(h.kaynakOzeti!==g.beklenenKaynakOzeti)throw new ConflictException('Üretim kaynağı değişti; yeniden yükleyin');
   const depo=await tx.depo.findFirst({where:{id:g.depoId,tenantId,aktif:true},select:{id:true}});if(!depo)throw new NotFoundException('Aktif hammadde deposu bulunamadı');
   if(a&&a.surum===g.beklenenSurum+1&&a.userId===userId&&a.kaynakOzeti===h.kaynakOzeti&&a.aktif===g.aktif&&a.depoId===g.depoId&&a.ihtiyacTarihi.toISOString().slice(0,10)===g.ihtiyacTarihi&&a.gerekce===g.gerekce)return a;
   if((a?.surum??0)!==g.beklenenSurum)throw new ConflictException('Üretim ihtiyaç ataması değişti; yeniden yükleyin');
   const [zaman]=await tx.$queryRaw<{bugun:string;zaman:Date}[]>`SELECT (clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date::text AS bugun,clock_timestamp() AS zaman`;
   if(g.aktif&&(h.rezervDisi==='0.000'||g.ihtiyacTarihi<zaman.bugun))throw new BadRequestException('Rezerv dışı pozitif ihtiyaç ve bugün veya sonrası bir gün gerekir');
   const data={depoId:g.depoId,ihtiyacTarihi:new Date(g.ihtiyacTarihi+'T00:00:00Z'),aktif:g.aktif,surum:g.beklenenSurum+1,kaynakOzeti:h.kaynakOzeti,gerekce:g.gerekce,userId,guncellendiAt:zaman.zaman};
   const yeni=await tx.ihtiyacUretimTalebi.upsert({where:{tenantId_kalemId:{tenantId,kalemId:id}},create:{tenantId,kalemId:id,...data},update:data});
   await tx.auditLog.create({data:{tenantId,userId,varlik:'ihtiyac_uretim_talebi',varlikId:id,islem:'ihtiyac_uretim_talebi_atandi',detay:{oncekiSurum:a?.surum??0,surum:yeni.surum,depoId:g.depoId,ihtiyacTarihi:g.ihtiyacTarihi,aktif:g.aktif,gerekce:g.gerekce,kaynakOzeti:h.kaynakOzeti}}});
   return yeni;
  });
 }
}
