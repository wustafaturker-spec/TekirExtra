import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../core/prisma.service";
import { izinBakiyeDuzeltSemasi, izinTalepOlusturSemasi, izinTuruOlusturSemasi, tatilGunuSemasi } from "./izin.semalar";
import { hizmetYildonumleri, islenecekHakEdisler, yasHesapla, yillikIzinGunu } from "./izin-hak-edisi";

const YILLIK_KOD = "yillik";
const HAK_EDIS_ONEKI = "kidem:";

/**
 * İzin günü: pazar ve tam gün tatiller sayılmaz, arife yarım. Cumartesi
 * işyerinin haftada 6 gün çalışmasına bağlıdır (Çalışma Takvimi ayarı,
 * PRS-08); varsayılan sayılmaz.
 */
export function isGunuSayisi(baslangic: Date, bitis: Date, tatiller: { tarih: Date; yarimGun: boolean }[] = [], cumartesiIzinGunu = false): number {
  let gun = 0;
  const tatilHaritasi = new Map(tatiller.map((t) => [t.tarih.toISOString().slice(0, 10), t.yarimGun]));
  const tarih = new Date(Date.UTC(baslangic.getUTCFullYear(), baslangic.getUTCMonth(), baslangic.getUTCDate()));
  const son = new Date(Date.UTC(bitis.getUTCFullYear(), bitis.getUTCMonth(), bitis.getUTCDate()));
  while (tarih <= son) {
    const haftaGunu = tarih.getUTCDay();
    if (haftaGunu !== 0 && (haftaGunu !== 6 || cumartesiIzinGunu)) {
      const tatil = tatilHaritasi.get(tarih.toISOString().slice(0, 10));
      gun += tatil === undefined ? 1 : tatil ? 0.5 : 0;
    }
    tarih.setUTCDate(tarih.getUTCDate() + 1);
  }
  return gun;
}

@Injectable()
export class IzinService {
  constructor(private readonly prisma: PrismaService) {}

