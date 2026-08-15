import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { StokService } from "../stok/stok.service";
import type { receteKaydetSemasi, uretimEmriOlusturSemasi, uretimTamamlaSemasi } from "./uretim.semalar";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

@Injectable()
export class UretimService {
  constructor(private readonly prisma: PrismaService, private readonly stokService: StokService) {}

  async receteGetir(stokId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.urunRecetesi.findUnique({
      where: { stokId },
      include: { kalemler: { orderBy: { id: "asc" }, include: { malzeme: { select: { id: true, kod: true, ad: true, anaBirim: true, mevcutMiktar: true, ortalamaMaliyet: true } }, malzemeVaryant: { select: { id: true, kod: true, ad: true } } } } },
    }));
  }

  async receteKaydet(stokId: string, girdi: z.infer<typeof receteKaydetSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const mamul = await tx.stokKart.findUnique({ where: { id: stokId } });
      if (!mamul || mamul.tip === "hizmet") throw new BadRequestException("Reçete yalnız stoklu ürünlere tanımlanabilir");
      if (girdi.kalemler.some((k) => k.malzemeStokId === stokId)) throw new BadRequestException("Ürün kendi reçetesinde malzeme olamaz");
      for (const kalem of girdi.kalemler) {
        const malzeme = await tx.stokKart.findUnique({ where: { id: kalem.malzemeStokId } });
        if (!malzeme || malzeme.tip === "hizmet") throw new BadRequestException("Geçersiz reçete malzemesi");
        await this.stokService.varyantDogrula(tx, kalem.malzemeStokId, kalem.malzemeVaryantId);
      }
      const mevcut = await tx.urunRecetesi.findUnique({ where: { stokId } });
      if (mevcut) await tx.urunRecetesiKalem.deleteMany({ where: { receteId: mevcut.id } });
      return tx.urunRecetesi.upsert({
        where: { stokId },
        create: { tenantId, stokId, ciktiMiktari: D(girdi.ciktiMiktari), aciklama: girdi.aciklama, kalemler: { create: girdi.kalemler.map((k) => ({ tenantId, malzemeStokId: k.malzemeStokId, malzemeVaryantId: k.malzemeVaryantId, miktar: D(k.miktar), fireOrani: D(k.fireOrani) })) } },
        update: { ciktiMiktari: D(girdi.ciktiMiktari), aciklama: girdi.aciklama, aktif: true, kalemler: { create: girdi.kalemler.map((k) => ({ tenantId, malzemeStokId: k.malzemeStokId, malzemeVaryantId: k.malzemeVaryantId, miktar: D(k.miktar), fireOrani: D(k.fireOrani) })) } },
        include: { kalemler: true },
      });
    });
  }

  async receteSil(stokId: string) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) => tx.urunRecetesi.deleteMany({ where: { stokId } }));
  }

  async emirleriListele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.uretimEmri.findMany({ orderBy: [{ tarih: "desc" }, { createdAt: "desc" }], include: { stok: { select: { id: true, kod: true, ad: true, anaBirim: true } }, hedefDepo: { select: { id: true, kod: true, ad: true } }, _count: { select: { kalemler: true } } } }));
  }

  async emirGetir(id: string) {
    const { tenantId } = aktifBaglam();
    const emir = await this.prisma.tenantIslem(tenantId, (tx) => tx.uretimEmri.findUnique({ where: { id }, include: { stok: true, hedefDepo: true, kalemler: { include: { malzeme: true, malzemeVaryant: true } } } }));
    if (!emir) throw new NotFoundException("Üretim emri bulunamadı");
    return emir;
  }

  async emirOlustur(girdi: z.infer<typeof uretimEmriOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const recete = await tx.urunRecetesi.findUnique({ where: { stokId: girdi.stokId }, include: { kalemler: true } });
      if (!recete?.aktif || !recete.kalemler.length) throw new BadRequestException("Bu stok kartında aktif ürün reçetesi yok");
      const depo = await tx.depo.findFirst({ where: { id: girdi.hedefDepoId, aktif: true } });
      if (!depo) throw new BadRequestException("Hedef depo bulunamadı");
      const oran = D(girdi.planlananMiktar).div(recete.ciktiMiktari);
      const yil = new Date(girdi.tarih).getFullYear();
      const sayi = await tx.uretimEmri.count({ where: { tarih: { gte: new Date(`${yil}-01-01`), lt: new Date(`${yil + 1}-01-01`) } } });
      return tx.uretimEmri.create({ data: { tenantId, no: `URT-${yil}-${String(sayi + 1).padStart(6, "0")}`, stokId: girdi.stokId, hedefDepoId: girdi.hedefDepoId, planlananMiktar: D(girdi.planlananMiktar), tarih: new Date(girdi.tarih), aciklama: girdi.aciklama, kalemler: { create: recete.kalemler.map((k) => ({ tenantId, malzemeStokId: k.malzemeStokId, malzemeVaryantId: k.malzemeVaryantId, planlananMiktar: k.miktar.mul(oran).mul(D(1).add(k.fireOrani.div(100))).toDecimalPlaces(3) })) } }, include: { kalemler: true } });
    });
  }

  async tamamla(id: string, girdi: z.infer<typeof uretimTamamlaSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const emir = await tx.uretimEmri.findUnique({ where: { id }, include: { stok: true, kalemler: { include: { malzeme: true } } } });
      if (!emir) throw new NotFoundException("Üretim emri bulunamadı");
      if (emir.durum !== "taslak") throw new BadRequestException("Yalnız taslak üretim emri tamamlanabilir");
      let toplamMaliyet = D(0);
      for (const kalem of emir.kalemler) {
        const bakiyeler = kalem.malzemeVaryantId
          ? await tx.stokVaryantDepoBakiye.findMany({ where: { varyantId: kalem.malzemeVaryantId, depo: { aktif: true } }, include: { depo: true } })
          : await tx.stokDepoBakiye.findMany({ where: { stokId: kalem.malzemeStokId, depo: { aktif: true } }, include: { depo: true } });
        const uygun = bakiyeler.map((b) => ({ depoId: b.depoId, depoAd: b.depo.ad, varsayilan: b.depo.varsayilan, kullanilabilir: D(b.mevcutMiktar).sub(D(b.rezerveMiktar)) })).filter((b) => b.kullanilabilir.gt(0)).sort((a, b) => Number(b.varsayilan) - Number(a.varsayilan) || b.kullanilabilir.comparedTo(a.kullanilabilir));
        const toplam = uygun.reduce((t, b) => t.add(b.kullanilabilir), D(0));
        if (toplam.lt(kalem.planlananMiktar)) throw new BadRequestException(`${kalem.malzeme.ad} için yeterli kullanılabilir stok yok (gereken ${kalem.planlananMiktar.toFixed(3)}, mevcut ${toplam.toFixed(3)})`);
        let kalan = D(kalem.planlananMiktar);
        for (const kaynak of uygun) {
          if (kalan.lte(0)) break;
          const sarf = Prisma.Decimal.min(kalan, kaynak.kullanilabilir);
          await this.stokService.hareketEkle(tx, { stokId: kalem.malzemeStokId, varyantId: kalem.malzemeVaryantId, depoId: kaynak.depoId, tip: "cikis", miktar: sarf, girilenBirim: kalem.malzeme.anaBirim, girilenMiktar: sarf, birimMaliyet: D(0), tarih: emir.tarih, aciklama: `${emir.no} üretim sarfı`, kaynakTur: "uretim_sarf", kaynakRef: emir.id });
          kalan = kalan.sub(sarf);
        }
        toplamMaliyet = toplamMaliyet.add(kalem.planlananMiktar.mul(kalem.malzeme.ortalamaMaliyet));
        await tx.uretimEmriKalem.update({ where: { id: kalem.id }, data: { sarfEdilenMiktar: kalem.planlananMiktar, birimMaliyet: kalem.malzeme.ortalamaMaliyet } });
      }
      const birimMaliyet = toplamMaliyet.div(emir.planlananMiktar).toDecimalPlaces(4);
      const uretimTarihi = girdi.uretimTarihi ?? emir.tarih.toISOString().slice(0, 10);
      let partiler: NonNullable<Parameters<StokService["hareketEkle"]>[1]["partiler"]> = [];
      if (emir.stok.takipTipi === "lot") {
        partiler = [{ lotNo: girdi.lotNo ?? emir.no, sonKullanmaTarihi: girdi.sonKullanmaTarihi, uretimTarihi, miktar: emir.planlananMiktar }];
      } else if (emir.stok.takipTipi === "seri") {
        const seriNumaralari = [...(girdi.seriNumaralari ?? []), ...(girdi.seriNo ? [girdi.seriNo] : [])];
        if (!emir.planlananMiktar.isInteger() || seriNumaralari.length !== emir.planlananMiktar.toNumber()) {
          throw new BadRequestException(`Seri takibinde üretilen her adet için ayrı seri numarası gerekli (${emir.planlananMiktar.toFixed(0)} adet)`);
        }
        partiler = seriNumaralari.map((seriNo) => ({ lotNo: girdi.lotNo ?? emir.no, seriNo, sonKullanmaTarihi: girdi.sonKullanmaTarihi, uretimTarihi, miktar: D(1) }));
      }
      await this.stokService.hareketEkle(tx, { stokId: emir.stokId, depoId: emir.hedefDepoId, tip: "giris", miktar: emir.planlananMiktar, girilenBirim: emir.stok.anaBirim, girilenMiktar: emir.planlananMiktar, birimMaliyet, tarih: emir.tarih, aciklama: `${emir.no} üretim girişi`, kaynakTur: "uretim_giris", kaynakRef: emir.id, partiler });
      return tx.uretimEmri.update({ where: { id }, data: { durum: "tamamlandi", uretilenMiktar: emir.planlananMiktar, toplamMaliyet, tamamlanmaTarihi: new Date() } });
    });
  }

  async iptal(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const emir = await tx.uretimEmri.findUnique({ where: { id } });
      if (!emir) throw new NotFoundException("Üretim emri bulunamadı");
      if (emir.durum !== "taslak") throw new BadRequestException("Yalnız taslak üretim emri iptal edilebilir");
      return tx.uretimEmri.update({ where: { id }, data: { durum: "iptal" } });
    });
  }

  async uretilebilirUrunler() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.urunRecetesi.findMany({ where: { aktif: true, stok: { aktif: true } }, orderBy: { stok: { ad: "asc" } }, include: { stok: { select: { id: true, kod: true, ad: true, anaBirim: true, mevcutMiktar: true, takipTipi: true } }, _count: { select: { kalemler: true } } } }));
  }
}
