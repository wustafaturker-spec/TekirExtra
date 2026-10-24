import {ConflictException,ForbiddenException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {aktifBaglam} from '../core/istek-baglami';
export const IHTIYAC_MODULU='stok_ihtiyac_plani';
export const ihtiyacAyariSemasi=z.object({surum:z.literal(1).default(1),mod:z.enum(['kapali','salt_okunur','pilot','acik']).default('kapali')}).strict();
export const ihtiyacAyarKilitAnahtari=(tenantId:string)=>`${tenantId}:${IHTIYAC_MODULU}`;
export async function ihtiyacErisiminiDogrula(tx:Prisma.TransactionClient,yaz=false){
 const {tenantId,rol}=aktifBaglam();if(!['yonetici','muhasebe','depo'].includes(rol))throw new ForbiddenException('Stok ihtiyaç planı için yetkiniz yok');
 try{
  // Ayar güncellemesi önce bu anahtarı exclusive alır. Yazma ise share tutar.
  if(yaz)await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${ihtiyacAyarKilitAnahtari(tenantId)},0))::text`;
  // Repeatable-read snapshot ayar değişikliğinden eskiyse FOR SHARE serialization hatası verir;
  // kilidi bekledikten sonra eski ayarla yazmaya devam edilmez.
  const rows=yaz?await tx.$queryRaw<{ayarlar:unknown}[]>`SELECT ayarlar FROM modul_ayarlari WHERE tenant_id=${tenantId}::uuid AND modul=${IHTIYAC_MODULU} FOR SHARE`
   :await tx.$queryRaw<{ayarlar:unknown}[]>`SELECT ayarlar FROM modul_ayarlari WHERE tenant_id=${tenantId}::uuid AND modul=${IHTIYAC_MODULU}`;
  const r=ihtiyacAyariSemasi.safeParse(rows[0]?.ayarlar??{});
  if(!r.success||r.data.mod==='kapali')throw new ForbiddenException('Tarihli stok ihtiyacı bu şirket için kapalı. Yönetici modül ayarını kontrol etmelidir.');
  if(yaz&&r.data.mod==='salt_okunur')throw new ForbiddenException('Tarihli stok ihtiyacı salt okunur modda; kayıt ve atama yapılamaz.');
  return {surum:1 as const,mod:r.data.mod,yazabilir:r.data.mod!=='salt_okunur'};
 }catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&(e.code==='P2034'||e.code==='P2010'&&e.meta?.code==='40001'))throw new ConflictException('İhtiyaç kullanım modu değişti; güncel durumu yeniden yükleyin');throw e;}
}
