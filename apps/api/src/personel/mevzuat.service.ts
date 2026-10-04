import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../core/prisma.service";
import { kabulSenaryosuSemasi, mevzuatSetiSemasi } from "./mevzuat.semalar";
import { bordroHesapla } from "./bordro-hesaplama"
import { RESMI_MEVZUAT_SETLERI } from "./resmi-mevzuat";

@Injectable()
export class MevzuatService {
  constructor(private readonly prisma: PrismaService) {}
  listele(tenantId:string){return this.prisma.tenantIslem(tenantId,tx=>tx.bordroMevzuatSeti.findMany({where:{tenantId},orderBy:{surum:"desc"}}));}
  async olustur(tenantId:string,userId:string,girdi:z.infer<typeof mevzuatSetiSemasi>){const v=mevzuatSetiSemasi.parse(girdi);return this.prisma.tenantIslem(tenantId,async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mevzuat:${tenantId}`}))`;
    const son=await tx.bordroMevzuatSeti.aggregate({where:{tenantId},_max:{surum:true}});
    return tx.bordroMevzuatSeti.create({data:{tenantId,surum:(son._max.surum??0)+1,ad:v.ad,yururlukBaslangic:v.yururlukBaslangic,yururlukBitis:v.yururlukBitis??null,kaynakNotu:v.kaynakNotu,parametreler:v.parametreler as Prisma.InputJsonValue,olusturanUserId:userId}});
  });}
  async aktiflestir(tenantId:string,id:string,userId:string){return this.prisma.tenantIslem(tenantId,async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mevzuat:${tenantId}`}))`;
    const set=await tx.bordroMevzuatSeti.findFirst({where:{id,tenantId}}); if(!set)throw new NotFoundException("Mevzuat seti bulunamadı");
    if(set.durum!=="taslak")throw new BadRequestException("Yalnızca taslak set etkinleştirilebilir"); if(set.olusturanUserId===userId)throw new BadRequestException("Seti hazırlayan kullanıcı aynı seti etkinleştiremez");
    const kabulSayisi=await tx.bordroKabulSenaryosu.count({where:{tenantId,mevzuatSetiId:id,basarili:true}});if(kabulSayisi<1)throw new BadRequestException("Etkinleştirme için en az bir başarılı bordro kabul senaryosu gereklidir");
    const cakisan=await tx.bordroMevzuatSeti.findFirst({where:{tenantId,durum:"aktif",yururlukBaslangic:{lte:set.yururlukBitis??new Date("9999-12-31")},OR:[{yururlukBitis:null},{yururlukBitis:{gte:set.yururlukBaslangic}}]}}); if(cakisan)throw new BadRequestException(`Yürürlük dönemi aktif v${cakisan.surum} setiyle çakışıyor`);
    return tx.bordroMevzuatSeti.update({where:{id},data:{durum:"aktif",onaylayanUserId:userId,onayTarihi:new Date()}});
  });}
  async arsivle(tenantId:string,id:string){const r=await this.prisma.tenantIslem(tenantId,tx=>tx.bordroMevzuatSeti.updateMany({where:{id,tenantId,durum:{in:["taslak","aktif"]}},data:{durum:"arsiv"}}));if(!r.count)throw new BadRequestException("Set arşivlenemedi");return{id,durum:"arsiv"};}
  donemeUygun(tenantId:string,yil:number,ay:number){const tarih=new Date(Date.UTC(yil,ay-1,1));return this.prisma.tenantIslem(tenantId,tx=>tx.bordroMevzuatSeti.findFirst({where:{tenantId,durum:"aktif",yururlukBaslangic:{lte:tarih},OR:[{yururlukBitis:null},{yururlukBitis:{gte:tarih}}]},orderBy:{surum:"desc"}}));}
  async hesapla(tenantId:string,girdi:{yil:number;ay:number;brutUcret:number;primGunu:number;primeEsasKazanc?:number;oncekiKumulatifMatrah:number;oncekiAsgariKumulatifMatrah:number}){const set=await this.donemeUygun(tenantId,girdi.yil,girdi.ay);if(!set)throw new BadRequestException("Dönem için etkin mevzuat seti bulunamadı");return{mevzuatSeti:{id:set.id,surum:set.surum,ad:set.ad},sonuc:bordroHesapla(set.parametreler as any,girdi),uyari:"Ön hesaplamadır; uzman kabulü tamamlanmadan yasal bordro yerine kullanılamaz."};}
  senaryolariListele(tenantId:string,setId?:string){return this.prisma.tenantIslem(tenantId,tx=>tx.bordroKabulSenaryosu.findMany({where:{tenantId,...(setId?{mevzuatSetiId:setId}:{})},include:{mevzuatSeti:{select:{ad:true,surum:true,durum:true}}},orderBy:{createdAt:"desc"}}));}
  async senaryoOlustur(tenantId:string,girdi:z.infer<typeof kabulSenaryosuSemasi>){const v=kabulSenaryosuSemasi.parse(girdi);return this.prisma.tenantIslem(tenantId,async tx=>{const set=await tx.bordroMevzuatSeti.findFirst({where:{id:v.mevzuatSetiId,tenantId,durum:"taslak"}});if(!set)throw new BadRequestException("Kabul senaryosu yalnızca taslak sete eklenebilir");return tx.bordroKabulSenaryosu.create({data:{tenantId,mevzuatSetiId:v.mevzuatSetiId,ad:v.ad,girdiler:v.girdiler as Prisma.InputJsonValue,beklenen:v.beklenen as Prisma.InputJsonValue,tolerans:v.tolerans}});});}
  async senaryoCalistir(tenantId:string,id:string,userId:string){return this.prisma.tenantIslem(tenantId,async tx=>{const s=await tx.bordroKabulSenaryosu.findFirst({where:{id,tenantId},include:{mevzuatSeti:true}});if(!s)throw new NotFoundException("Kabul senaryosu bulunamadı");const sonuc=bordroHesapla(s.mevzuatSeti.parametreler as any,s.girdiler as any);const beklenen=s.beklenen as Record<string,number>;const tolerans=s.tolerans.toNumber();const farklar=Object.fromEntries(Object.entries(beklenen).map(([k,v])=>[k,Math.abs(Number(sonuc[k as keyof typeof sonuc])-Number(v))]));const basarili=Object.values(farklar).every(f=>f<=tolerans);await tx.bordroKabulSenaryosu.update({where:{id},data:{sonSonuc:{sonuc,farklar} as Prisma.InputJsonValue,basarili,sonCalistiranId:userId,sonCalismaTarihi:new Date()}});return{id,basarili,sonuc,farklar,tolerans};});}

  /** PRS-11: sistemle gelen resmî setler ve bu kiracıda yüklü olup olmadığı. */
  async resmiListele(tenantId: string) {
    const yuklu = await this.prisma.tenantIslem(tenantId, (tx) => tx.bordroMevzuatSeti.findMany({ where: { tenantId, kaynakNotu: { startsWith: "Sistem seti " } }, select: { id: true, kaynakNotu: true, durum: true, surum: true } }))
    return RESMI_MEVZUAT_SETLERI.map((r) => {
      const kayit = yuklu.find((y) => y.kaynakNotu?.startsWith(`Sistem seti ${r.kod}.`))
      return { kod: r.kod, ad: r.ad, yururlukBaslangic: r.yururlukBaslangic, yururlukBitis: r.yururlukBitis, kaynakNotu: r.kaynakNotu, parametreler: r.parametreler, yuklu: kayit ? { id: kayit.id, durum: kayit.durum, surum: kayit.surum } : null }
    })
  }

  /**
   * PRS-11: resmî seti yükler ve doğrudan etkinleştirir (içerik sistemce
   * doğrulanmıştır; kiracının parametre bilmesi gerekmez). Kabul senaryoları
   * yüklemede çalıştırılır, biri tutmazsa set yüklenmez. Yürürlüğü çakışan
   * etkin set varsa önce o arşivlenmelidir.
   */
  async resmiYukle(tenantId: string, userId: string, kod: string) {
    const r = RESMI_MEVZUAT_SETLERI.find((x) => x.kod === kod)
    if (!r) throw new NotFoundException("Resmî set bulunamadı")
    const sonuclar = r.kabulSenaryolari.map((k) => {
      const sonuc = bordroHesapla(r.parametreler, k.girdiler as never) as unknown as Record<string, string>
      const farklar = Object.fromEntries(Object.entries(k.beklenen).map(([a, v]) => [a, Math.abs(Number(sonuc[a]) - v)]))
      return { k, sonuc, farklar, basarili: Object.values(farklar).every((f) => f <= 0.01) }
    })
    if (sonuclar.some((x) => !x.basarili)) throw new BadRequestException("Resmî setin kabul senaryosu tutmadı; set yüklenmedi (sistem hatası, destekle iletişime geçin)")
    const baslangic = new Date(r.yururlukBaslangic), bitis = r.yururlukBitis ? new Date(r.yururlukBitis) : null
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mevzuat:${tenantId}`}))`
      if (await tx.bordroMevzuatSeti.findFirst({ where: { tenantId, kaynakNotu: { startsWith: `Sistem seti ${r.kod}.` }, durum: { not: "arsiv" } } })) throw new BadRequestException(`${r.ad} zaten yüklü`)
      const cakisan = await tx.bordroMevzuatSeti.findFirst({ where: { tenantId, durum: "aktif", yururlukBaslangic: { lte: bitis ?? new Date("9999-12-31") }, OR: [{ yururlukBitis: null }, { yururlukBitis: { gte: baslangic } }] } })
      if (cakisan) throw new BadRequestException(`Yürürlük dönemi etkin v${cakisan.surum} "${cakisan.ad}" setiyle çakışıyor; önce onu arşivleyin`)
      const son = await tx.bordroMevzuatSeti.aggregate({ where: { tenantId }, _max: { surum: true } })
      const simdi = new Date()
      const set = await tx.bordroMevzuatSeti.create({ data: { tenantId, surum: (son._max.surum ?? 0) + 1, ad: r.ad, yururlukBaslangic: baslangic, yururlukBitis: bitis, durum: "aktif", kaynakNotu: r.kaynakNotu, parametreler: r.parametreler as Prisma.InputJsonValue, olusturanUserId: userId, onaylayanUserId: userId, onayTarihi: simdi } })
      for (const x of sonuclar) {
        await tx.bordroKabulSenaryosu.create({ data: { tenantId, mevzuatSetiId: set.id, ad: x.k.ad, girdiler: x.k.girdiler as Prisma.InputJsonValue, beklenen: x.k.beklenen as Prisma.InputJsonValue, sonSonuc: { sonuc: x.sonuc, farklar: x.farklar } as Prisma.InputJsonValue, basarili: true, sonCalistiranId: userId, sonCalismaTarihi: simdi } })
      }
      await tx.auditLog.create({ data: { tenantId, userId, islem: "bordro_mevzuat_resmi_yukle", varlik: "bordro_mevzuat_seti", varlikId: set.id, detay: { kod: r.kod, surum: set.surum } } })
      return set
    })
  }
}
