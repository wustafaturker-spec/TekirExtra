import {ihtiyacErisiminiDogrula} from './ihtiyac-erisim';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { aktifBaglam } from '../core/istek-baglami';
import { PrismaService } from '../core/prisma.service';
import { ihtiyaciHesapla } from './ihtiyac-hesap';
import { tarihliIhtiyaciHesapla } from './ihtiyac-tarihli';
import { siparisGirisleriniOku } from './ihtiyac-siparis-kaynak';
import { createHash } from 'node:crypto';
import { uretimTalepleriniOku } from './ihtiyac-uretim-kaynak';
import { ihtiyacKarsilamasiniHesapla } from './ihtiyac-karsilama';
import { ihtiyacSonucKaniti } from './ihtiyac-sonuc-kaniti';
const gun=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;},'Geçerli bir ihtiyaç günü girin');
export const ihtiyacOnizlemeSemasi=z.object({stokId:z.uuid(),depoId:z.uuid(),miktar:z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,3})?$/).refine(v=>new Prisma.Decimal(v).gt(0),'İhtiyaç pozitif olmalı'),birim:z.string().trim().min(1).max(30),ihtiyacTarihi:gun}).strict();
@Injectable()
export class IhtiyacService{
 constructor(private readonly prisma:PrismaService){}
 /** Seçilmiş örneklerin veri hazırlığıdır; gerçek operasyon kabulü veya kapasite tahsisi değildir. */
 async pilotOnizle(body:unknown){
  const {tenantId,rol}=aktifBaglam();
  if(!['yonetici','muhasebe','depo'].includes(rol))throw new ForbiddenException('Pilot önizlemesi için yetkiniz yok');
  const sema=z.object({ornekler:z.array(z.object({etiket:z.string().trim().min(1).max(80),girdi:ihtiyacOnizlemeSemasi}).strict()).min(1).max(10)}).strict();
  const p=sema.safeParse(body);if(!p.success)throw new BadRequestException(p.error.issues.map(e=>e.message).join('; '));
  if(new Set(p.data.ornekler.map(o=>o.etiket)).size!==p.data.ornekler.length)throw new BadRequestException('Örnek etiketleri tekil olmalı');
  return this.prisma.tenantIslem(tenantId,async tx=>{
   await tx.$executeRaw`SET TRANSACTION READ ONLY`;
   await ihtiyacErisiminiDogrula(tx);
   const [bilgi]=await tx.$queryRaw<{zaman:Date;saltOkunur:string}[]>`SELECT transaction_timestamp() AS zaman,current_setting('transaction_read_only') AS "saltOkunur"`;
   if(bilgi.saltOkunur!=='on')throw new ConflictException('Pilot önizlemesi salt okunur başlatılamadı');
   const ozet={hesaplanan:0,veriBelirsiz:0,reddedilen:0,tedarikGerekli:0,erkenAcik:0};
   const ornekler=[];
   for(const o of p.data.ornekler){
    try{
     const sonuc=await this.onizle(o.girdi,true,tx);
     if(!('tarihli' in sonuc))throw new Error('Tarihli pilot sonucu bekleniyordu');
     const t=sonuc.tarihli,dislanmaNedenleri=new Map<string,number>();
     for(const d of t.dislananlar)dislanmaNedenleri.set(d.neden,(dislanmaNedenleri.get(d.neden)??0)+1);
     ozet.hesaplanan++;
     if(!t.veriYeterli)ozet.veriBelirsiz++;
     if(t.veriYeterli&&new Prisma.Decimal(t.eksik).gt(0))ozet.tedarikGerekli++;
     if(new Prisma.Decimal(t.donemIciEnBuyukAcik).gt(t.eksik))ozet.erkenAcik++;
     ornekler.push({etiket:o.etiket,girdi:o.girdi,durum:'hesaplandi' as const,stok:sonuc.stok,depo:sonuc.depo,anaBirim:sonuc.stok.anaBirim,
      girilen:sonuc.girilen,hesap:sonuc.hesap,tarihliGiris:t.tarihliGiris,ekTalep:t.ekTalep,
      veriYeterli:t.veriYeterli,hesapDurumu:t.durum,eksik:t.eksik,donemIciEnBuyukAcik:t.donemIciEnBuyukAcik,
      hareketSayisi:t.hareketler.length,dislananKaynakSayisi:t.dislananlar.length,
      dislanmaNedenleri:[...dislanmaNedenleri].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([neden,adet])=>({neden,adet})),sonucKaniti:sonuc.sonucKaniti});
    }catch(e){
     // Yalnız beklenen iş/veri hataları satıra çevrilir. DB veya yazılım hatasında bütün rapor başarısızdır.
     if(!(e instanceof BadRequestException||e instanceof NotFoundException||e instanceof ConflictException))throw e;
     ozet.reddedilen++;
     ornekler.push({etiket:o.etiket,girdi:o.girdi,durum:'reddedildi' as const,httpDurumu:e.getStatus(),neden:e.message});
    }
   }
   const [son]=await tx.$queryRaw<{zaman:Date}[]>`SELECT clock_timestamp() AS zaman`;
   if(son.zaman.toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'})!==bilgi.zaman.toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'}))throw new ConflictException('Türkiye günü değişti; pilot önizlemesini yeniden alın');
   return {surum:1,tenantId,alindigiZaman:bilgi.zaman.toISOString(),raporKapsami:'secili_ornekler' as const,dbSaltOkunur:true,
    kapasiteAyrildi:false,operasyonPilotuTamamlandi:false,toplamOrnek:ornekler.length,ozet,ornekler,
    uyarilar:['Örnekler bağımsız analizlerdir; aynı stok birden fazla örnekte görünebilir. Miktarlar ürün ve birim ayrımı olmadan toplanmaz.',
     'Bu rapor bütün şirketin veri kapsaması veya alan sahibi tarafından kabul edilmiş gerçek operasyon pilotu değildir.',
     'Güncel kaynakla alınmış anlık kanıttır; plan saklama veya talep oluşturma öncesindeki sunucu doğrulamasının yerine geçmez.']};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000});
 }
 async onizle(body:unknown,tarihli=false,mevcutTx?:Prisma.TransactionClient){
  const {tenantId,rol}=aktifBaglam();if(!['yonetici','muhasebe','depo'].includes(rol))throw new ForbiddenException('Stok ihtiyaç önizlemesi için yetkiniz yok');
  const p=ihtiyacOnizlemeSemasi.safeParse(body);if(!p.success)throw new BadRequestException(p.error.issues.map(e=>e.message).join('; '));const g=p.data;
  const hesapla=async(tx:Prisma.TransactionClient)=>{
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
   if(tarihli){
    const erisim=await ihtiyacErisiminiDogrula(tx);
    const giris=await siparisGirisleriniOku(tx,tenantId,g.stokId,g.depoId,hesap.yoldaki);
    const uretim=await uretimTalepleriniOku(tx,tenantId,g.stokId,g.depoId,hesap.rezerve);
    const olaylar=[...giris.olaylar,...uretim.olaylar];
    if(olaylar.length>5000)throw new ConflictException('5000 birleşik kaynak sınırı aşıldı; kısmi hesap verilemez');
    const kaynakKaniti=createHash('sha256').update(JSON.stringify([giris.kaynakKaniti,uretim.kaynakKaniti])).digest('hex');
    const plan=tarihliIhtiyaciHesapla({kapsam:{tenantId,stokId:g.stokId,depoId:g.depoId,varyantId:null,anaBirim:kart.anaBirim},bugun,ihtiyacTarihi:g.ihtiyacTarihi,mevcut:hesap.mevcut,rezerve:hesap.rezerve,yeniTalep:hesap.talep,olaylar});
    const sonuc={alindigiZaman:zaman.zaman.toISOString(),bugun,ihtiyacTarihi:g.ihtiyacTarihi,stok:{id:kart.id,kod:kart.kod,ad:kart.ad,anaBirim:kart.anaBirim,tedarikSuresiGun:kart.tedarikSuresiGun},depo,girilen:{miktar:g.miktar,birim:g.birim,katsayi:katsayi.toString()},hesap,tarihli:{...plan,kaynakKaniti,karsilama:ihtiyacKarsilamasiniHesapla(plan)},uyarilar:['Tarihli hesap açık alış siparişi girişlerini ve açıkça atanmış rezerv dışı üretim ihtiyacını içerir.','İrsaliyeye dönüşen, deposu belirsiz ve tarihi doğrulanmamış girişler yeterlilik hesabına eklenmez.','Mevcut satış ve üretim rezervleri başlangıçta bir kez düşülür. Atanmamış rezerv dışı üretim ihtiyacında yeterlilik doğrulanamaz. Taslak satışlar kesin talep sayılmaz.','Dönem sonu yeterliliği teslim garantisi değildir; dönem içi açığı ayrıca değerlendirin.','Bu hesap stok ayırmaz; kaynak payları rezerv veya planlar arası kapasite tahsisi değildir.']};
    return {...sonuc,erisim,sonucKaniti:ihtiyacSonucKaniti(sonuc)};
   }
   return {alindigiZaman:zaman.zaman.toISOString(),bugun,ihtiyacTarihi:g.ihtiyacTarihi,stok:{id:kart.id,kod:kart.kod,ad:kart.ad,anaBirim:kart.anaBirim,tedarikSuresiGun:kart.tedarikSuresiGun},depo,girilen:{miktar:g.miktar,birim:g.birim,katsayi:katsayi.toString()},hesap,uyarilar:['Bu önizleme henüz rezerv edilmemiş yeni ihtiyaç içindir.','Yoldaki miktar için doğrulanmış giriş tarihi bulunmadığından hesaba eklenmedi.','Sonuç anlık stok görünümüdür; gelecekteki satış ve üretim talepleri için teslim garantisi vermez.']};
  };
  return mevcutTx?hesapla(mevcutTx):this.prisma.tenantIslem(tenantId,hesapla,{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
}
