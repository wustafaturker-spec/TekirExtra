import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { hesapOzetiTutari } from "./personel-rapor-yardimci";
import { personelMaliyetExcelYaz } from "./personel-maliyet-excel";

const para = (deger: Prisma.Decimal | null | undefined) => deger?.toFixed(2) ?? "0.00";

@Injectable()
export class PersonelRaporService {
  constructor(private readonly prisma: PrismaService) {}

  async maliyetRaporu(yil:number,ay:number,departman?:string){const satirlar=await this.prisma.tenantIslem(aktifBaglam().tenantId,async tx=>{const bordrolar=await tx.personelBordro.findMany({where:{donemYil:yil,donemAy:ay,durum:{not:"iptal"},...(departman?{personel:{is:{departman:departman==="Atanmamış"?null:departman}}}:{})},select:{brutMaas:true,netMaas:true,hesapOzeti:true,personel:{select:{personelNo:true,ad:true,soyad:true,departman:true}}},orderBy:{personel:{personelNo:"asc"}}});return bordrolar.map(b=>({personelNo:b.personel.personelNo,adSoyad:`${b.personel.ad} ${b.personel.soyad}`,departman:b.personel.departman||"Atanmamış",brutUcret:b.brutMaas.toNumber(),netUcret:b.netMaas.toNumber(),isverenSgk:hesapOzetiTutari(b.hesapOzeti,"isverenSgk").toNumber(),tesvikIndirimi:hesapOzetiTutari(b.hesapOzeti,"isverenSgkTesvikIndirimi").toNumber(),isverenSgkNet:hesapOzetiTutari(b.hesapOzeti,"isverenSgkNet").toNumber(),isverenIssizlik:hesapOzetiTutari(b.hesapOzeti,"isverenIssizlik").toNumber(),isverenMaliyeti:hesapOzetiTutari(b.hesapOzeti,"isverenMaliyeti",b.brutMaas).toNumber()}));});const toplam=satirlar.reduce((t,s)=>({brutUcret:t.brutUcret+s.brutUcret,netUcret:t.netUcret+s.netUcret,tesvikIndirimi:t.tesvikIndirimi+s.tesvikIndirimi,isverenMaliyeti:t.isverenMaliyeti+s.isverenMaliyeti}),{brutUcret:0,netUcret:0,tesvikIndirimi:0,isverenMaliyeti:0});return{donem:{yil,ay},toplam,satirlar};}
  async maliyetExcel(yil:number,ay:number,departman?:string){const rapor=await this.maliyetRaporu(yil,ay,departman);return personelMaliyetExcelYaz(yil,ay,rapor.satirlar);}