  async turleriListele(tenantId: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.varsayilanTurleriHazirla(tx, tenantId);
      return tx.personelIzinTuru.findMany({ where: { tenantId, aktif: true }, orderBy: { ad: "asc" } });
    });
  }

  async turOlustur(tenantId: string, girdi: z.infer<typeof izinTuruOlusturSemasi>) {
    const veri = izinTuruOlusturSemasi.parse(girdi);
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelIzinTuru.create({ data: { tenantId, ...veri } }));
  }

  async talepleriListele(tenantId: string, personelId?: string) {
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelIzinTalebi.findMany({
      where: { tenantId, ...(personelId ? { personelId } : {}) },
      include: { personel: { select: { id: true, personelNo: true, ad: true, soyad: true } }, izinTuru: true },
      orderBy: [{ baslangicTarihi: "desc" }, { createdAt: "desc" }],
    }));
  }

  async talepOlustur(tenantId: string, userId: string, girdi: z.infer<typeof izinTalepOlusturSemasi>) {
    const veri = izinTalepOlusturSemasi.parse(girdi);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [personel, izinTuru, cakisan, tatiller] = await Promise.all([
        tx.personel.findFirst({ where: { id: veri.personelId, tenantId, durum: "aktif" }, select: { id: true } }),
        tx.personelIzinTuru.findFirst({ where: { id: veri.izinTuruId, tenantId, aktif: true }, select: { id: true } }),
        tx.personelIzinTalebi.findFirst({ where: { tenantId, personelId: veri.personelId, durum: { in: ["talep", "onaylandi"] }, baslangicTarihi: { lte: veri.bitisTarihi }, bitisTarihi: { gte: veri.baslangicTarihi } }, select: { id: true } }),
        tx.personelTatilGunu.findMany({ where: { tenantId, tarih: { gte: veri.baslangicTarihi, lte: veri.bitisTarihi } }, select: { tarih: true, yarimGun: true } }),
      ]);
      if (!personel) throw new NotFoundException("Aktif personel bulunamadı");
      if (!izinTuru) throw new NotFoundException("İzin türü bulunamadı");
      if (cakisan) throw new BadRequestException("Personelin bu tarihlerle çakışan izin talebi vardır");
      const gunSayisi = isGunuSayisi(veri.baslangicTarihi, veri.bitisTarihi, tatiller, await this.cumartesiIzinGunu(tx, tenantId));
      if (gunSayisi < 0.5) throw new BadRequestException("İzin aralığında çalışma günü bulunmalıdır");
      return tx.personelIzinTalebi.create({ data: { tenantId, personelId: veri.personelId, izinTuruId: veri.izinTuruId, baslangicTarihi: veri.baslangicTarihi, bitisTarihi: veri.bitisTarihi, gunSayisi, aciklama: veri.aciklama || null, olusturanUserId: userId } });
    });
  }

  async tatilleriListele(tenantId: string, yil?: number) {
    const baslangic = yil ? new Date(Date.UTC(yil, 0, 1)) : undefined;
    const bitis = yil ? new Date(Date.UTC(yil, 11, 31)) : undefined;
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelTatilGunu.findMany({ where: { tenantId, ...(baslangic && bitis ? { tarih: { gte: baslangic, lte: bitis } } : {}) }, orderBy: { tarih: "asc" } }));
  }

  async tatilKaydet(tenantId: string, girdi: z.infer<typeof tatilGunuSemasi>) {
    const veri = tatilGunuSemasi.parse(girdi);
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelTatilGunu.upsert({ where: { tenantId_tarih: { tenantId, tarih: veri.tarih } }, create: { tenantId, ...veri }, update: { ad: veri.ad, yarimGun: veri.yarimGun } }));
  }

  async tatilSil(tenantId: string, id: string) {
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelTatilGunu.deleteMany({ where: { id, tenantId } }));
    if (!sonuc.count) throw new NotFoundException("Tatil günü bulunamadı");
  }

  async onayla(tenantId: string, id: string, userId: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const talep = await tx.personelIzinTalebi.findFirst({ where: { id, tenantId }, include: { izinTuru: true } });
      if (!talep) throw new NotFoundException("İzin talebi bulunamadı");
      if (talep.olusturanUserId === userId) throw new BadRequestException("İzin talebini oluşturan kullanıcı aynı talebi onaylayamaz");
      if (talep.durum !== "talep") throw new BadRequestException("Yalnızca bekleyen izin talebi onaylanabilir");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${talep.personelId}:${talep.izinTuruId}`}))`;
      if (talep.izinTuru.kod === YILLIK_KOD) await this.hakEdisleriIsle(tx, tenantId, talep.personelId);
      if (talep.izinTuru.bakiyeTakibi) {
        const bakiye = await this.bakiyeHesapla(tx, tenantId, talep.personelId, talep.izinTuruId);
        if (bakiye.lt(talep.gunSayisi)) throw new BadRequestException(`Yetersiz izin bakiyesi. Kullanılabilir: ${bakiye.toFixed(2)} gün`);
      }
      const guncellenen = await tx.personelIzinTalebi.updateMany({ where: { id, tenantId, durum: "talep" }, data: { durum: "onaylandi", onaylayanUserId: userId, kararTarihi: new Date(), kararNedeni: null } });
      if (guncellenen.count !== 1) throw new BadRequestException("İzin talebi eşzamanlı olarak işlenmiş");
      if (talep.izinTuru.bakiyeTakibi) await tx.personelIzinBakiyeHareketi.create({ data: { tenantId, personelId: talep.personelId, izinTuruId: talep.izinTuruId, izinTalebiId: talep.id, tip: "kullanim", gun: talep.gunSayisi, aciklama: "Onaylanan izin kullanımı" } });
      return tx.personelIzinTalebi.findUnique({ where: { id }, include: { personel: true, izinTuru: true } });
    });
  }

  async reddet(tenantId: string, id: string, userId: string, neden: string) {
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelIzinTalebi.updateMany({ where: { id, tenantId, durum: "talep" }, data: { durum: "reddedildi", onaylayanUserId: userId, kararTarihi: new Date(), kararNedeni: neden } }));
    if (sonuc.count !== 1) throw new BadRequestException("Yalnızca bekleyen izin talebi reddedilebilir");
    return { id, durum: "reddedildi" };
  }

  async iptal(tenantId: string, id: string, neden: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const talep = await tx.personelIzinTalebi.findFirst({ where: { id, tenantId }, include: { izinTuru: true } });
      if (!talep || !["talep", "onaylandi"].includes(talep.durum)) throw new BadRequestException("Bu izin talebi iptal edilemez");
      const oncekiDurum = talep.durum;
      await tx.personelIzinTalebi.update({ where: { id }, data: { durum: "iptal", kararTarihi: new Date(), kararNedeni: neden } });
      if (oncekiDurum === "onaylandi" && talep.izinTuru.bakiyeTakibi) await tx.personelIzinBakiyeHareketi.create({ data: { tenantId, personelId: talep.personelId, izinTuruId: talep.izinTuruId, izinTalebiId: talep.id, tip: "iade", gun: talep.gunSayisi, aciklama: `İzin iptali: ${neden}` } });
      return { id, durum: "iptal" };
    });
  }

  async bakiyeDuzelt(tenantId: string, girdi: z.infer<typeof izinBakiyeDuzeltSemasi>) {
    const veri = izinBakiyeDuzeltSemasi.parse(girdi);
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelIzinBakiyeHareketi.create({ data: { tenantId, personelId: veri.personelId, izinTuruId: veri.izinTuruId, tip: veri.tip, gun: veri.gun, aciklama: veri.aciklama } }));
  }

  async bakiyeler(tenantId: string, personelId: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.varsayilanTurleriHazirla(tx, tenantId);
      await this.hakEdisleriIsle(tx, tenantId, personelId);
      const turler = await tx.personelIzinTuru.findMany({ where: { tenantId, aktif: true, bakiyeTakibi: true } });
      return Promise.all(turler.map(async (tur) => ({ izinTuru: tur, bakiye: (await this.bakiyeHesapla(tx, tenantId, personelId, tur.id)).toFixed(2) })));
    });
  }

  private async cumartesiIzinGunu(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    const kayit = await tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: "calisma_takvimi" } }, select: { ayarlar: true } });
    return (kayit?.ayarlar as Record<string, unknown> | null)?.cumartesiIzinGunu === true;
  }

  /**
   * PRS-08: dolan hizmet yılları için yıllık izin hakkını yazar (idempotent,
   * `donemRef = kidem:N`). Bakiye görüntülenirken ve yıllık izin onaylanırken çağrılır.
   */
  async hakEdisleriIsle(tx: Prisma.TransactionClient, tenantId: string, personelId: string): Promise<number> {
    const [personel, tur] = await Promise.all([
      tx.personel.findFirst({ where: { id: personelId, tenantId }, select: { dogumTarihi: true, istihdamDonemleri: { select: { baslangicTarihi: true, bitisTarihi: true } } } }),
      tx.personelIzinTuru.findFirst({ where: { tenantId, kod: YILLIK_KOD }, select: { id: true } }),
    ]);
    if (!personel || !tur) return 0;
    const yildonumleri = hizmetYildonumleri(personel.istihdamDonemleri, new Date());
    const islenmis = await tx.personelIzinBakiyeHareketi.findMany({ where: { tenantId, personelId, izinTuruId: tur.id, donemRef: { startsWith: HAK_EDIS_ONEKI } }, select: { donemRef: true } });
    const yillar = islenecekHakEdisler(yildonumleri, islenmis.map((h) => Number(h.donemRef!.slice(HAK_EDIS_ONEKI.length))));
    if (!yillar.length) return 0;
    const sonuc = await tx.personelIzinBakiyeHareketi.createMany({
      data: yillar.map((n) => {
        const tarih = yildonumleri[n - 1];
        const yas = personel.dogumTarihi ? yasHesapla(personel.dogumTarihi, tarih) : null;
        const gun = yillikIzinGunu(n, yas);
        return { tenantId, personelId, izinTuruId: tur.id, tip: "hak_edis" as const, gun, donemRef: `${HAK_EDIS_ONEKI}${n}`, aciklama: `${n}. hizmet yılı yıllık izin hakkı (${tarih.toISOString().slice(0, 10)}, ${gun} gün)` };
      }),
      skipDuplicates: true,
    });
    return sonuc.count;
  }

  private async bakiyeHesapla(tx: Prisma.TransactionClient, tenantId: string, personelId: string, izinTuruId: string) {
    const hareketler = await tx.personelIzinBakiyeHareketi.findMany({ where: { tenantId, personelId, izinTuruId }, select: { tip: true, gun: true } });
    return hareketler.reduce((toplam, h) => ["kullanim", "duzeltme_azalis"].includes(h.tip) ? toplam.sub(h.gun) : toplam.add(h.gun), new Prisma.Decimal(0));
  }

  private async varsayilanTurleriHazirla(tx: Prisma.TransactionClient, tenantId: string) {
    const turler = [
      { kod: "yillik", ad: "Yıllık izin", ucretli: true, bakiyeTakibi: true },
      { kod: "mazeret", ad: "Mazeret izni", ucretli: true, bakiyeTakibi: false },
      { kod: "hastalik", ad: "Hastalık izni", ucretli: true, bakiyeTakibi: false },
      { kod: "ucretsiz", ad: "Ücretsiz izin", ucretli: false, bakiyeTakibi: false },
    ];
    for (const tur of turler) await tx.personelIzinTuru.upsert({ where: { tenantId_kod: { tenantId, kod: tur.kod } }, create: { tenantId, ...tur }, update: {} });
  }
}
