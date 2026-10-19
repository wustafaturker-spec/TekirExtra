import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { aktifBaglam } from '../core/istek-baglami';
import { PrismaService } from '../core/prisma.service';
import { ihtiyaciHesapla } from './ihtiyac-hesap';
const gun=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;},'Geçerli bir ihtiyaç günü girin');
export const ihtiyacOnizlemeSemasi=z.object({stokId:z.uuid(),depoId:z.uuid(),miktar:z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,3})?$/).refine(v=>new Prisma.Decimal(v).gt(0),'İhtiyaç pozitif olmalı'),birim:z.string().trim().min(1).max(30),ihtiyacTarihi:gun}).strict();
@Injectable()
export class IhtiyacService{
 constructor(private readonly prisma:PrismaService){}
 async onizle(body:unknown){
  const {tenantId,rol}=aktifBaglam();if(!['yonetici','muhasebe','depo'].includes(rol))throw new ForbiddenException('Stok ihtiyaç önizlemesi için yetkiniz yok');
  const p=ihtiyacOnizlemeSemasi.safeParse(body);if(!p.success)throw new BadRequestException(p.error.issues.map(e=>e.message).join('; '));const g=p.data;
  return this.prisma.tenantIslem(tenantId,async tx=>{
   const [zaman]=await tx.$queryRaw<{zaman:Date}[]>`SELECT clock_timestamp() AS zaman`;
   const bugun=zaman.zaman.toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'});
   if(g.ihtiyacTarihi<bugun)throw new BadRequestException('İhtiyaç günü bugünden önce olamaz');
   const kart=await tx.stokKart.findFirst({where:{id:g.stokId,tenantId,aktif:true,tip:{not:'hizmet'}},select:{id:true,kod:true,ad:true,anaBirim:true,tedarikSuresiGun:true,birimler:{select:{ad:true,katsayi:true}},varyantlar:{select:{id:true},take:1}}});
   if(!kart)throw new NotFoundException('Aktif fiziksel stok kartı bulunamadı');
   if(kart.varyantlar.length)throw new BadRequestException('Varyantlı ürünler bu ilk önizlemede desteklenmiyor; varyant stoklarını birleştirerek ihtiyaç hesaplanamaz');
   const depo=await tx.depo.findFirst({where:{id:g.depoId,tenantId,aktif:true},select:{id:true,kod:true,ad:true}});if(!depo)throw new NotFoundException('Aktif depo bulunamadı');
   const katsayi=g.birim===kart.anaBirim?new Prisma.Decimal(1):kart.birimler.find(b=>b.ad===g.birim)?.katsayi;
   if(!katsayi||!katsayi.gt(0))throw new BadRequestException('Bu ürün için geçerli bir birim seçin');
   const talep=new Prisma.Decimal(g.miktar).mul(katsayi);if(talep.decimalPlaces()>3||talep.gte('1000000000000'))throw new BadRequestException('Ana birim karşılığı en fazla 12 basamak ve üç ondalık olmalı');
   const bakiye=await tx.stokDepoBakiye.findUnique({where:{tenantId_stokId_depoId:{tenantId,stokId:g.stokId,depoId:g.depoId}}});
   let hesap:ReturnType<typeof ihtiyaciHesapla>;
   try{hesap=ihtiyaciHesapla({mevcut:bakiye?.mevcutMiktar.toFixed(3)??'0',rezerve:bakiye?.rezerveMiktar.toFixed(3)??'0',yoldaki:bakiye?.yoldakiMiktar.toFixed(3)??'0',talep:talep.toFixed(3)});}catch{throw new ConflictException('Stok bakiyeleri tutarsız; ihtiyaç hesaplanamadı');}
   return {alindigiZaman:zaman.zaman.toISOString(),bugun,ihtiyacTarihi:g.ihtiyacTarihi,stok:{id:kart.id,kod:kart.kod,ad:kart.ad,anaBirim:kart.anaBirim,tedarikSuresiGun:kart.tedarikSuresiGun},depo,girilen:{miktar:g.miktar,birim:g.birim,katsayi:katsayi.toString()},hesap,uyarilar:['Bu önizleme henüz rezerv edilmemiş yeni ihtiyaç içindir.','Yoldaki miktar için doğrulanmış giriş tarihi bulunmadığından hesaba eklenmedi.','Sonuç anlık stok görünümüdür; gelecekteki satış ve üretim talepleri için teslim garantisi vermez.']};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
}
