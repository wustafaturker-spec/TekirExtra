import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { hakedisAdaylari, hakedisGeriAlTx, hakedisKaydet } from "./hakedis-kayit";
import { unvanPazaryerineUyar } from "./pazaryeri-eslestirme";

/**
 * PZR-13: pazaryeri hakedişi — bağlantının pazaryeri carisi, bekleyen banka
 * girişleri, öneri, kayıt, liste ve geri alma. Kayıt mantığı `hakedis-kayit`.
 */
@Injectable()
export class PazaryeriHakedisService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly donemKilidi?: DonemKilidiService) {}

  /** Bağlantılar, pazaryeri carisi ve VKN'den önerilen cari. */
  async baglantilar() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const baglantilar = await tx.baglanti.findMany({ where: { aile: "pazaryeri" }, select: { id: true, saglayici: true, faturaKesenVkn: true, pazaryeriCariId: true, pazaryeriCari: { select: { id: true, unvan: true } } }, orderBy: { createdAt: "asc" } });
      const vknler = baglantilar.map((b) => b.faturaKesenVkn).filter((v): v is string => Boolean(v));
      const cariler = vknler.length ? await tx.cariHesap.findMany({ where: { vknTckn: { in: vknler }, aktif: true }, select: { id: true, unvan: true, vknTckn: true } }) : [];
      return baglantilar.map((b) => ({ ...b, cariOnerisi: b.pazaryeriCariId ? null : cariler.find((c) => c.vknTckn === b.faturaKesenVkn) ?? null }));
    });
  }

  async pazaryeriCarisiAyarla(baglantiId: string, cariId: string | null) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const b = await tx.baglanti.findFirst({ where: { id: baglantiId, aile: "pazaryeri" }, select: { id: true } });
      if (!b) throw new NotFoundException("Pazaryeri bağlantısı bulunamadı");
      if (cariId && !(await tx.cariHesap.findFirst({ where: { id: cariId, aktif: true }, select: { id: true } }))) throw new BadRequestException("Aktif cari hesap bulunamadı");
      await tx.baglanti.update({ where: { id: baglantiId }, data: { pazaryeriCariId: cariId } });
      return { baglantiId, pazaryeriCariId: cariId };
    });
  }

  /** Bekleyen banka girişleri (son 120 gün); karşı ünvandan bağlantı önerilir. */
  async ekstreSatirlari() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [satirlar, baglantilar] = await Promise.all([
        tx.bankaEkstreSatir.findMany({
          where: { durum: "beklemede", tutar: { gt: 0 }, tarih: { gte: new Date(Date.now() - 120 * 86_400_000) } },
          select: { id: true, tarih: true, tutar: true, aciklama: true, karsiUnvan: true, bankaHesap: { select: { ad: true, dovizCinsi: true } } },
          orderBy: [{ tarih: "desc" }, { id: "asc" }], take: 300,
        }),
        tx.baglanti.findMany({ where: { aile: "pazaryeri" }, select: { id: true, saglayici: true } }),
      ]);
      return satirlar.map((s) => {
        const metin = `${s.karsiUnvan ?? ""} ${s.aciklama}`;
        const oneri = baglantilar.find((b) => unvanPazaryerineUyar(b.saglayici, metin));
        return { ...s, tutar: s.tutar.toFixed(2), onerilenBaglantiId: oneri?.id ?? null };
      }).sort((a, b) => Number(Boolean(b.onerilenBaglantiId)) - Number(Boolean(a.onerilenBaglantiId)));
    });
  }

  async adaylar(ekstreSatirId: string, baglantiId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => hakedisAdaylari(tx, ekstreSatirId, baglantiId), { timeout: 30_000 });
  }

  async kaydet(girdi: { ekstreSatirId: string; baglantiId: string; siparisIds: string[]; kesintiIds: string[] }) {
    const { tenantId } = aktifBaglam();
    const satir = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaEkstreSatir.findUnique({ where: { id: girdi.ekstreSatirId }, select: { tarih: true } }));
    if (!satir) throw new NotFoundException("Ekstre satırı bulunamadı");
    await this.donemKilidi?.tarihDogrula(tenantId, satir.tarih, "pazaryeri hakedişi");
    return this.prisma.tenantIslem(tenantId, (tx) => hakedisKaydet(tx, tenantId, girdi), { timeout: 60_000 });
  }

  async liste() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const hakedisler = await tx.pazaryeriHakedis.findMany({
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }], take: 200,
        include: { baglanti: { select: { saglayici: true } }, pazaryeriCari: { select: { unvan: true } }, ekstreSatir: { select: { aciklama: true } }, _count: { select: { siparisler: true, kesintiler: true } } },
      });
      return hakedisler.map((h) => ({
        id: h.id, tarih: h.tarih, saglayici: h.baglanti.saglayici, pazaryeriCari: h.pazaryeriCari.unvan, aciklama: h.ekstreSatir.aciklama, dovizCinsi: h.dovizCinsi,
        bankaTutari: h.bankaTutari.toFixed(2), siparisToplami: h.siparisToplami.toFixed(2), kesintiToplami: h.kesintiToplami.toFixed(2), stopajToplami: h.stopajToplami.toFixed(2), fark: h.fark.toFixed(2),
        siparisSayisi: h._count.siparisler, kesintiSayisi: h._count.kesintiler,
      }));
    });
  }

  /** Hakedişi geri alır; ekstre satırı bekleyene döner. */
  async geriAl(hakedisId: string) {
    const { tenantId, userId } = aktifBaglam();
    const h = await this.prisma.tenantIslem(tenantId, (tx) => tx.pazaryeriHakedis.findUnique({ where: { id: hakedisId }, select: { tarih: true } }));
    if (!h) throw new NotFoundException("Hakediş bulunamadı");
    await this.donemKilidi?.tarihDogrula(tenantId, h.tarih, "pazaryeri hakedişini geri alma");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const { ekstreSatirId } = await hakedisGeriAlTx(tx, tenantId, hakedisId);
      await tx.bankaEkstreSatir.update({ where: { id: ekstreSatirId }, data: { durum: "beklemede", eslesmeTuru: null, cariId: null, faturaId: null } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "pazaryeri_hakedisi_geri_alindi", varlik: "pazaryeri", varlikId: hakedisId, detay: { ekstreSatirId } } });
      return { geriAlindi: true, ekstreSatirId };
    }, { timeout: 60_000 });
  }
}
