import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { DINI_BAYRAM_YILLARI, resmiTatiller } from "@tekirextra/shared";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

/** Günün tatil katsayısı: tam gün tatil 0, yarım gün (arife) 0,5. Anahtar YYYY-MM-DD. */
export type TatilHaritasi = Map<string, number>;

/**
 * Firmanın tek çalışma takvimi: gün başlangıç saati (ayar) ve tatil günleri.
 * Tatiller personel izinleriyle aynı tablodadır; izin günü sayımı ile üretim
 * planı aynı takvimi kullanır.
 */
@Injectable()
export class CalismaTakvimiService {
  constructor(private readonly prisma: PrismaService, private readonly ayarlar: AyarlarService) {}

  async tatiller(yil?: number) {
    const { tenantId } = aktifBaglam();
    const aralik = yil ? { tarih: { gte: new Date(Date.UTC(yil, 0, 1)), lte: new Date(Date.UTC(yil, 11, 31)) } } : {};
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelTatilGunu.findMany({ where: { tenantId, ...aralik }, orderBy: { tarih: "asc" } }));
  }

  async tatilKaydet(girdi: { tarih: Date; ad: string; yarimGun: boolean }) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelTatilGunu.upsert({ where: { tenantId_tarih: { tenantId, tarih: girdi.tarih } }, create: { tenantId, ...girdi }, update: { ad: girdi.ad, yarimGun: girdi.yarimGun } }));
  }

  async tatilSil(id: string) {
    const { tenantId } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelTatilGunu.deleteMany({ where: { id, tenantId } }));
    if (!sonuc.count) throw new NotFoundException("Tatil günü bulunamadı");
  }

  /** Yılın resmî tatillerini ekler; elle girilmiş ya da düzeltilmiş günlere dokunmaz. */
  async resmiTatilleriYukle(yil: number) {
    const { tenantId } = aktifBaglam();
    const liste = resmiTatiller(yil);
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelTatilGunu.createMany({ data: liste.map((t) => ({ tenantId, tarih: new Date(t.tarih), ad: t.ad, yarimGun: t.yarimGun })), skipDuplicates: true }));
    return { eklenen: sonuc.count, mevcut: liste.length - sonuc.count, diniBayramlarVar: DINI_BAYRAM_YILLARI.includes(yil) };
  }

  /** Günün başlangıç saati (SS:DD); üretim operasyonları bu saatten planlanır. */
  async gunBaslangicSaati(tx?: Prisma.TransactionClient): Promise<string> {
    const ayar = await this.ayarlar.getir("calisma_takvimi", tx);
    return String(ayar.gunBaslangicSaati ?? "08:00");
  }

  /** Aralıktaki tatiller, gün anahtarıyla (işlem içinden okunabilir). */
  async tatilHaritasi(tx: Prisma.TransactionClient, ilk: Date, son: Date): Promise<TatilHaritasi> {
    const { tenantId } = aktifBaglam();
    const gunler = await tx.personelTatilGunu.findMany({ where: { tenantId, tarih: { gte: new Date(ilk.toISOString().slice(0, 10)), lte: son } }, select: { tarih: true, yarimGun: true } });
    return new Map(gunler.map((g) => [g.tarih.toISOString().slice(0, 10), g.yarimGun ? 0.5 : 0]));
  }
}