  async ozet() {
    const { tenantId } = aktifBaglam();
    const simdi = new Date();
    const yil = simdi.getUTCFullYear(); const ay = simdi.getUTCMonth() + 1;
    const bugun = new Date(Date.UTC(yil, simdi.getUTCMonth(), simdi.getUTCDate()));
    const otuzGunSonra = new Date(bugun); otuzGunSonra.setUTCDate(otuzGunSonra.getUTCDate() + 30);
    const ilkDonem = new Date(Date.UTC(yil, simdi.getUTCMonth() - 5, 1));

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [durumlar, aktifUcret, departmanlar, bordrolar, acikBordro, avans, izinler, suresiDolmus, yaklasanBelgeler] = await Promise.all([
        tx.personel.groupBy({ by: ["durum"], _count: { _all: true } }),
        tx.personel.aggregate({ where: { durum: { in: ["aktif", "askida", "uzun_sureli_izin"] } }, _sum: { netMaas: true } }),
        tx.personel.groupBy({ by: ["departman"], where: { durum: { in: ["aktif", "askida", "uzun_sureli_izin"] } }, _count: { _all: true }, _sum: { netMaas: true }, orderBy: { _count: { departman: "desc" } } }),
        tx.personelBordro.findMany({ where: { durum: { not: "iptal" }, OR: [{ donemYil: { gt: ilkDonem.getUTCFullYear() } }, { donemYil: ilkDonem.getUTCFullYear(), donemAy: { gte: ilkDonem.getUTCMonth() + 1 } }] }, select: { donemYil: true, donemAy: true, brutMaas: true, odenecekTutar: true, odenenTutar: true, hesapOzeti: true, personel: { select: { departman: true } } } }),
        tx.personelBordro.aggregate({ where: { durum: { in: ["hesaplandi", "onay_bekliyor", "onaylandi", "kismen_odendi"] } }, _count: { _all: true }, _sum: { kalanTutar: true } }),
        tx.personelAvans.aggregate({ where: { durum: { in: ["talep", "onaylandi", "odendi", "kismen_mahsup"] } }, _count: { _all: true }, _sum: { kalanTutar: true } }),
        tx.personelIzinTalebi.groupBy({ by: ["durum"], where: { bitisTarihi: { gte: bugun } }, _count: { _all: true }, _sum: { gunSayisi: true } }),
        tx.personelBelgesi.count({ where: { gecerlilikTarihi: { lt: bugun } } }),
        tx.personelBelgesi.findMany({ where: { gecerlilikTarihi: { gte: bugun, lte: otuzGunSonra } }, select: { id: true, tur: true, gecerlilikTarihi: true, personel: { select: { id: true, personelNo: true, ad: true, soyad: true } }, ek: { select: { dosyaAdi: true } } }, orderBy: { gecerlilikTarihi: "asc" }, take: 10 }),
      ]);
      const trend = Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.UTC(yil, simdi.getUTCMonth() - 5 + i, 1)); return { yil: d.getUTCFullYear(), ay: d.getUTCMonth() + 1, tahakkuk: new Prisma.Decimal(0), odeme: new Prisma.Decimal(0), isverenMaliyeti: new Prisma.Decimal(0), tesvik: new Prisma.Decimal(0) }; });
      for (const b of bordrolar) { const d = trend.find((x) => x.yil === b.donemYil && x.ay === b.donemAy); if (d) { d.tahakkuk = d.tahakkuk.add(b.odenecekTutar); d.odeme = d.odeme.add(b.odenenTutar); d.isverenMaliyeti=d.isverenMaliyeti.add(hesapOzetiTutari(b.hesapOzeti,"isverenMaliyeti",b.brutMaas)); d.tesvik=d.tesvik.add(hesapOzetiTutari(b.hesapOzeti,"isverenSgkTesvikIndirimi")); } }
      const guncelMaliyet=trend.find((d)=>d.yil===yil&&d.ay===ay);
      const departmanMaliyetleri=new Map<string,Prisma.Decimal>();
      for(const b of bordrolar.filter((x)=>x.donemYil===yil&&x.donemAy===ay)){const ad=b.personel.departman||"Atanmamış";departmanMaliyetleri.set(ad,(departmanMaliyetleri.get(ad)??new Prisma.Decimal(0)).add(hesapOzetiTutari(b.hesapOzeti,"isverenMaliyeti",b.brutMaas)));}
      return {
        donem: { yil, ay }, toplamPersonel: durumlar.reduce((t, d) => t + d._count._all, 0),
        aktifPersonel: durumlar.filter((d) => ["aktif", "askida", "uzun_sureli_izin"].includes(d.durum)).reduce((t, d) => t + d._count._all, 0),
        durumlar: durumlar.map((d) => ({ durum: d.durum, adet: d._count._all })), aylikSozlesmeYuku: para(aktifUcret._sum.netMaas),
        departmanlar: departmanlar.map((d) => {const ad=d.departman||"Atanmamış";return { ad, adet: d._count._all, ucretYuku: para(d._sum.netMaas), isverenMaliyeti:para(departmanMaliyetleri.get(ad)) }}),
        bordro: { acikAdet: acikBordro._count._all, acikTutar: para(acikBordro._sum.kalanTutar), donemIsverenMaliyeti:para(guncelMaliyet?.isverenMaliyeti), donemTesvikTasarrufu:para(guncelMaliyet?.tesvik), trend: trend.map((d) => ({ yil: d.yil, ay: d.ay, tahakkuk: para(d.tahakkuk), odeme: para(d.odeme), isverenMaliyeti:para(d.isverenMaliyeti), tesvik:para(d.tesvik) })) },
        avans: { acikAdet: avans._count._all, acikTutar: para(avans._sum.kalanTutar) },
        izin: { bekleyen: izinler.find((i) => i.durum === "talep")?._count._all ?? 0, planliGun: para(izinler.find((i) => i.durum === "onaylandi")?._sum.gunSayisi) },
        belgeler: { suresiDolmus, yaklasan: yaklasanBelgeler },
      };
    });
  }
}
