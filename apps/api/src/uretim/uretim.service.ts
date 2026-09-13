import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { metinNormalize } from "@tekirextra/shared";
import { PrismaService } from "../core/prisma.service";
import { StokService } from "../stok/stok.service";
import type { isMerkeziKaydetSemasi, kaliteKararSemasi, operasyonBaslatSemasi, operasyonBekletSemasi, operasyonTamamlaSemasi, receteKaydetSemasi, sarfDuzeltmeSemasi, uretimBildirimiSemasi, uretimDonemKilidiSemasi, uretimEmriListeSemasi, uretimEmriOlusturSemasi, uretimTamamlaSemasi, vardiyaKaydetSemasi, yenidenIslemeTamamlaSemasi } from "./uretim.semalar";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

@Injectable()
export class UretimService {
  constructor(private readonly prisma: PrismaService, private readonly stokService: StokService) {}

  async ozet() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
      const [durumlar, toplamlar, geciken] = await Promise.all([
        tx.uretimEmri.groupBy({ by: ["durum"], where: { tenantId, durum: { not: "iptal" } }, _count: { _all: true } }),
        tx.uretimEmri.aggregate({ where: { tenantId, durum: { not: "iptal" } }, _sum: { uretilenMiktar: true, hurdaMiktari: true, yenidenIslemeMiktari: true } }),
        tx.uretimEmri.count({ where: { tenantId, tarih: { lt: bugun }, durum: { notIn: ["tamamlandi", "iptal"] } } }),
      ]);
      const sayac = new Map(durumlar.map((satir) => [satir.durum, satir._count._all]));
      const uretilen = D(toplamlar._sum.uretilenMiktar ?? 0);
      const hurda = D(toplamlar._sum.hurdaMiktari ?? 0);
      const yenidenIsleme = D(toplamlar._sum.yenidenIslemeMiktari ?? 0);
      const toplamCikti = uretilen.add(hurda);
      const kapaliDurumlar = new Set(["tamamlandi", "iptal"]);
      return {
        acikEmir: durumlar.filter((satir) => !kapaliDurumlar.has(satir.durum)).reduce((toplam, satir) => toplam + satir._count._all, 0),
        uretimde: (sayac.get("uretimde") ?? 0) + (sayac.get("kismen_tamamlandi") ?? 0),
        malzemeBekleyen: sayac.get("malzeme_bekliyor") ?? 0,
        kaliteBekleyen: sayac.get("kalite_bekliyor") ?? 0,
        geciken,
        uretilenMiktar: uretilen.toFixed(3),
        hurdaMiktari: hurda.toFixed(3),
        yenidenIslemeMiktari: yenidenIsleme.toFixed(3),
        hurdaOrani: toplamCikti.isZero() ? "0.00" : hurda.mul(100).div(toplamCikti).toFixed(2),
      };
    });
  }

  async isMerkezleri() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.isMerkezi.findMany({ orderBy: [{ aktif: "desc" }, { kod: "asc" }] }));
  }

  async vardiyalar() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.uretimVardiya.findMany({ where: { aktif: true }, orderBy: { kod: "asc" } }));
  }

  async vardiyaOlustur(girdi: z.infer<typeof vardiyaKaydetSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.uretimVardiya.create({ data: { tenantId, ...girdi } }));
  }

  async operatorler() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.user.findMany({ where: { aktif: true, rol: "uretim_operatoru" }, select: { id: true, adSoyad: true, eposta: true }, orderBy: { adSoyad: "asc" } }));
  }

  async uretimBekleyenSatisSiparisleri() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const satirlar = await tx.belgeSatir.findMany({ where: { belge: { tur: "siparis", yon: "satis", durum: { in: ["onaylandi", "kapandi"] } }, stok: { urunReceteleri: { some: { aktif: true, durum: "aktif" } } } }, include: { stok: { select: { id: true, kod: true, ad: true, anaBirim: true } }, belge: { select: { id: true, no: true, tarih: true, cari: { select: { kod: true, unvan: true } } } }, uretimEmirleri: { where: { durum: { not: "iptal" } }, select: { planlananMiktar: true } } }, orderBy: { belge: { tarih: "asc" } } });
      return satirlar.map((satir) => { const planlanan = satir.uretimEmirleri.reduce((toplam, emir) => toplam.add(emir.planlananMiktar), D(0)); const kalan = Prisma.Decimal.max(D(0), satir.miktar.sub(planlanan)); return { id: satir.id, siparis: satir.belge, stok: satir.stok, siparisMiktari: satir.miktar.toFixed(3), planlananMiktar: planlanan.toFixed(3), kalanMiktar: kalan.toFixed(3) }; }).filter((satir) => D(satir.kalanMiktar).gt(0));
    });
  }

  async terminalBarkod(barkod: string) {
    const { tenantId } = aktifBaglam();
    const temiz = barkod.trim();
    if (!temiz) throw new BadRequestException("Barkod boş olamaz");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.stokBarkod.findUnique({ where: { tenantId_barkod: { tenantId, barkod: temiz } }, include: { stok: { select: { id: true, kod: true, ad: true, anaBirim: true, takipTipi: true } } } });
      const stok = kayit?.stok ?? await tx.stokKart.findFirst({ where: { tenantId, barkod: temiz }, select: { id: true, kod: true, ad: true, anaBirim: true, takipTipi: true } });
      if (!stok) throw new NotFoundException(`'${temiz}' barkoduna bağlı üretim ürünü bulunamadı`);
      const emirler = await tx.uretimEmri.findMany({ where: { tenantId, stokId: stok.id, durum: { notIn: ["tamamlandi", "iptal"] } }, orderBy: [{ durum: "asc" }, { tarih: "asc" }], select: { id: true, no: true, durum: true, planlananMiktar: true, uretilenMiktar: true, tarih: true, operasyonlar: { orderBy: { sira: "asc" }, select: { id: true, sira: true, operasyonAdi: true, durum: true, operator: { select: { adSoyad: true } }, vardiya: { select: { kod: true, ad: true } } } } } });
      return { barkod: temiz, stok, emirler: emirler.map((emir) => ({ ...emir, planlananMiktar: emir.planlananMiktar.toFixed(3), uretilenMiktar: emir.uretilenMiktar.toFixed(3) })) };
    });
  }

  async donemKilitleri() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.uretimDonemKilidi.findMany({ include: { kapatan: { select: { adSoyad: true } } }, orderBy: [{ yil: "desc" }, { ay: "desc" }] }));
  }

  async donemKilitle(girdi: z.infer<typeof uretimDonemKilidiSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.uretimDonemKilidi.upsert({ where: { tenantId_yil_ay: { tenantId, yil: girdi.yil, ay: girdi.ay } }, create: { tenantId, kapatanUserId: userId, ...girdi }, update: { kapatanUserId: userId, aciklama: girdi.aciklama, kapatildiAt: new Date() } }));
  }

  async donemKilidiAc(id: string) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => { const sonuc = await tx.uretimDonemKilidi.deleteMany({ where: { id } }); if (sonuc.count !== 1) throw new NotFoundException("Üretim dönem kilidi bulunamadı"); });
  }

  async isMerkeziOlustur(girdi: z.infer<typeof isMerkeziKaydetSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.isMerkezi.create({ data: { tenantId, ...girdi, verimlilikYuzdesi: D(girdi.verimlilikYuzdesi), saatlikMaliyet: D(girdi.saatlikMaliyet) } }));
  }

  async isMerkeziGuncelle(id: string, girdi: z.infer<typeof isMerkeziKaydetSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = await tx.isMerkezi.updateMany({ where: { id }, data: { ...girdi, verimlilikYuzdesi: D(girdi.verimlilikYuzdesi), saatlikMaliyet: D(girdi.saatlikMaliyet) } });
      if (sonuc.count !== 1) throw new NotFoundException("İş merkezi bulunamadı");
      return tx.isMerkezi.findUniqueOrThrow({ where: { id } });
    });
  }

  async kapasite(baslangic?: string, bitis?: string) {
    const { tenantId } = aktifBaglam();
    const ilkGun = baslangic && /^\d{4}-\d{2}-\d{2}$/.test(baslangic) ? new Date(`${baslangic}T00:00:00`) : new Date(new Date().toISOString().slice(0, 10));
    const sonGun = bitis && /^\d{4}-\d{2}-\d{2}$/.test(bitis) ? new Date(`${bitis}T23:59:59.999`) : new Date(ilkGun.getTime() + 6 * 86400000 + 86399999);
    if (sonGun < ilkGun || sonGun.getTime() - ilkGun.getTime() > 93 * 86400000) throw new BadRequestException("Kapasite aralığı en fazla 93 gün olabilir");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const merkezler = await tx.isMerkezi.findMany({ where: { aktif: true }, orderBy: { kod: "asc" } });
      const operasyonlar = await tx.uretimEmriOperasyonu.findMany({ where: { durum: { notIn: ["iptal", "tamamlandi"] }, planlananBaslangic: { lte: sonGun }, planlananBitis: { gte: ilkGun } }, include: { uretimEmri: { select: { id: true, no: true, durum: true, stok: { select: { kod: true, ad: true } } } } }, orderBy: { planlananBaslangic: "asc" } });
      return merkezler.map((merkez) => {
        const etkinKapasite = D(merkez.gunlukKapasiteDakika).mul(merkez.verimlilikYuzdesi).div(100);
        const merkezOperasyonlari = operasyonlar.filter((o) => o.isMerkeziId === merkez.id);
        const yuk = merkezOperasyonlari.reduce((t, o) => t.add(o.planlananDakika), D(0));
        const gunSayisi = Math.max(1, Math.ceil((sonGun.getTime() - ilkGun.getTime() + 1) / 86400000));
        const kapasite = etkinKapasite.mul(gunSayisi);
        return { isMerkezi: merkez, baslangic: ilkGun, bitis: sonGun, kapasiteDakika: kapasite.toFixed(2), planlananDakika: yuk.toFixed(2), dolulukYuzdesi: kapasite.isZero() ? "0.00" : yuk.mul(100).div(kapasite).toFixed(2), asimDakika: Prisma.Decimal.max(D(0), yuk.sub(kapasite)).toFixed(2), operasyonlar: merkezOperasyonlari };
      });
    });
  }

  async maliyet(id: string) {
    const { tenantId } = aktifBaglam();
    const emir = await this.prisma.tenantIslem(tenantId, (tx) => tx.uretimEmri.findUnique({ where: { id, tenantId }, include: { stok: { select: { kod: true, ad: true, anaBirim: true, takipTipi: true } }, kalemler: { include: { malzeme: { select: { kod: true, ad: true } } } }, operasyonlar: { include: { isMerkezi: { select: { kod: true, ad: true } } } }, bildirimler: { include: { sarflar: true } } } }));
    if (!emir) throw new NotFoundException("Üretim emri bulunamadı");
    return this.maliyetOzeti(emir);
  }

  async maliyetRaporu(baslangic?: string, bitis?: string) {
    const { tenantId } = aktifBaglam();
    const ilkGun = baslangic && /^\d{4}-\d{2}-\d{2}$/.test(baslangic) ? new Date(`${baslangic}T00:00:00`) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const sonGun = bitis && /^\d{4}-\d{2}-\d{2}$/.test(bitis) ? new Date(`${bitis}T23:59:59.999`) : new Date();
    if (sonGun < ilkGun || sonGun.getTime() - ilkGun.getTime() > 366 * 86400000) throw new BadRequestException("Maliyet raporu aralığı en fazla 366 gün olabilir");
    const emirler = await this.prisma.tenantIslem(tenantId, (tx) => tx.uretimEmri.findMany({ where: { tenantId, tarih: { gte: ilkGun, lte: sonGun }, durum: { not: "iptal" } }, orderBy: { tarih: "desc" }, include: { stok: { select: { kod: true, ad: true, anaBirim: true } }, kalemler: { include: { malzeme: { select: { kod: true, ad: true } } } }, operasyonlar: { include: { isMerkezi: { select: { kod: true, ad: true } } } }, bildirimler: { include: { sarflar: true } } } }));
    const satirlar = emirler.map((emir) => this.maliyetOzeti(emir));
    const toplamlar = satirlar.reduce((t, s) => ({ planlanan: t.planlanan.add(s.toplamlar.planlanan), gerceklesen: t.gerceklesen.add(s.toplamlar.gerceklesen) }), { planlanan: D(0), gerceklesen: D(0) });
    return { baslangic: ilkGun, bitis: sonGun, toplamlar: { planlanan: toplamlar.planlanan.toFixed(4), gerceklesen: toplamlar.gerceklesen.toFixed(4), sapma: toplamlar.gerceklesen.sub(toplamlar.planlanan).toFixed(4), sapmaYuzdesi: toplamlar.planlanan.isZero() ? "0.00" : toplamlar.gerceklesen.sub(toplamlar.planlanan).mul(100).div(toplamlar.planlanan).toFixed(2) }, emirler: satirlar };
  }

  private maliyetOzeti(emir: any) {
    const planlananMalzeme = emir.kalemler.reduce((t: Prisma.Decimal, k: any) => t.add(D(k.planlananMiktar).mul(k.planlananBirimMaliyet)), D(0));
    const bildirimSarflari = emir.bildirimler.flatMap((b: any) => b.sarflar);
    const gerceklesenMalzeme = bildirimSarflari.length
      ? bildirimSarflari.reduce((t: Prisma.Decimal, s: any) => t.add(D(s.miktar).mul(s.birimMaliyet)), D(0))
      : emir.kalemler.reduce((t: Prisma.Decimal, k: any) => t.add(D(k.sarfEdilenMiktar).mul(k.birimMaliyet)), D(0));
    const planlananOperasyon = emir.operasyonlar.reduce((t: Prisma.Decimal, o: any) => t.add(D(o.planlananDakika).mul(o.saatlikMaliyet).div(60)), D(0));
    const gerceklesenOperasyon = emir.operasyonlar.reduce((t: Prisma.Decimal, o: any) => t.add(D(o.gerceklesenDakika).mul(o.saatlikMaliyet).div(60)), D(0));
    const planlanan = planlananMalzeme.add(planlananOperasyon);
    const gerceklesen = gerceklesenMalzeme.add(gerceklesenOperasyon);
    const sapma = gerceklesen.sub(planlanan);
    return { emirId: emir.id, no: emir.no, tarih: emir.tarih, durum: emir.durum, stok: emir.stok, planlananMiktar: emir.planlananMiktar, uretilenMiktar: emir.uretilenMiktar, kalemler: { malzeme: { planlanan: planlananMalzeme.toFixed(4), gerceklesen: gerceklesenMalzeme.toFixed(4), sapma: gerceklesenMalzeme.sub(planlananMalzeme).toFixed(4) }, operasyon: { planlanan: planlananOperasyon.toFixed(4), gerceklesen: gerceklesenOperasyon.toFixed(4), sapma: gerceklesenOperasyon.sub(planlananOperasyon).toFixed(4) } }, toplamlar: { planlanan: planlanan.toFixed(4), gerceklesen: gerceklesen.toFixed(4), sapma: sapma.toFixed(4), sapmaYuzdesi: planlanan.isZero() ? "0.00" : sapma.mul(100).div(planlanan).toFixed(2) } };
  }

  async receteGetir(stokId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.urunRecetesi.findFirst({
      where: { stokId, durum: { in: ["taslak", "onay_bekliyor", "aktif"] } },
      orderBy: { surum: "desc" },
      include: { operasyonlar: { orderBy: { sira: "asc" }, include: { isMerkezi: true } }, kalemler: { orderBy: { id: "asc" }, include: { malzeme: { select: { id: true, kod: true, ad: true, anaBirim: true, mevcutMiktar: true, ortalamaMaliyet: true } }, malzemeVaryant: { select: { id: true, kod: true, ad: true } } } } },
    }));
  }

  async receteSurumleri(stokId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.urunRecetesi.findMany({ where: { stokId }, orderBy: { surum: "desc" }, include: { operasyonlar: { orderBy: { sira: "asc" }, include: { isMerkezi: true } }, kalemler: { include: { malzeme: { select: { id: true, kod: true, ad: true, anaBirim: true } } } }, _count: { select: { uretimEmirleri: true } } } }));
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
      for (const cikti of girdi.ciktilar) {
        if (cikti.stokId === stokId || girdi.ciktilar.filter((x) => x.stokId === cikti.stokId && x.varyantId === cikti.varyantId).length > 1) throw new BadRequestException("Yan/ortak ürünler mamulden farklı ve tekil olmalıdır");
        const kart = await tx.stokKart.findUnique({ where: { id: cikti.stokId } });
        if (!kart || kart.tip === "hizmet") throw new BadRequestException("Geçersiz yan/ortak ürün stok kartı");
        await this.stokService.varyantDogrula(tx, cikti.stokId, cikti.varyantId);
      }
      const merkezIds = [...new Set(girdi.operasyonlar.map((o) => o.isMerkeziId))];
      if (merkezIds.length) {
        const merkezSayisi = await tx.isMerkezi.count({ where: { id: { in: merkezIds }, aktif: true } });
        if (merkezSayisi !== merkezIds.length) throw new BadRequestException("Operasyon rotasında geçersiz veya pasif iş merkezi var");
      }
      const son = await tx.urunRecetesi.findFirst({ where: { stokId }, orderBy: { surum: "desc" }, select: { surum: true } });
      return tx.urunRecetesi.create({
        data: { tenantId, stokId, surum: (son?.surum ?? 0) + 1, durum: "taslak", aktif: false, ciktiMiktari: D(girdi.ciktiMiktari), aciklama: girdi.aciklama, degisiklikNedeni: girdi.degisiklikNedeni, yururlukBaslangic: girdi.yururlukBaslangic ? new Date(girdi.yururlukBaslangic) : null, kaliteKontrolGerekli: girdi.kaliteKontrolGerekli, kalemler: { create: girdi.kalemler.map((k) => ({ tenantId, malzemeStokId: k.malzemeStokId, malzemeVaryantId: k.malzemeVaryantId, miktar: D(k.miktar), fireOrani: D(k.fireOrani) })) }, ciktilar: { create: girdi.ciktilar.map((c) => ({ tenantId, stokId: c.stokId, varyantId: c.varyantId, tip: c.tip, miktar: D(c.miktar) })) }, operasyonlar: { create: girdi.operasyonlar.map((o, index) => ({ tenantId, isMerkeziId: o.isMerkeziId, sira: index + 1, operasyonKodu: o.operasyonKodu, operasyonAdi: o.operasyonAdi, hazirlikDakika: D(o.hazirlikDakika), cevrimDakika: D(o.cevrimDakika) })) } },
        include: { kalemler: true },
      });
    });
  }

  async receteSil(stokId: string) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) => tx.urunRecetesi.updateMany({ where: { stokId, durum: { in: ["taslak", "onay_bekliyor", "aktif"] } }, data: { durum: "arsiv", aktif: false, yururlukBitis: new Date() } }));
  }

  async receteOnayla(stokId: string, surumId: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const surum = await tx.urunRecetesi.findFirst({ where: { id: surumId, stokId } });
      if (!surum) throw new NotFoundException("Reçete sürümü bulunamadı");
      if (!["taslak", "onay_bekliyor"].includes(surum.durum)) throw new BadRequestException("Yalnız taslak veya onay bekleyen reçete etkinleştirilebilir");
      const simdi = new Date();
      await tx.urunRecetesi.updateMany({ where: { stokId, durum: "aktif", id: { not: surumId } }, data: { durum: "pasif", aktif: false, yururlukBitis: simdi } });
      return tx.urunRecetesi.update({ where: { id: surumId }, data: { durum: "aktif", aktif: true, onaylayanUserId: userId, onayZamani: simdi, yururlukBaslangic: surum.yururlukBaslangic ?? simdi, yururlukBitis: null }, include: { kalemler: true } });
    });
  }

  async emirleriListele(sorgu: z.infer<typeof uretimEmriListeSemasi>) {
    const { tenantId } = aktifBaglam();
    const where: Prisma.UretimEmriWhereInput = { tenantId };
    if (sorgu.durum) where.durum = sorgu.durum;
    // ARA-01: stok tarafı aksansız `arama_normal` kolonundan aranır.
    if (sorgu.arama) where.OR = [{ no: { contains: sorgu.arama, mode: "insensitive" } }, { stok: { aramaNormal: { contains: metinNormalize(sorgu.arama) } } }];
    if (sorgu.geciken === "true") where.AND = [{ tarih: { lt: new Date(new Date().toISOString().slice(0, 10)) } }, { durum: { notIn: ["tamamlandi", "iptal"] } }];
    return this.prisma.tenantIslem(tenantId, (tx) => tx.uretimEmri.findMany({ where, orderBy: [{ tarih: "desc" }, { createdAt: "desc" }], include: { stok: { select: { id: true, kod: true, ad: true, anaBirim: true, takipTipi: true } }, hedefDepo: { select: { id: true, kod: true, ad: true } }, satisSiparisSatiri: { select: { belge: { select: { id: true, no: true } } } }, _count: { select: { kalemler: true } } } }));
  }

  async emirGetir(id: string) {
    const { tenantId } = aktifBaglam();
    const emir = await this.prisma.tenantIslem(tenantId, (tx) => tx.uretimEmri.findUnique({ where: { id, tenantId }, include: { stok: true, hedefDepo: true, operasyonlar: { orderBy: { sira: "asc" }, include: { isMerkezi: true, vardiya: true, operator: { select: { id: true, adSoyad: true } }, duruslar: { orderBy: { baslangic: "desc" } } } }, bildirimler: { orderBy: { bildirimTarihi: "desc" }, include: { sarflar: true } }, sarfDuzeltmeleri: { orderBy: { createdAt: "desc" }, include: { depo: { select: { kod: true, ad: true } }, uretimEmriKalem: { include: { malzeme: { select: { kod: true, ad: true, anaBirim: true } } } } } }, kalemler: { include: { malzeme: true, malzemeVaryant: true } } } }));
    if (!emir) throw new NotFoundException("Üretim emri bulunamadı");
    return { ...emir, operasyonlar: emir.operasyonlar.map(({ duruslar, ...operasyon }) => ({ ...operasyon, durus: duruslar })) };
  }

  async malzemeUygunlugu(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const emir = await tx.uretimEmri.findUnique({
        where: { id, tenantId },
        include: { stok: { select: { id: true, kod: true, ad: true, anaBirim: true } }, kalemler: { include: { malzeme: { select: { id: true, kod: true, ad: true, anaBirim: true, takipTipi: true } }, malzemeVaryant: { select: { id: true, kod: true, ad: true } }, rezervasyonlar: true } } },
      });
      if (!emir) throw new NotFoundException("Üretim emri bulunamadı");

      const kalemler = await Promise.all(emir.kalemler.map(async (kalem) => {
        const bakiyeSatirlari = kalem.malzemeVaryantId
          ? await tx.stokVaryantDepoBakiye.findMany({ where: { varyantId: kalem.malzemeVaryantId, depo: { aktif: true } }, include: { depo: { select: { id: true, kod: true, ad: true, varsayilan: true } } } })
          : await tx.stokDepoBakiye.findMany({ where: { stokId: kalem.malzemeStokId, depo: { aktif: true } }, include: { depo: { select: { id: true, kod: true, ad: true, varsayilan: true } } } });
        const depolar = bakiyeSatirlari.map((b) => {
          const mevcut = D(b.mevcutMiktar);
          const rezerve = D(b.rezerveMiktar);
          const emirRezervi = kalem.rezervasyonlar.filter((r) => r.depoId === b.depo.id).reduce((toplam, r) => toplam.add(D(r.rezerveMiktar).sub(r.sarfEdilenMiktar).sub(r.cozulenMiktar)), D(0));
          const kullanilabilir = Prisma.Decimal.max(D(0), mevcut.sub(rezerve).add(emirRezervi));
          return { depoId: b.depo.id, depoKod: b.depo.kod, depoAd: b.depo.ad, varsayilan: b.depo.varsayilan, mevcutMiktar: mevcut.toFixed(3), rezerveMiktar: rezerve.toFixed(3), emirRezervi: emirRezervi.toFixed(3), kullanilabilirMiktar: kullanilabilir.toFixed(3) };
        }).sort((a, b) => Number(b.varsayilan) - Number(a.varsayilan) || Number(b.kullanilabilirMiktar) - Number(a.kullanilabilirMiktar));
        const kullanilabilir = depolar.reduce((toplam, depo) => toplam.add(D(depo.kullanilabilirMiktar)), D(0));
        const gereken = D(kalem.planlananMiktar).add(kalem.ekIhtiyacMiktari ?? 0).sub(kalem.sarfEdilenMiktar);
        const eksik = Prisma.Decimal.max(D(0), gereken.sub(kullanilabilir));
        const rezerveEdilen = kalem.rezervasyonlar.reduce((toplam, r) => toplam.add(D(r.rezerveMiktar).sub(r.sarfEdilenMiktar).sub(r.cozulenMiktar)), D(0));
        return {
          kalemId: kalem.id,
          stokId: kalem.malzemeStokId,
          stokKod: kalem.malzeme.kod,
          stokAd: kalem.malzeme.ad,
          takipTipi: kalem.malzeme.takipTipi,
          varyant: kalem.malzemeVaryant,
          birim: kalem.malzeme.anaBirim,
          gerekenMiktar: gereken.toFixed(3),
          rezerveEdilenMiktar: rezerveEdilen.toFixed(3),
          kullanilabilirMiktar: kullanilabilir.toFixed(3),
          eksikMiktar: eksik.toFixed(3),
          yeterli: eksik.isZero(),
          depolar,
        };
      }));
      const eksikKalemSayisi = kalemler.filter((kalem) => !kalem.yeterli).length;
      return { emirId: emir.id, emirNo: emir.no, mamul: emir.stok, planlananMiktar: emir.planlananMiktar.toFixed(3), uretimeHazir: eksikKalemSayisi === 0, eksikKalemSayisi, kalemler };
    });
  }

  async emirOlustur(girdi: z.infer<typeof uretimEmriOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const emirTarihi = new Date(girdi.tarih);
      await this.uretimDonemiAcikOlmali(tx, emirTarihi);
      if (girdi.satisSiparisSatirId) {
        const siparisSatiri = await tx.belgeSatir.findFirst({ where: { id: girdi.satisSiparisSatirId, stokId: girdi.stokId, belge: { tur: "siparis", yon: "satis", durum: { in: ["onaylandi", "kapandi"] } } }, include: { belge: { select: { no: true } }, uretimEmirleri: { where: { durum: { not: "iptal" } }, select: { planlananMiktar: true } } } });
        if (!siparisSatiri) throw new BadRequestException("Seçilen satış siparişi satırı ürünle eşleşmiyor veya üretime uygun değil");
        const planlanan = siparisSatiri.uretimEmirleri.reduce((toplam, emir) => toplam.add(emir.planlananMiktar), D(0));
        if (planlanan.add(girdi.planlananMiktar).gt(siparisSatiri.miktar)) throw new BadRequestException(`${siparisSatiri.belge.no ?? "Satış siparişi"} için kalan üretim ihtiyacı aşılamaz`);
      }
      const recete = await tx.urunRecetesi.findFirst({ where: { stokId: girdi.stokId, durum: "aktif", aktif: true, OR: [{ yururlukBaslangic: null }, { yururlukBaslangic: { lte: emirTarihi } }], AND: [{ OR: [{ yururlukBitis: null }, { yururlukBitis: { gte: emirTarihi } }] }] }, orderBy: { surum: "desc" }, include: { kalemler: { include: { malzeme: { select: { ortalamaMaliyet: true } } } }, ciktilar: true, operasyonlar: { orderBy: { sira: "asc" }, include: { isMerkezi: { select: { saatlikMaliyet: true } } } } } });
      if (!recete?.kalemler.length) throw new BadRequestException("Bu stok kartında üretim tarihinde geçerli, onaylı reçete yok");
      const depo = await tx.depo.findFirst({ where: { id: girdi.hedefDepoId, aktif: true } });
      if (!depo) throw new BadRequestException("Hedef depo bulunamadı");
      const oran = D(girdi.planlananMiktar).div(recete.ciktiMiktari);
      const yil = new Date(girdi.tarih).getFullYear();
      const sayac = await tx.uretimSayac.upsert({
        where: { tenantId_yil: { tenantId, yil } },
        create: { tenantId, yil, sonSira: 1 },
        update: { sonSira: { increment: 1 } },
      });
      let operasyonBaslangici = new Date(`${girdi.tarih}T08:00:00`);
      const operasyonlar = recete.operasyonlar.map((o) => {
        const dakika = D(o.hazirlikDakika).add(D(o.cevrimDakika).mul(girdi.planlananMiktar)).toDecimalPlaces(2);
        const baslangic = operasyonBaslangici;
        const bitis = new Date(baslangic.getTime() + dakika.toNumber() * 60000);
        operasyonBaslangici = bitis;
        return { tenantId, isMerkeziId: o.isMerkeziId, sira: o.sira, operasyonKodu: o.operasyonKodu, operasyonAdi: o.operasyonAdi, planlananDakika: dakika, saatlikMaliyet: o.isMerkezi.saatlikMaliyet, planlananBaslangic: baslangic, planlananBitis: bitis };
      });
      const planlananMalzeme = recete.kalemler.reduce((t, k) => t.add(k.miktar.mul(oran).mul(D(1).add(k.fireOrani.div(100))).mul(k.malzeme.ortalamaMaliyet)), D(0));
      const planlananOperasyon = operasyonlar.reduce((t, o) => t.add(D(o.planlananDakika).mul(o.saatlikMaliyet).div(60)), D(0));
      const planlananMaliyet = planlananMalzeme.add(planlananOperasyon).toDecimalPlaces(4);
      return tx.uretimEmri.create({ data: { tenantId, no: `URT-${yil}-${String(sayac.sonSira).padStart(6, "0")}`, stokId: girdi.stokId, receteId: recete.id, hedefDepoId: girdi.hedefDepoId, satisSiparisSatirId: girdi.satisSiparisSatirId, planlananMiktar: D(girdi.planlananMiktar), planlananMaliyet, kaliteKontrolGerekli: recete.kaliteKontrolGerekli, tarih: emirTarihi, aciklama: girdi.aciklama, kalemler: { create: recete.kalemler.map((k) => ({ tenantId, malzemeStokId: k.malzemeStokId, malzemeVaryantId: k.malzemeVaryantId, planlananMiktar: k.miktar.mul(oran).mul(D(1).add(k.fireOrani.div(100))).toDecimalPlaces(3), planlananBirimMaliyet: k.malzeme.ortalamaMaliyet })) }, ciktilar: { create: (recete.ciktilar ?? []).map((c) => ({ tenantId, receteCiktiId: c.id, stokId: c.stokId, varyantId: c.varyantId, tip: c.tip, planlananMiktar: c.miktar.mul(oran).toDecimalPlaces(3) })) }, operasyonlar: { create: operasyonlar } }, include: { kalemler: true, operasyonlar: true, ciktilar: true, satisSiparisSatiri: { include: { belge: true } } } });
    });
  }

  async planla(id: string) {
    return this.durumGecisi(id, ["taslak"], "planlandi", "Yalnız taslak üretim emri planlanabilir");
  }

  async rezerveEt(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const emir = await tx.uretimEmri.findUnique({ where: { id, tenantId }, include: { kalemler: { include: { malzeme: true, rezervasyonlar: true } } } });
      if (!emir) throw new NotFoundException("Üretim emri bulunamadı");
      if (!["planlandi", "malzeme_bekliyor", "hazir"].includes(emir.durum)) throw new BadRequestException("Yalnız planlanmış veya malzeme bekleyen emir için rezervasyon yapılabilir");

      let eksikVar = false;
      for (const kalem of emir.kalemler) {
        const aktifRezerv = kalem.rezervasyonlar.reduce((toplam, r) => toplam.add(this.aktifRezervMiktari(r)), D(0));
        let kalan = Prisma.Decimal.max(D(0), D(kalem.planlananMiktar).add(kalem.ekIhtiyacMiktari ?? 0).sub(kalem.sarfEdilenMiktar).sub(aktifRezerv));
        if (kalan.isZero()) continue;

        const bakiyeler = kalem.malzemeVaryantId
          ? await tx.stokVaryantDepoBakiye.findMany({ where: { varyantId: kalem.malzemeVaryantId, depo: { aktif: true } }, include: { depo: true } })
          : await tx.stokDepoBakiye.findMany({ where: { stokId: kalem.malzemeStokId, depo: { aktif: true } }, include: { depo: true } });
        const adaylar = bakiyeler.map((b) => ({ ...b, kullanilabilir: Prisma.Decimal.max(D(0), D(b.mevcutMiktar).sub(b.rezerveMiktar)) })).filter((b) => b.kullanilabilir.gt(0)).sort((a, b) => Number(b.depo.varsayilan) - Number(a.depo.varsayilan) || b.kullanilabilir.comparedTo(a.kullanilabilir));

        for (const aday of adaylar) {
          if (kalan.isZero()) break;
          const miktar = Prisma.Decimal.min(kalan, aday.kullanilabilir);
          const sonuc = kalem.malzemeVaryantId
            ? await tx.stokVaryantDepoBakiye.updateMany({ where: { id: aday.id, rezerveMiktar: aday.rezerveMiktar, mevcutMiktar: { gte: D(aday.rezerveMiktar).add(miktar) } }, data: { rezerveMiktar: { increment: miktar } } })
            : await tx.stokDepoBakiye.updateMany({ where: { id: aday.id, rezerveMiktar: aday.rezerveMiktar, mevcutMiktar: { gte: D(aday.rezerveMiktar).add(miktar) } }, data: { rezerveMiktar: { increment: miktar } } });
          if (sonuc.count !== 1) throw new BadRequestException("Stok rezervasyon sırasında değişti; uygunluğu yenileyip tekrar deneyin");

          await tx.stokKart.update({ where: { id: kalem.malzemeStokId }, data: { rezerveMiktar: { increment: miktar } } });
          if (kalem.malzemeVaryantId) {
            await tx.stokVaryant.update({ where: { id: kalem.malzemeVaryantId }, data: { rezerveMiktar: { increment: miktar } } });
            await tx.stokDepoBakiye.upsert({ where: { tenantId_stokId_depoId: { tenantId, stokId: kalem.malzemeStokId, depoId: aday.depoId } }, create: { tenantId, stokId: kalem.malzemeStokId, depoId: aday.depoId, rezerveMiktar: miktar }, update: { rezerveMiktar: { increment: miktar } } });
          }
          await tx.uretimMalzemeRezervasyon.upsert({
            where: { tenantId_uretimEmriKalemId_depoId: { tenantId, uretimEmriKalemId: kalem.id, depoId: aday.depoId } },
            create: { tenantId, uretimEmriKalemId: kalem.id, depoId: aday.depoId, rezerveMiktar: miktar },
            update: { rezerveMiktar: { increment: miktar } },
          });
          kalan = kalan.sub(miktar);
        }
        if (kalan.gt(0)) eksikVar = true;
      }

      const durum = eksikVar ? "malzeme_bekliyor" : "hazir";
      await tx.uretimEmri.update({ where: { id, tenantId }, data: { durum } });
      return tx.uretimEmri.findUniqueOrThrow({ where: { id, tenantId }, include: { stok: true, hedefDepo: true, kalemler: { include: { malzeme: true, malzemeVaryant: true, rezervasyonlar: { include: { depo: true } } } } } });
    });
  }

  async baslat(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = await tx.uretimEmri.updateMany({ where: { id, tenantId, durum: "hazir" }, data: { durum: "uretimde" } });
      if (sonuc.count !== 1) throw new BadRequestException("Üretim yalnız tüm malzemeleri rezerve edilmiş hazır emirlerde başlatılabilir");
      const ilk = await tx.uretimEmriOperasyonu.findFirst({ where: { uretimEmriId: id }, orderBy: { sira: "asc" } });
      if (ilk) await tx.uretimEmriOperasyonu.updateMany({ where: { id: ilk.id, durum: "planlandi" }, data: { durum: "hazir" } });
      return tx.uretimEmri.findUniqueOrThrow({ where: { id, tenantId }, include: { stok: true, hedefDepo: true, operasyonlar: { orderBy: { sira: "asc" }, include: { isMerkezi: true } } } });
    });
  }

  async operasyonBaslat(emirId: string, operasyonId: string, girdi: z.infer<typeof operasyonBaslatSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const operasyon = await tx.uretimEmriOperasyonu.findFirst({ where: { id: operasyonId, uretimEmriId: emirId }, include: { uretimEmri: true } });
      if (!operasyon) throw new NotFoundException("Üretim operasyonu bulunamadı");
      if (!["uretimde", "kismen_tamamlandi"].includes(operasyon.uretimEmri.durum)) throw new BadRequestException("Operasyon için üretim emri başlatılmış olmalıdır");
      const tamamlanmayanOnceki = await tx.uretimEmriOperasyonu.count({ where: { uretimEmriId: emirId, sira: { lt: operasyon.sira }, durum: { not: "tamamlandi" } } });
      if (tamamlanmayanOnceki) throw new BadRequestException("Önce önceki operasyonlar tamamlanmalıdır");
      const [vardiya, operator] = await Promise.all([tx.uretimVardiya.findFirst({ where: { id: girdi.vardiyaId, aktif: true } }), tx.user.findFirst({ where: { id: girdi.operatorId, aktif: true, rol: "uretim_operatoru" } })]);
      if (!vardiya) throw new BadRequestException("Aktif üretim vardiyası bulunamadı");
      if (!operator) throw new BadRequestException("Aktif üretim operatörü bulunamadı");
      const simdi = new Date();
      const acikDurus = await tx.uretimDurus.findFirst({ where: { operasyonId, bitis: null }, orderBy: { baslangic: "desc" } });
      if (acikDurus) await tx.uretimDurus.update({ where: { id: acikDurus.id }, data: { bitis: simdi, sureDakika: D(Math.max(0, (simdi.getTime() - acikDurus.baslangic.getTime()) / 60000)).toDecimalPlaces(2) } });
      const sonuc = await tx.uretimEmriOperasyonu.updateMany({ where: { id: operasyonId, durum: { in: ["hazir", "beklemede"] } }, data: { durum: "devam_ediyor", fiiliBaslangic: simdi, vardiyaId: girdi.vardiyaId, operatorId: girdi.operatorId } });
      if (sonuc.count !== 1) throw new BadRequestException("Yalnız hazır veya bekleyen operasyon başlatılabilir");
      return tx.uretimEmriOperasyonu.findUniqueOrThrow({ where: { id: operasyonId }, include: { isMerkezi: true, vardiya: true, operator: { select: { id: true, adSoyad: true } }, duruslar: true } });
    });
  }

  async operasyonBeklet(emirId: string, operasyonId: string, girdi: z.infer<typeof operasyonBekletSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const operasyon = await tx.uretimEmriOperasyonu.findFirst({ where: { id: operasyonId, uretimEmriId: emirId, durum: "devam_ediyor" } });
      if (!operasyon?.fiiliBaslangic) throw new BadRequestException("Yalnız devam eden operasyon bekletilebilir");
      const gecen = D(Math.max(0, (Date.now() - operasyon.fiiliBaslangic.getTime()) / 60000)).toDecimalPlaces(2);
      await tx.uretimEmriOperasyonu.update({ where: { id: operasyonId }, data: { durum: "beklemede", gerceklesenDakika: { increment: gecen }, fiiliBaslangic: null } });
      await tx.uretimDurus.create({ data: { tenantId, operasyonId, nedenKodu: girdi.nedenKodu, aciklama: girdi.aciklama, planli: girdi.planli, olusturanUserId: userId } });
      return tx.uretimEmriOperasyonu.findUniqueOrThrow({ where: { id: operasyonId }, include: { isMerkezi: true, vardiya: true, operator: { select: { id: true, adSoyad: true } }, duruslar: true } });
    });
  }

  async operasyonTamamla(emirId: string, operasyonId: string, girdi: z.infer<typeof operasyonTamamlaSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const operasyon = await tx.uretimEmriOperasyonu.findFirst({ where: { id: operasyonId, uretimEmriId: emirId, durum: "devam_ediyor" } });
      if (!operasyon?.fiiliBaslangic) throw new BadRequestException("Yalnız devam eden operasyon tamamlanabilir");
      const gecen = D(Math.max(0, (Date.now() - operasyon.fiiliBaslangic.getTime()) / 60000));
      const gerceklesen = girdi.gerceklesenDakika === undefined ? D(operasyon.gerceklesenDakika).add(gecen).toDecimalPlaces(2) : D(girdi.gerceklesenDakika);
      const sonuc = await tx.uretimEmriOperasyonu.updateMany({ where: { id: operasyonId, durum: "devam_ediyor" }, data: { durum: "tamamlandi", gerceklesenDakika: gerceklesen, fiiliBitis: new Date() } });
      if (sonuc.count !== 1) throw new BadRequestException("Operasyon durumu başka bir işlem tarafından değiştirildi");
      const operasyonMaliyeti = gerceklesen.mul(operasyon.saatlikMaliyet).div(60).toDecimalPlaces(4);
      await tx.uretimEmri.update({ where: { id: emirId, tenantId }, data: { toplamMaliyet: { increment: operasyonMaliyeti } } });
      const sonraki = await tx.uretimEmriOperasyonu.findFirst({ where: { uretimEmriId: emirId, sira: { gt: operasyon.sira }, durum: "planlandi" }, orderBy: { sira: "asc" } });
      if (sonraki) await tx.uretimEmriOperasyonu.updateMany({ where: { id: sonraki.id, durum: "planlandi" }, data: { durum: "hazir" } });
      return tx.uretimEmriOperasyonu.findUniqueOrThrow({ where: { id: operasyonId }, include: { isMerkezi: true } });
    });
  }

  async bildir(id: string, girdi: z.infer<typeof uretimBildirimiSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.uretimDonemiAcikOlmali(tx, girdi.bildirimTarihi ? new Date(girdi.bildirimTarihi) : new Date());
      const onceki = await tx.uretimBildirimi.findUnique({ where: { tenantId_idempotencyAnahtari: { tenantId, idempotencyAnahtari: girdi.idempotencyAnahtari } }, include: { sarflar: true } });
      if (onceki) {
        if (onceki.uretimEmriId !== id) throw new BadRequestException("Bildirim anahtarı başka bir üretim emrinde kullanılmış");
        return onceki;
      }
      const emir = await tx.uretimEmri.findUnique({ where: { id, tenantId }, include: { stok: true, ciktilar: { include: { stok: true } }, kalemler: { include: { malzeme: true, rezervasyonlar: true } } } });
      if (!emir) throw new NotFoundException("Üretim emri bulunamadı");
      if (!["uretimde", "kismen_tamamlandi"].includes(emir.durum)) throw new BadRequestException("Yalnız üretimde olan emre bildirim girilebilir");
      const uretilen = D(girdi.uretilenMiktar);
      const yeniToplam = D(emir.uretilenMiktar).add(uretilen);
      if (yeniToplam.gt(emir.planlananMiktar)) throw new BadRequestException(`Bildirim kalan üretim miktarını aşıyor (${D(emir.planlananMiktar).sub(emir.uretilenMiktar).toFixed(3)})`);

      const girilenSarflar = new Map((girdi.sarflar ?? []).map((s) => [s.uretimEmriKalemId, D(s.miktar)]));
      if (girilenSarflar.size !== (girdi.sarflar ?? []).length || [...girilenSarflar.keys()].some((kalemId) => !emir.kalemler.some((k) => k.id === kalemId))) throw new BadRequestException("Gerçek sarf satırları bu üretim emrine ait ve benzersiz olmalıdır");
      let toplamMaliyet = D(0);
      const sarfKayitlari: { uretimEmriKalemId: string; miktar: Prisma.Decimal; birimMaliyet: Prisma.Decimal }[] = [];
      for (const kalem of emir.kalemler) {
        const miktar = girilenSarflar.get(kalem.id) ?? D(kalem.planlananMiktar).mul(uretilen).div(emir.planlananMiktar).toDecimalPlaces(3);
        if (miktar.lte(0)) continue;
        const aktifRezervasyonlar = kalem.rezervasyonlar.map((r) => ({ ...r, aktifMiktar: this.aktifRezervMiktari(r) })).filter((r) => r.aktifMiktar.gt(0));
        if (aktifRezervasyonlar.reduce((t, r) => t.add(r.aktifMiktar), D(0)).lt(miktar)) throw new BadRequestException(`${kalem.malzeme.ad} için ayrılmış stok gerçek sarfı karşılamıyor`);
        let kalan = miktar;
        for (const rezervasyon of aktifRezervasyonlar) {
          if (kalan.isZero()) break;
          const sarf = Prisma.Decimal.min(kalan, rezervasyon.aktifMiktar);
          await this.rezervasyonBakiyesiCoz(tx, kalem, rezervasyon.depoId, sarf, rezervasyon.id, "sarf");
          await this.stokService.hareketEkle(tx, { stokId: kalem.malzemeStokId, varyantId: kalem.malzemeVaryantId, depoId: rezervasyon.depoId, tip: "cikis", miktar: sarf, girilenBirim: kalem.malzeme.anaBirim, girilenMiktar: sarf, birimMaliyet: D(0), tarih: new Date(girdi.bildirimTarihi ?? Date.now()), aciklama: `${emir.no} üretim bildirimi sarfı`, kaynakTur: "uretim_bildirimi_sarf", kaynakRef: girdi.idempotencyAnahtari });
          kalan = kalan.sub(sarf);
        }
        toplamMaliyet = toplamMaliyet.add(miktar.mul(kalem.malzeme.ortalamaMaliyet));
        sarfKayitlari.push({ uretimEmriKalemId: kalem.id, miktar, birimMaliyet: kalem.malzeme.ortalamaMaliyet });
        await tx.uretimEmriKalem.update({ where: { id: kalem.id, tenantId }, data: { sarfEdilenMiktar: { increment: miktar }, birimMaliyet: kalem.malzeme.ortalamaMaliyet } });
      }
      const birimMaliyet = toplamMaliyet.div(uretilen).toDecimalPlaces(4);
      const uretimTarihi = girdi.uretimTarihi ?? new Date().toISOString().slice(0, 10);
      let partiler: NonNullable<Parameters<StokService["hareketEkle"]>[1]["partiler"]> = [];
      if (emir.stok.takipTipi === "lot") partiler = [{ lotNo: girdi.lotNo ?? emir.no, sonKullanmaTarihi: girdi.sonKullanmaTarihi, uretimTarihi, miktar: uretilen }];
      if (emir.stok.takipTipi === "seri") {
        const seriler = [...(girdi.seriNumaralari ?? []), ...(girdi.seriNo ? [girdi.seriNo] : [])];
        if (!uretilen.isInteger() || seriler.length !== uretilen.toNumber()) throw new BadRequestException(`Seri takibinde ${uretilen.toFixed(0)} benzersiz seri numarası gerekli`);
        partiler = seriler.map((seriNo) => ({ lotNo: girdi.lotNo ?? emir.no, seriNo, sonKullanmaTarihi: girdi.sonKullanmaTarihi, uretimTarihi, miktar: D(1) }));
      }
      const karantinaDepo = emir.kaliteKontrolGerekli ? await tx.depo.upsert({ where: { tenantId_kod: { tenantId, kod: "KARANTINA" } }, create: { tenantId, kod: "KARANTINA", ad: "Kalite Karantina Deposu", aktif: true, varsayilan: false }, update: { aktif: true } }) : null;
      const girisDepoId = karantinaDepo?.id ?? emir.hedefDepoId;
      await this.stokService.hareketEkle(tx, { stokId: emir.stokId, depoId: girisDepoId, tip: "giris", miktar: uretilen, girilenBirim: emir.stok.anaBirim, girilenMiktar: uretilen, birimMaliyet, tarih: new Date(girdi.bildirimTarihi ?? Date.now()), aciklama: karantinaDepo ? `${emir.no} kalite karantina girişi` : `${emir.no} üretim bildirimi girişi`, kaynakTur: "uretim_bildirimi_giris", kaynakRef: girdi.idempotencyAnahtari, partiler });
      for (const cikti of emir.ciktilar ?? []) {
        const miktar = D(cikti.planlananMiktar).mul(uretilen).div(emir.planlananMiktar).toDecimalPlaces(3);
        if (miktar.lte(0)) continue;
        await this.stokService.hareketEkle(tx, { stokId: cikti.stokId, varyantId: cikti.varyantId, depoId: girisDepoId, tip: "giris", miktar, girilenBirim: cikti.stok.anaBirim, girilenMiktar: miktar, birimMaliyet: D(0), tarih: new Date(girdi.bildirimTarihi ?? Date.now()), aciklama: `${emir.no} ${cikti.tip === "yan_urun" ? "yan ürün" : "ortak ürün"} girişi`, kaynakTur: "uretim_cikti_giris", kaynakRef: girdi.idempotencyAnahtari });
        await tx.uretimEmriCikti.update({ where: { id: cikti.id }, data: { uretilenMiktar: { increment: miktar } } });
      }
      const tamamlandi = yeniToplam.eq(emir.planlananMiktar);
      const bildirim = await tx.uretimBildirimi.create({ data: { tenantId, uretimEmriId: id, idempotencyAnahtari: girdi.idempotencyAnahtari, uretilenMiktar: uretilen, hurdaMiktari: D(girdi.hurdaMiktari), hurdaNedeni: girdi.hurdaNedeni, yenidenIslemeMiktari: D(girdi.yenidenIslemeMiktari), yenidenIslemeNedeni: girdi.yenidenIslemeNedeni, toplamMaliyet, bildirimTarihi: new Date(girdi.bildirimTarihi ?? Date.now()), aciklama: girdi.aciklama, sarflar: { create: sarfKayitlari.map((s) => ({ tenantId, ...s })) } }, include: { sarflar: true } });
      if (karantinaDepo) await tx.uretimKaliteKontrol.create({ data: { tenantId, uretimEmriId: id, uretimBildirimiId: bildirim.id, karantinaDepoId: karantinaDepo.id, miktar: uretilen } });
      await tx.uretimEmri.update({ where: { id, tenantId }, data: { durum: karantinaDepo ? "kalite_bekliyor" : tamamlandi ? "tamamlandi" : "kismen_tamamlandi", uretilenMiktar: { increment: uretilen }, hurdaMiktari: { increment: D(girdi.hurdaMiktari) }, yenidenIslemeMiktari: { increment: D(girdi.yenidenIslemeMiktari) }, toplamMaliyet: { increment: toplamMaliyet }, tamamlanmaTarihi: !karantinaDepo && tamamlandi ? new Date() : null } });
      if (tamamlandi && !karantinaDepo) await this.emirRezervasyonlariniCoz(tx, id);
      return bildirim;
    });
  }

  async tamamla(id: string, girdi: z.infer<typeof uretimTamamlaSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const emir = await tx.uretimEmri.findUnique({ where: { id, tenantId }, include: { stok: true, kalemler: { include: { malzeme: true, rezervasyonlar: true } } } });
      if (!emir) throw new NotFoundException("Üretim emri bulunamadı");
      if (emir.durum !== "uretimde") throw new BadRequestException("Yalnız üretimde olan emir tamamlanabilir");
      let toplamMaliyet = D(0);
      for (const kalem of emir.kalemler) {
        const aktifRezervasyonlar = kalem.rezervasyonlar.map((r) => ({ ...r, aktifMiktar: this.aktifRezervMiktari(r) })).filter((r) => r.aktifMiktar.gt(0));
        const bakiyeler = kalem.malzemeVaryantId
          ? await tx.stokVaryantDepoBakiye.findMany({ where: { varyantId: kalem.malzemeVaryantId, depo: { aktif: true } }, include: { depo: true } })
          : await tx.stokDepoBakiye.findMany({ where: { stokId: kalem.malzemeStokId, depo: { aktif: true } }, include: { depo: true } });
        const uygun = aktifRezervasyonlar.length
          ? aktifRezervasyonlar.map((r) => ({ depoId: r.depoId, depoAd: "Rezerve depo", varsayilan: false, kullanilabilir: r.aktifMiktar, rezervasyonId: r.id }))
          : bakiyeler.map((b) => ({ depoId: b.depoId, depoAd: b.depo.ad, varsayilan: b.depo.varsayilan, kullanilabilir: D(b.mevcutMiktar).sub(D(b.rezerveMiktar)), rezervasyonId: null as string | null })).filter((b) => b.kullanilabilir.gt(0)).sort((a, b) => Number(b.varsayilan) - Number(a.varsayilan) || b.kullanilabilir.comparedTo(a.kullanilabilir));
        const toplam = uygun.reduce((t, b) => t.add(b.kullanilabilir), D(0));
        if (toplam.lt(kalem.planlananMiktar)) throw new BadRequestException(`${kalem.malzeme.ad} için yeterli kullanılabilir stok yok (gereken ${kalem.planlananMiktar.toFixed(3)}, mevcut ${toplam.toFixed(3)})`);
        let kalan = D(kalem.planlananMiktar);
        for (const kaynak of uygun) {
          if (kalan.lte(0)) break;
          const sarf = Prisma.Decimal.min(kalan, kaynak.kullanilabilir);
          if (kaynak.rezervasyonId) await this.rezervasyonBakiyesiCoz(tx, kalem, kaynak.depoId, sarf, kaynak.rezervasyonId, "sarf");
          await this.stokService.hareketEkle(tx, { stokId: kalem.malzemeStokId, varyantId: kalem.malzemeVaryantId, depoId: kaynak.depoId, tip: "cikis", miktar: sarf, girilenBirim: kalem.malzeme.anaBirim, girilenMiktar: sarf, birimMaliyet: D(0), tarih: emir.tarih, aciklama: `${emir.no} üretim sarfı`, kaynakTur: "uretim_sarf", kaynakRef: emir.id });
          kalan = kalan.sub(sarf);
        }
        toplamMaliyet = toplamMaliyet.add(kalem.planlananMiktar.mul(kalem.malzeme.ortalamaMaliyet));
        await tx.uretimEmriKalem.update({ where: { id: kalem.id, tenantId }, data: { sarfEdilenMiktar: kalem.planlananMiktar, birimMaliyet: kalem.malzeme.ortalamaMaliyet } });
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
      return tx.uretimEmri.update({ where: { id, tenantId }, data: { durum: "tamamlandi", uretilenMiktar: emir.planlananMiktar, toplamMaliyet, tamamlanmaTarihi: new Date() } });
    });
  }

  async kaliteKontrolleri(durum?: string) {
    const { tenantId } = aktifBaglam();
    const filtre = ["bekliyor", "yeniden_isleme", "kabul", "red"].includes(durum ?? "") ? durum as "bekliyor" | "yeniden_isleme" | "kabul" | "red" : undefined;
    return this.prisma.tenantIslem(tenantId, (tx) => tx.uretimKaliteKontrol.findMany({ where: filtre ? { durum: filtre } : undefined, orderBy: { createdAt: "desc" }, include: { karantinaDepo: { select: { kod: true, ad: true } }, uretimBildirimi: true, uretimEmri: { include: { stok: { select: { kod: true, ad: true, anaBirim: true, takipTipi: true } }, hedefDepo: { select: { kod: true, ad: true } } } } } }));
  }

  async kaliteKarari(id: string, girdi: z.infer<typeof kaliteKararSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kontrol = await tx.uretimKaliteKontrol.findFirst({ where: { id, durum: "bekliyor" }, include: { uretimBildirimi: true, uretimEmri: { include: { stok: true, kalemler: true } } } });
      if (!kontrol) throw new NotFoundException("Bekleyen kalite kontrol kaydı bulunamadı");
      if (girdi.karar === "yeniden_isleme") {
        const sonuc = await tx.uretimKaliteKontrol.updateMany({ where: { id, durum: "bekliyor" }, data: { durum: "yeniden_isleme", kontrolNotu: girdi.kontrolNotu, olcumler: girdi.olcumler ?? undefined, kontrolEdenUserId: userId, kontrolZamani: new Date(), yenidenIslemeSayisi: { increment: 1 }, yenidenIslemeBaslangic: new Date(), yenidenIslemeBitis: null } });
        if (sonuc.count !== 1) throw new BadRequestException("Kalite kaydı başka bir işlem tarafından değiştirildi");
        await tx.uretimEmri.update({ where: { id: kontrol.uretimEmriId, tenantId }, data: { durum: "kalite_bekliyor", yenidenIslemeMiktari: { increment: kontrol.miktar } } });
        return tx.uretimKaliteKontrol.findUniqueOrThrow({ where: { id }, include: { uretimEmri: { include: { stok: true } }, karantinaDepo: true } });
      }
      const birimMaliyet = D(kontrol.uretimBildirimi.toplamMaliyet).div(kontrol.miktar).toDecimalPlaces(4);
      const cikis = await this.stokService.hareketEkle(tx, { stokId: kontrol.uretimEmri.stokId, depoId: kontrol.karantinaDepoId, tip: "cikis", miktar: kontrol.miktar, girilenBirim: kontrol.uretimEmri.stok.anaBirim, girilenMiktar: kontrol.miktar, birimMaliyet: D(0), tarih: new Date(), aciklama: `${kontrol.uretimEmri.no} kalite ${girdi.karar === "kabul" ? "kabul" : "red"} çıkışı`, kaynakTur: `uretim_kalite_${girdi.karar}`, kaynakRef: kontrol.id });
      if (girdi.karar === "kabul") {
        await this.stokService.hareketEkle(tx, { stokId: kontrol.uretimEmri.stokId, depoId: kontrol.uretimEmri.hedefDepoId, tip: "giris", miktar: kontrol.miktar, girilenBirim: kontrol.uretimEmri.stok.anaBirim, girilenMiktar: kontrol.miktar, birimMaliyet, tarih: new Date(), aciklama: `${kontrol.uretimEmri.no} kalite kabul girişi`, kaynakTur: "uretim_kalite_kabul", kaynakRef: kontrol.id, partiler: cikis.partiTahsisleri });
      }
      const sonuc = await tx.uretimKaliteKontrol.updateMany({ where: { id, durum: "bekliyor" }, data: { durum: girdi.karar, kontrolNotu: girdi.kontrolNotu, olcumler: girdi.olcumler ?? undefined, kontrolEdenUserId: userId, kontrolZamani: new Date() } });
      if (sonuc.count !== 1) throw new BadRequestException("Kalite kararı başka bir işlem tarafından verilmiş");
      if (girdi.karar === "red") {
        for (const kalem of kontrol.uretimEmri.kalemler) {
          const ekIhtiyac = D(kalem.planlananMiktar).mul(kontrol.miktar).div(kontrol.uretimEmri.planlananMiktar).toDecimalPlaces(3);
          if (ekIhtiyac.gt(0)) await tx.uretimEmriKalem.update({ where: { id: kalem.id, tenantId }, data: { ekIhtiyacMiktari: { increment: ekIhtiyac } } });
        }
      }
      const bekleyen = await tx.uretimKaliteKontrol.count({ where: { uretimEmriId: kontrol.uretimEmriId, durum: "bekliyor", id: { not: id } } });
      if (!bekleyen) {
        const emir = await tx.uretimEmri.findUniqueOrThrow({ where: { id: kontrol.uretimEmriId, tenantId } });
        const kabulEdilen = girdi.karar === "red" ? D(emir.uretilenMiktar).sub(kontrol.miktar) : D(emir.uretilenMiktar);
        const tamamlandi = kabulEdilen.gte(emir.planlananMiktar);
        await tx.uretimEmri.update({ where: { id: emir.id, tenantId }, data: {
          durum: tamamlandi ? "tamamlandi" : girdi.karar === "red" ? "malzeme_bekliyor" : "kismen_tamamlandi",
          uretilenMiktar: kabulEdilen,
          tamamlanmaTarihi: tamamlandi ? new Date() : null,
        } });
        if (tamamlandi) await this.emirRezervasyonlariniCoz(tx, emir.id);
      }
      return tx.uretimKaliteKontrol.findUniqueOrThrow({ where: { id }, include: { uretimEmri: { include: { stok: true } }, karantinaDepo: true } });
    });
  }

  async yenidenIslemeTamamla(id: string, girdi: z.infer<typeof yenidenIslemeTamamlaSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kontrol = await tx.uretimKaliteKontrol.findFirst({ where: { id, durum: "yeniden_isleme" } });
      if (!kontrol) throw new NotFoundException("Yeniden işlemede kalite kaydı bulunamadı");
      const sonuc = await tx.uretimKaliteKontrol.updateMany({ where: { id, durum: "yeniden_isleme" }, data: { durum: "bekliyor", kontrolNotu: girdi.aciklama, kontrolZamani: null, kontrolEdenUserId: null, yenidenIslemeBitis: new Date() } });
      if (sonuc.count !== 1) throw new BadRequestException("Yeniden işleme kaydı başka bir işlem tarafından değiştirildi");
      return tx.uretimKaliteKontrol.findUniqueOrThrow({ where: { id }, include: { uretimEmri: { include: { stok: true } }, karantinaDepo: true } });
    });
  }

  async sarfDuzelt(id: string, girdi: z.infer<typeof sarfDuzeltmeSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.uretimDonemiAcikOlmali(tx, new Date());
      const onceki = await tx.uretimSarfDuzeltme.findUnique({ where: { tenantId_idempotencyAnahtari: { tenantId, idempotencyAnahtari: girdi.idempotencyAnahtari } } });
      if (onceki) {
        if (onceki.uretimEmriId !== id) throw new BadRequestException("Düzeltme anahtarı başka bir üretim emrinde kullanılmış");
        return onceki;
      }
      const kalem = await tx.uretimEmriKalem.findFirst({ where: { id: girdi.uretimEmriKalemId, uretimEmriId: id, tenantId }, include: { malzeme: true, uretimEmri: true } });
      if (!kalem) throw new NotFoundException("Üretim emri malzemesi bulunamadı");
      if (!["uretimde", "kismen_tamamlandi", "kalite_bekliyor", "malzeme_bekliyor"].includes(kalem.uretimEmri.durum)) throw new BadRequestException("Bu durumdaki üretim emrinde sarf düzeltilemez");
      const miktar = D(girdi.miktar);
      if (girdi.tip === "iade" && miktar.gt(kalem.sarfEdilenMiktar)) throw new BadRequestException("İade miktarı toplam gerçek sarfı aşamaz");
      const seriler = girdi.seriNumaralari ?? [];
      if (girdi.tip === "iade" && kalem.malzeme.takipTipi === "lot" && !girdi.lotNo) throw new BadRequestException("Lot takipli malzeme iadesinde lot numarası gerekli");
      if (girdi.tip === "iade" && kalem.malzeme.takipTipi === "seri" && (!miktar.isInteger() || seriler.length !== miktar.toNumber() || new Set(seriler).size !== seriler.length)) throw new BadRequestException("Seri takipli iadede miktar kadar benzersiz seri numarası gerekli");
      const partiler = girdi.tip === "iade" && kalem.malzeme.takipTipi === "lot" ? [{ lotNo: girdi.lotNo!, miktar }] : girdi.tip === "iade" && kalem.malzeme.takipTipi === "seri" ? seriler.map((seriNo) => ({ lotNo: girdi.lotNo ?? kalem.uretimEmri.no, seriNo, miktar: D(1) })) : undefined;
      const sonuc = await this.stokService.hareketEkle(tx, { stokId: kalem.malzemeStokId, varyantId: kalem.malzemeVaryantId, depoId: girdi.depoId, tip: girdi.tip === "ek_sarf" ? "cikis" : "giris", miktar, girilenBirim: kalem.malzeme.anaBirim, girilenMiktar: miktar, birimMaliyet: girdi.tip === "iade" ? kalem.birimMaliyet : D(0), tarih: new Date(), aciklama: `${kalem.uretimEmri.no} ${girdi.tip === "ek_sarf" ? "ek sarf" : "malzeme iadesi"}: ${girdi.neden}`, kaynakTur: `uretim_sarf_${girdi.tip}`, kaynakRef: girdi.idempotencyAnahtari, partiler });
      const birimMaliyet = girdi.tip === "ek_sarf" ? D(kalem.malzeme.ortalamaMaliyet) : D(kalem.birimMaliyet);
      const maliyetFarki = miktar.mul(birimMaliyet).mul(girdi.tip === "ek_sarf" ? 1 : -1).toDecimalPlaces(4);
      await tx.uretimEmriKalem.update({ where: { id: kalem.id, tenantId }, data: { sarfEdilenMiktar: { increment: girdi.tip === "ek_sarf" ? miktar : miktar.negated() }, birimMaliyet } });
      await tx.uretimEmri.update({ where: { id, tenantId }, data: { toplamMaliyet: { increment: maliyetFarki } } });
      const partiBilgileri = sonuc.partiTahsisleri.map((p) => ({ ...p, miktar: p.miktar.toFixed(3) }));
      return tx.uretimSarfDuzeltme.create({ data: { tenantId, uretimEmriId: id, uretimEmriKalemId: kalem.id, depoId: girdi.depoId, tip: girdi.tip, miktar, birimMaliyet, neden: girdi.neden, idempotencyAnahtari: girdi.idempotencyAnahtari, partiBilgileri }, include: { depo: true, uretimEmriKalem: { include: { malzeme: true } } } });
    });
  }

  async iptal(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const emir = await tx.uretimEmri.findUnique({ where: { id, tenantId } });
      if (!emir) throw new NotFoundException("Üretim emri bulunamadı");
      if (!["taslak", "planlandi", "malzeme_bekliyor", "hazir"].includes(emir.durum)) throw new BadRequestException("Başlamış veya tamamlanmış üretim emri iptal edilemez");
      await this.emirRezervasyonlariniCoz(tx, id);
      const sonuc = await tx.uretimEmri.updateMany({ where: { id, tenantId, durum: emir.durum }, data: { durum: "iptal" } });
      if (sonuc.count !== 1) throw new BadRequestException("Üretim emrinin durumu başka bir işlem tarafından değiştirildi");
      return tx.uretimEmri.findUniqueOrThrow({ where: { id, tenantId } });
    });
  }

  private async uretimDonemiAcikOlmali(tx: Prisma.TransactionClient, tarih: Date) {
    const kilit = await tx.uretimDonemKilidi.findFirst({ where: { yil: tarih.getFullYear(), ay: tarih.getMonth() + 1 } });
    if (kilit) throw new BadRequestException(`${String(kilit.ay).padStart(2, "0")}/${kilit.yil} üretim dönemi kapalı; bu tarihe hareket kaydedilemez`);
  }

  private aktifRezervMiktari(rezervasyon: { rezerveMiktar: Prisma.Decimal; sarfEdilenMiktar: Prisma.Decimal; cozulenMiktar: Prisma.Decimal }) {
    return Prisma.Decimal.max(D(0), D(rezervasyon.rezerveMiktar).sub(rezervasyon.sarfEdilenMiktar).sub(rezervasyon.cozulenMiktar));
  }

  private async rezervasyonBakiyesiCoz(
    tx: Prisma.TransactionClient,
    kalem: { malzemeStokId: string; malzemeVaryantId: string | null },
    depoId: string,
    miktar: Prisma.Decimal,
    rezervasyonId: string,
    neden: "sarf" | "iptal",
  ) {
    const { tenantId } = aktifBaglam();
    await tx.stokKart.update({ where: { id: kalem.malzemeStokId }, data: { rezerveMiktar: { decrement: miktar } } });
    await tx.stokDepoBakiye.update({ where: { tenantId_stokId_depoId: { tenantId, stokId: kalem.malzemeStokId, depoId } }, data: { rezerveMiktar: { decrement: miktar } } });
    if (kalem.malzemeVaryantId) {
      await tx.stokVaryant.update({ where: { id: kalem.malzemeVaryantId }, data: { rezerveMiktar: { decrement: miktar } } });
      await tx.stokVaryantDepoBakiye.update({ where: { tenantId_varyantId_depoId: { tenantId, varyantId: kalem.malzemeVaryantId, depoId } }, data: { rezerveMiktar: { decrement: miktar } } });
    }
    await tx.uretimMalzemeRezervasyon.update({ where: { id: rezervasyonId }, data: neden === "sarf" ? { sarfEdilenMiktar: { increment: miktar } } : { cozulenMiktar: { increment: miktar } } });
  }

  private async emirRezervasyonlariniCoz(tx: Prisma.TransactionClient, emirId: string) {
    const rezervasyonlar = await tx.uretimMalzemeRezervasyon.findMany({ where: { uretimEmriKalem: { uretimEmriId: emirId } }, include: { uretimEmriKalem: true } });
    for (const rezervasyon of rezervasyonlar) {
      const aktifMiktar = this.aktifRezervMiktari(rezervasyon);
      if (aktifMiktar.gt(0)) await this.rezervasyonBakiyesiCoz(tx, rezervasyon.uretimEmriKalem, rezervasyon.depoId, aktifMiktar, rezervasyon.id, "iptal");
    }
  }

  private async durumGecisi(id: string, kaynaklar: ("taslak" | "planlandi" | "hazir")[], hedef: "planlandi" | "uretimde", hataMesaji: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = await tx.uretimEmri.updateMany({ where: { id, tenantId, durum: { in: kaynaklar } }, data: { durum: hedef } });
      if (sonuc.count !== 1) throw new BadRequestException(hataMesaji);
      return tx.uretimEmri.findUniqueOrThrow({ where: { id, tenantId }, include: { stok: true, hedefDepo: true, kalemler: { include: { malzeme: true, malzemeVaryant: true } } } });
    });
  }

  async uretilebilirUrunler() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.urunRecetesi.findMany({ where: { aktif: true, durum: "aktif", stok: { aktif: true } }, orderBy: { stok: { ad: "asc" } }, include: { stok: { select: { id: true, kod: true, ad: true, anaBirim: true, mevcutMiktar: true, takipTipi: true } }, _count: { select: { kalemler: true } } } }));
  }
}
