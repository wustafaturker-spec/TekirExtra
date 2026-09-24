import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Rol } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../core/prisma.service";
import { b2bSiparisOlusturSemasi } from "./b2b.semalar";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);

@Injectable()
export class B2bService {
  constructor(private readonly prisma: PrismaService, private readonly donemKilidi: DonemKilidiService) {}

  private async hedefCariId(tenantId: string, userId: string, rol: Rol, istenenCariId?: string) {
    if (rol !== "b2b_bayi") {
      if (!istenenCariId) throw new BadRequestException("Görüntülenecek bayi seçilmelidir");
      return istenenCariId;
    }
    const kullanici = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findFirst({ where: { id: userId, tenantId, aktif: true }, select: { bayiCariId: true } }),
    );
    if (!kullanici?.bayiCariId) throw new ForbiddenException("B2B kullanıcısına bayi hesabı atanmamış");
    if (istenenCariId && istenenCariId !== kullanici.bayiCariId) throw new ForbiddenException("Başka bir bayi hesabına erişemezsiniz");
    return kullanici.bayiCariId;
  }

  private async cariVeFiyatlar(tx: any, tenantId: string, cariId: string) {
    const cari = await tx.cariHesap.findFirst({ where: { id: cariId, tenantId, aktif: true }, include: { fiyatListesi: { include: { kalemler: true } } } });
    if (!cari) throw new NotFoundException("Bayi / cari hesap bulunamadı");
    const fiyatlar = new Map<string, Prisma.Decimal>();
    if (cari.fiyatListesi?.aktif) for (const kalem of cari.fiyatListesi.kalemler) fiyatlar.set(kalem.stokId, D(kalem.fiyat));
    return { cari, fiyatlar };
  }

  async bayiProfilGetir(tenantId: string, userId: string, rol: Rol, cariId?: string) {
    const hedef = await this.hedefCariId(tenantId, userId, rol, cariId);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const { cari } = await this.cariVeFiyatlar(tx, tenantId, hedef);
      return { id: cari.id, kod: cari.kod, unvan: cari.unvan };
    });
  }

  async bayiKatalogGetir(tenantId: string, userId: string, rol: Rol, cariId?: string) {
    const hedef = await this.hedefCariId(tenantId, userId, rol, cariId);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const { cari, fiyatlar } = await this.cariVeFiyatlar(tx, tenantId, hedef);
      const urunler = await tx.stokKart.findMany({ where: { tenantId, aktif: true, tip: "urun" }, select: { id: true, kod: true, ad: true, anaBirim: true, gorselUrl: true, satisFiyati: true, kdvOrani: true } });
      const iskonto = D(cari.varsayilanIskonto ?? 0);
      return urunler.map((urun: any) => {
        const listeFiyati = fiyatlar.get(urun.id) ?? D(urun.satisFiyati ?? 0);
        const bayiBirimFiyati = Prisma.Decimal.max(D(0), listeFiyati.mul(D(100).sub(iskonto)).div(100));
        return { ...urun, listeFiyati, bayiBirimFiyati, iskontoYuzdesi: iskonto };
      });
    });
  }

  async bayiEkstreGetir(tenantId: string, userId: string, rol: Rol, cariId?: string) {
    const hedef = await this.hedefCariId(tenantId, userId, rol, cariId);
    return this.prisma.tenantIslem(tenantId, (tx) => tx.cariHareket.findMany({ where: { tenantId, cariId: hedef }, orderBy: { tarih: "desc" }, take: 50 }));
  }

  async siparisOlustur(tenantId: string, userId: string, rol: Rol, girdi: z.infer<typeof b2bSiparisOlusturSemasi>) {
    const veri = b2bSiparisOlusturSemasi.parse(girdi);
    const cariId = await this.hedefCariId(tenantId, userId, rol, veri.cariId);
    await this.donemKilidi.tarihDogrula(tenantId, new Date(), "B2B siparişi oluşturma");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.belge.findUnique({ where: { tenantId_b2bIdempotencyAnahtari: { tenantId, b2bIdempotencyAnahtari: veri.idempotencyAnahtari } }, include: { satirlar: true } });
      if (mevcut) return mevcut;
      const { cari, fiyatlar } = await this.cariVeFiyatlar(tx, tenantId, cariId);
      const stokIdleri = [...new Set(veri.kalemler.map((kalem) => kalem.stokId))];
      const stoklar = await tx.stokKart.findMany({ where: { tenantId, id: { in: stokIdleri }, aktif: true, tip: "urun" } });
      if (stoklar.length !== stokIdleri.length) throw new BadRequestException("Siparişte bulunamayan, pasif veya satışa kapalı ürün var");
      const stokHaritasi = new Map(stoklar.map((stok: any) => [stok.id, stok]));
      const iskonto = D(cari.varsayilanIskonto ?? 0);
      let toplamBrut = D(0), toplamIskonto = D(0), toplamMatrah = D(0), toplamKdv = D(0);
      const belgeSatirlari = veri.kalemler.map((kalem) => {
        const stok: any = stokHaritasi.get(kalem.stokId)!;
        const hamBirimFiyat = fiyatlar.get(stok.id) ?? D(stok.satisFiyati ?? 0);
        const miktar = D(kalem.miktar), brut = hamBirimFiyat.mul(miktar);
        const iskontoTutari = brut.mul(iskonto).div(100).toDecimalPlaces(2);
        const matrah = brut.sub(iskontoTutari).toDecimalPlaces(2);
        const kdvTutari = matrah.mul(D(stok.kdvOrani)).div(100).toDecimalPlaces(2);
        toplamBrut = toplamBrut.add(brut); toplamIskonto = toplamIskonto.add(iskontoTutari); toplamMatrah = toplamMatrah.add(matrah); toplamKdv = toplamKdv.add(kdvTutari);
        return { tenantId, stokId: stok.id, miktar, birim: stok.anaBirim, birimFiyat: hamBirimFiyat, iskontoOrani: iskonto, iskontoTutari, matrah, kdvOrani: stok.kdvOrani, kdvTutari, netKdvTutari: kdvTutari, toplamTutar: matrah.add(kdvTutari), fiyatListesiId: cari.fiyatListesi?.aktif ? cari.fiyatListesi.id : null };
      });
      const yil = new Date().getFullYear();
      const sayac = await tx.belgeSayac.upsert({ where: { tenantId_tur_yon_yil: { tenantId, tur: "siparis", yon: "satis", yil } }, create: { tenantId, tur: "siparis", yil, sonSira: 1 }, update: { sonSira: { increment: 1 } } });
      return tx.belge.create({ data: { tenantId, tur: "siparis", yon: "satis", durum: "onaylandi", no: `SIP${yil}${String(sayac.sonSira).padStart(6, "0")}`, tarih: new Date(), cariId, toplamBrut, toplamSatirIskontosu: toplamIskonto, genelIskontoToplam: D(0), toplamMatrah, toplamKdv, toplamNetKdv: toplamKdv, genelToplam: toplamMatrah.add(toplamKdv), b2bIdempotencyAnahtari: veri.idempotencyAnahtari, aciklama: veri.aciklama || "B2B Bayi Portalı Siparişi", satirlar: { create: belgeSatirlari } }, include: { satirlar: true } });
    });
  }
}
