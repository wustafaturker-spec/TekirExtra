import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AuthService } from "../auth/auth.service";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

@Injectable()
export class DonemKapatmaService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}

  listele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.maliDonem.findMany({ orderBy: [{ yil: "desc" }, { ay: "desc" }], include: { kontroller: true, olaylar: { orderBy: { createdAt: "desc" }, include: { kullanici: { select: { id: true, adSoyad: true } } } } } }));
  }

  async kontrolleriCalistir(yil: number, ay: number) {
    const { tenantId } = aktifBaglam();
    const baslangic = new Date(yil, ay - 1, 1), bitis = new Date(yil, ay, 1);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const donem = await tx.maliDonem.upsert({ where: { tenantId_yil_ay: { tenantId, yil, ay } }, create: { tenantId, yil, ay }, update: {} });
      if (donem.durum === "kapali") throw new ConflictException("Kapalı dönemin kontrolleri değiştirilemez");
      const [taslakFatura, ebelgeHata, taslakMasraf, kritikDuzeltme, bekleyenBanka, taslakSayim, bekleyenGelenEbelge, bekleyenPazaryeri, eksikPosHareketi, baglantisizKartOdemesi] = await Promise.all([
        tx.fatura.count({ where: { tarih: { gte: baslangic, lt: bitis }, durum: "taslak" } }),
        tx.fatura.count({ where: { tarih: { gte: baslangic, lt: bitis }, ebelge: { durum: { in: ["hata", "ret"] } } } }),
        tx.masraf.count({ where: { tarih: { gte: baslangic, lt: bitis }, durum: "taslak" } }),
        tx.duzeltmeKaydi.count({ where: { onem: "kritik", durum: { in: ["acik", "incelemede", "beklemede"] } } }),
        tx.bankaEkstreSatir.count({ where: { tarih: { gte: baslangic, lt: bitis }, durum: "beklemede" } }),
        tx.sayim.count({ where: { tarih: { gte: baslangic, lt: bitis }, durum: "taslak" } }),
        tx.gelenEbelge.count({ where: { tarih: { gte: baslangic, lt: bitis }, durum: "beklemede" } }),
        tx.pazaryeriSiparis.count({ where: { siparisTarihi: { gte: baslangic, lt: bitis }, durum: { in: ["yeni", "esleme_bekliyor", "faturalanmaya_hazir", "hata"] } } }),
        tx.posTahsilat.count({ where: { durum: "odendi", odemeTarihi: { gte: baslangic, lt: bitis }, hareketId: null } }),
        tx.krediKartiHareket.count({ where: { tenantId, tarih: { gte: baslangic, lt: bitis }, tip: "odeme", bankaHareketId: null } }),
      ]);
      const sonuclar = [
        { kod: "TASLAK_FATURA", sayi: taslakFatura, aciklama: `${taslakFatura} taslak fatura var` },
        { kod: "EBELGE_HATA", sayi: ebelgeHata, aciklama: `${ebelgeHata} hatalı/reddedilmiş e-belge var` },
        { kod: "TASLAK_MASRAF", sayi: taslakMasraf, aciklama: `${taslakMasraf} taslak masraf var` },
        { kod: "KRITIK_DUZELTME", sayi: kritikDuzeltme, aciklama: `${kritikDuzeltme} açık kritik düzeltme var` },
        { kod: "BANKA_MUTABAKATI", sayi: bekleyenBanka, aciklama: `${bekleyenBanka} eşleşmemiş banka ekstre satırı var` },
        { kod: "STOK_SAYIMI", sayi: taslakSayim, aciklama: `${taslakSayim} onaysız stok sayımı var` },
        { kod: "GELEN_EBELGE", sayi: bekleyenGelenEbelge, aciklama: `${bekleyenGelenEbelge} işlenmemiş gelen e-belge var` },
        { kod: "PAZARYERI_SIPARISI", sayi: bekleyenPazaryeri, aciklama: `${bekleyenPazaryeri} sonuçlanmamış pazaryeri siparişi var` },
        { kod: "POS_HAREKETI", sayi: eksikPosHareketi, aciklama: `${eksikPosHareketi} finans hareketi oluşmamış başarılı POS tahsilatı var` },
        { kod: "KART_MUTABAKATI", sayi: baglantisizKartOdemesi, aciklama: `${baglantisizKartOdemesi} banka hareketine bağlanmamış kredi kartı ödemesi var` },
      ];
      await Promise.all(sonuclar.map((s) => tx.donemKontrolu.upsert({ where: { maliDonemId_kod: { maliDonemId: donem.id, kod: s.kod } }, create: { tenantId, maliDonemId: donem.id, kod: s.kod, basarili: s.sayi === 0, aciklama: s.aciklama, detay: { sayi: s.sayi } }, update: { basarili: s.sayi === 0, aciklama: s.aciklama, detay: { sayi: s.sayi }, kontrolAt: new Date() } })));
      return tx.maliDonem.findUnique({ where: { id: donem.id }, include: { kontroller: true } });
    });
  }

  async kapat(yil: number, ay: number, gerekce: string) {
    const { tenantId, userId } = aktifBaglam();
    await this.kontrolleriCalistir(yil, ay);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const donem = await tx.maliDonem.findUnique({ where: { tenantId_yil_ay: { tenantId, yil, ay } }, include: { kontroller: true } });
      if (!donem) throw new NotFoundException("Mali dönem bulunamadı");
      const basarisiz = donem.kontroller.filter((k) => !k.basarili);
      if (basarisiz.length) throw new BadRequestException(`Dönem kapatılamaz: ${basarisiz.map((k) => k.aciklama).join("; ")}`);
      if (donem.durum === "kapali") throw new ConflictException("Mali dönem zaten kapalı");
      await tx.maliDonemOlayi.create({ data: { tenantId, maliDonemId: donem.id, tur: "kapatildi", gerekce, userId } });
      return tx.maliDonem.update({ where: { id: donem.id }, data: { durum: "kapali", kapatildiAt: new Date() }, include: { kontroller: true } });
    });
  }

  async yenidenAc(id: string, gerekce: string, totpKodu: string) {
    const { tenantId, userId } = aktifBaglam();
    await this.auth.kritikIslemTotpDogrula(totpKodu);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const donem = await tx.maliDonem.findUnique({ where: { id } });
      if (!donem) throw new NotFoundException("Mali dönem bulunamadı");
      if (donem.durum !== "kapali") throw new ConflictException("Mali dönem zaten açık");
      await tx.maliDonemOlayi.create({ data: { tenantId, maliDonemId: id, tur: "yeniden_acildi", gerekce, userId } });
      return tx.maliDonem.update({ where: { id }, data: { durum: "acik", kapatildiAt: null } });
    });
  }

  async kanitPaketi(id: string) {
    const { tenantId } = aktifBaglam();
    const donem = await this.prisma.tenantIslem(tenantId, (tx) => tx.maliDonem.findUnique({
      where: { id }, include: { kontroller: { orderBy: { kod: "asc" } }, olaylar: { orderBy: { createdAt: "asc" }, include: { kullanici: { select: { id: true, adSoyad: true } } } } },
    }));
    if (!donem) throw new NotFoundException("Mali dönem bulunamadı");
    const manifest = {
      format: "tekirextra-mali-donem-kanit-1", olusturulmaZamani: new Date().toISOString(),
      donem: { id: donem.id, tenantId, yil: donem.yil, ay: donem.ay, durum: donem.durum, kapatildiAt: donem.kapatildiAt },
      kontroller: donem.kontroller.map(({ id: kontrolId, maliDonemId: _maliDonemId, tenantId: _tenantId, ...kontrol }) => ({ id: kontrolId, ...kontrol })),
      olaylar: donem.olaylar.map(({ id: olayId, maliDonemId: _maliDonemId, tenantId: _tenantId, ...olay }) => ({ id: olayId, ...olay })),
    };
    return { manifest, sha256: createHash("sha256").update(JSON.stringify(manifest), "utf8").digest("hex") };
  }
}
