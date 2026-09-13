import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import type {
  projeAltKirilimSemasi,
  projeAsamaSemasi,
  projeGuncelleSemasi,
  projeNotSemasi,
  projeOlusturSemasi,
} from "./projeler.semalar";

const D = (deger: string | number): Prisma.Decimal => new Prisma.Decimal(deger);

@Injectable()
export class ProjelerService {
  constructor(private readonly prisma: PrismaService) {}

  async secenekler() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [cariler, kullanicilar] = await Promise.all([
        tx.cariHesap.findMany({
          where: { aktif: true },
          select: { id: true, kod: true, unvan: true },
          orderBy: { unvan: "asc" },
          take: 200,
        }),
        tx.user.findMany({
          where: { aktif: true },
          select: { id: true, adSoyad: true, eposta: true },
          orderBy: { adSoyad: "asc" },
        }),
      ]);
      return { cariler, kullanicilar };
    });
  }

  async listele(arama?: string, durum?: string) {
    const { tenantId } = aktifBaglam();
    const projeler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.proje.findMany({
        where: {
          tenantId,
          ...(durum ? { durum: durum as any } : {}),
          ...(arama
            ? {
                OR: [
                  { ad: { contains: arama, mode: "insensitive" } },
                  { kod: { contains: arama, mode: "insensitive" } },
                  { aciklama: { contains: arama, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }],
        include: {
          cari: { select: { id: true, unvan: true, kod: true } },
          sorumlu: { select: { id: true, adSoyad: true, eposta: true } },
          altKirilimlar: { select: { id: true, kod: true, ad: true, butceTutari: true, tip: true }, orderBy: { createdAt: "asc" } },
          _count: { select: { asamalar: true, altKirilimlar: true, notlarListesi: true } },
        },
      }),
    );

    // Her bir projenin anlık gelir/gider finansal özetlerini hesaplayalım
    const sonuclar = await Promise.all(
      projeler.map(async (p) => {
        const finans = await this.projeFinansOzeti(p.id);
        return {
          ...p,
          hedefGelir: p.hedefGelir.toString(),
          hedefGider: p.hedefGider.toString(),
          toplamGelir: finans.toplamGelir,
          toplamGider: finans.toplamGider,
          netKarZarar: finans.netKarZarar,
          gelirButceOrani: Number(p.hedefGelir) > 0 ? Math.round((Number(finans.toplamGelir) / Number(p.hedefGelir)) * 100) : null,
          giderButceOrani: Number(p.hedefGider) > 0 ? Math.round((Number(finans.toplamGider) / Number(p.hedefGider)) * 100) : null,
        };
      }),
    );

    return sonuclar;
  }

  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    const proje = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.proje.findUnique({
        where: { id, tenantId },
        include: {
          cari: { select: { id: true, unvan: true, kod: true } },
          sorumlu: { select: { id: true, adSoyad: true, eposta: true } },
          asamalar: { orderBy: { sira: "asc" } },
          altKirilimlar: { orderBy: { kod: "asc" } },
          notlarListesi: {
            orderBy: { createdAt: "desc" },
            include: { user: { select: { id: true, adSoyad: true } } },
          },
        },
      }),
    );

    if (!proje) throw new NotFoundException("Proje bulunamadı");

    const finans = await this.projeFinansOzeti(id);
    const analitikKirilimlar = await this.analitikYevmiyeKirilimlari(id, proje.altKirilimlar);

    return {
      ...proje,
      hedefGelir: proje.hedefGelir.toString(),
      hedefGider: proje.hedefGider.toString(),
      finansalOzet: finans,
      analitikKirilimlar,
    };
  }

  /** Ana kârlılık tahakkuk esaslıdır. Kasa/banka hareketleri çift sayımı
   * önlemek için toplamdan ayrılır ve nakit özeti olarak ayrıca döndürülür. */
  private async projeFinansOzeti(projeId: string) {
    const { tenantId } = aktifBaglam();

    const [faturaGelirleri, faturaGiderleri, masraflar, gelirKayitlari, finansHareketleri] =
      await Promise.all([
        // Satış Faturası Satırları (gelir)
        this.prisma.tenantIslem(tenantId, (tx) =>
          tx.faturaSatir.aggregate({
            where: { projeId, fatura: { tip: "satis", durum: { not: "iptal" } } },
            _sum: { toplamTutar: true },
          }),
        ),
        // Alış Faturası Satırları (gider)
        this.prisma.tenantIslem(tenantId, (tx) =>
          tx.faturaSatir.aggregate({
            where: { projeId, fatura: { tip: "alis", durum: { not: "iptal" } } },
            _sum: { toplamTutar: true },
          }),
        ),
        // Onaylanmış Masraf Kayıtları (gider)
        this.prisma.tenantIslem(tenantId, (tx) =>
          tx.masraf.aggregate({
            where: { projeId, durum: "onaylandi" },
            _sum: { toplam: true },
          }),
        ),
        // Gelir Kayıtları (gelir)
        this.prisma.tenantIslem(tenantId, (tx) =>
          tx.gelirKaydi.aggregate({
            where: { projeId, tenantId },
            _sum: { netTutarTry: true },
          }),
        ),
        // Doğrudan Kasa/Banka Giriş-Çıkışları
        this.prisma.tenantIslem(tenantId, (tx) =>
          tx.kasaBankaHareket.groupBy({
            by: ["tip"],
            where: { projeId },
            _sum: { tutarTry: true },
          }),
        ),
      ]);

    const satisFaturaGeliri = Number(faturaGelirleri._sum.toplamTutar ?? 0);
    const ekstraGelir = Number(gelirKayitlari._sum.netTutarTry ?? 0);
    const alisFaturaGideri = Number(faturaGiderleri._sum.toplamTutar ?? 0);
    const masrafGideri = Number(masraflar._sum.toplam ?? 0);

    let kasaTahsilat = 0;
    let kasaTediye = 0;
    for (const h of finansHareketleri) {
      if (h.tip === "tahsilat") kasaTahsilat += Number(h._sum.tutarTry ?? 0);
      if (h.tip === "tediye") kasaTediye += Number(h._sum.tutarTry ?? 0);
    }

    const toplamGelir = (satisFaturaGeliri + ekstraGelir).toFixed(2);
    const toplamGider = (alisFaturaGideri + masrafGideri).toFixed(2);
    const netKarZarar = (Number(toplamGelir) - Number(toplamGider)).toFixed(2);

    return {
      toplamGelir,
      toplamGider,
      netKarZarar,
      esas: "tahakkuk" as const,
      nakitOzet: {
        tahsilat: kasaTahsilat.toFixed(2),
        tediye: kasaTediye.toFixed(2),
        netNakitAkisi: (kasaTahsilat - kasaTediye).toFixed(2),
      },
      detay: {
        satisFaturaGeliri: satisFaturaGeliri.toFixed(2),
        ekstraGelir: ekstraGelir.toFixed(2),
        kasaTahsilat: kasaTahsilat.toFixed(2),
        alisFaturaGideri: alisFaturaGideri.toFixed(2),
        masrafGideri: masrafGideri.toFixed(2),
        kasaTediye: kasaTediye.toFixed(2),
      },
    };
  }

  /**
   * Analitik yevmiye / maliyet alt kırılımları bazında gerçekleşen harcama & gelir dağılımı.
   */
  private async analitikYevmiyeKirilimlari(projeId: string, altKirilimlar: any[]) {
    const { tenantId } = aktifBaglam();

    const kirilimDetaylari = await Promise.all(
      altKirilimlar.map(async (k) => {
        const [satisFaturalari, alisFaturalari, masraflar, gelirler] = await Promise.all([
          this.prisma.tenantIslem(tenantId, (tx) =>
            tx.faturaSatir.aggregate({
              where: { projeAltKirilimId: k.id, fatura: { tip: "satis", durum: { not: "iptal" } } },
              _sum: { toplamTutar: true },
            }),
          ),
          this.prisma.tenantIslem(tenantId, (tx) =>
            tx.faturaSatir.aggregate({
              where: { projeAltKirilimId: k.id, fatura: { tip: "alis", durum: { not: "iptal" } } },
              _sum: { toplamTutar: true },
            }),
          ),
          this.prisma.tenantIslem(tenantId, (tx) =>
            tx.masraf.aggregate({
              where: { projeAltKirilimId: k.id, durum: "onaylandi" },
              _sum: { toplam: true },
            }),
          ),
          this.prisma.tenantIslem(tenantId, (tx) =>
            tx.gelirKaydi.aggregate({
              where: { projeAltKirilimId: k.id, tenantId },
              _sum: { netTutarTry: true },
            }),
          ),
        ]);

        const gerceklesenGelir = Number(satisFaturalari._sum.toplamTutar ?? 0) + Number(gelirler._sum.netTutarTry ?? 0);
        const gerceklesenGider = Number(alisFaturalari._sum.toplamTutar ?? 0) + Number(masraflar._sum.toplam ?? 0);
        const netTutar = gerceklesenGelir - gerceklesenGider;
        const gerceklesenTutar = (k.tip === "gelir"
          ? gerceklesenGelir
          : k.tip === "gider"
            ? gerceklesenGider
            : Math.abs(netTutar)).toFixed(2);

        const butce = Number(k.butceTutari);
        const gerceklesen = Number(gerceklesenTutar);
        const sapma = (butce - gerceklesen).toFixed(2);

        return {
          ...k,
          butceTutari: k.butceTutari.toString(),
          gerceklesenTutar,
          gerceklesenGelir: gerceklesenGelir.toFixed(2),
          gerceklesenGider: gerceklesenGider.toFixed(2),
          netTutar: netTutar.toFixed(2),
          sapma,
          kullanimOrani: butce > 0 ? Math.round((gerceklesen / butce) * 100) : null,
        };
      }),
    );

    return kirilimDetaylari;
  }

  async olustur(girdi: z.infer<typeof projeOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    try {
      const proje = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.proje.create({
          data: {
            tenantId,
            kod: girdi.kod.trim().toUpperCase(),
            ad: girdi.ad.trim(),
            aciklama: girdi.aciklama || undefined,
            cariId: girdi.cariId || undefined,
            baslangicTarihi: girdi.baslangicTarihi ? new Date(girdi.baslangicTarihi) : undefined,
            bitisTarihi: girdi.bitisTarihi ? new Date(girdi.bitisTarihi) : undefined,
            durum: (girdi.durum as any) ?? "planlanan",
            sorumluUserId: girdi.sorumluUserId || undefined,
            hedefGelir: girdi.hedefGelir ? D(girdi.hedefGelir) : undefined,
            hedefGider: girdi.hedefGider ? D(girdi.hedefGider) : undefined,
            notlar: girdi.notlar || undefined,
          },
        }),
      );
      return this.getir(proje.id);
    } catch (hata) {
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") {
        throw new ConflictException(`'${girdi.kod}' proje kodu zaten kullanımda`);
      }
      throw hata;
    }
  }

  async guncelle(id: string, girdi: z.infer<typeof projeGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(id);

    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.proje.update({
        where: { id, tenantId },
        data: {
          ...(girdi.kod ? { kod: girdi.kod.trim().toUpperCase() } : {}),
          ...(girdi.ad ? { ad: girdi.ad.trim() } : {}),
          aciklama: girdi.aciklama === null ? null : girdi.aciklama,
          cariId: girdi.cariId === null ? null : girdi.cariId,
          baslangicTarihi: girdi.baslangicTarihi ? new Date(girdi.baslangicTarihi) : girdi.baslangicTarihi === null ? null : undefined,
          bitisTarihi: girdi.bitisTarihi ? new Date(girdi.bitisTarihi) : girdi.bitisTarihi === null ? null : undefined,
          ...(girdi.durum ? { durum: girdi.durum as any } : {}),
          sorumluUserId: girdi.sorumluUserId === null ? null : girdi.sorumluUserId,
          hedefGelir: girdi.hedefGelir ? D(girdi.hedefGelir) : undefined,
          hedefGider: girdi.hedefGider ? D(girdi.hedefGider) : undefined,
          notlar: girdi.notlar === null ? null : girdi.notlar,
          ...(girdi.aktif !== undefined ? { aktif: girdi.aktif } : {}),
        },
      }),
    );

    return this.getir(id);
  }

  async sil(id: string) {
    const { tenantId } = aktifBaglam();
    const [faturaSayisi, masrafSayisi] = await Promise.all([
      this.prisma.tenantIslem(tenantId, (tx) => tx.faturaSatir.count({ where: { projeId: id } })),
      this.prisma.tenantIslem(tenantId, (tx) => tx.masraf.count({ where: { projeId: id } })),
    ]);

    if (faturaSayisi > 0 || masrafSayisi > 0) {
      throw new BadRequestException("İlişkili fatura veya masraf kaydı bulunan proje silinemez. Durumunu 'iptal' yapabilirsiniz.");
    }

    await this.prisma.tenantIslem(tenantId, (tx) => tx.proje.delete({ where: { id, tenantId } }));
  }

  // ─── AŞAMALAR (PHASES) ────────────────────────────────────────────────
  async asamaEkle(projeId: string, girdi: z.infer<typeof projeAsamaSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(projeId);

    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.projeAsama.create({
        data: {
          tenantId,
          projeId,
          sira: girdi.sira,
          ad: girdi.ad.trim(),
          aciklama: girdi.aciklama || undefined,
          baslangicTarihi: girdi.baslangicTarihi ? new Date(girdi.baslangicTarihi) : undefined,
          bitisTarihi: girdi.bitisTarihi ? new Date(girdi.bitisTarihi) : undefined,
          tamamlandi: girdi.tamamlandi ?? false,
          tamamlanmaTarihi: girdi.tamamlandi ? new Date() : undefined,
        },
      }),
    );
  }

  async asamaGuncelle(projeId: string, asamaId: string, girdi: z.infer<typeof projeAsamaSemasi>) {
    const { tenantId } = aktifBaglam();
    const asama = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.projeAsama.findFirst({ where: { id: asamaId, projeId, tenantId } }),
    );
    if (!asama) throw new NotFoundException("Proje aşaması bulunamadı");

    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.projeAsama.update({
        where: { id: asamaId, tenantId },
        data: {
          sira: girdi.sira,
          ad: girdi.ad.trim(),
          aciklama: girdi.aciklama === null ? null : girdi.aciklama,
          baslangicTarihi: girdi.baslangicTarihi ? new Date(girdi.baslangicTarihi) : girdi.baslangicTarihi === null ? null : undefined,
          bitisTarihi: girdi.bitisTarihi ? new Date(girdi.bitisTarihi) : girdi.bitisTarihi === null ? null : undefined,
          tamamlandi: girdi.tamamlandi ?? asama.tamamlandi,
          tamamlanmaTarihi: girdi.tamamlandi && !asama.tamamlandi ? new Date() : !girdi.tamamlandi ? null : undefined,
        },
      }),
    );
  }

  async asamaSil(projeId: string, asamaId: string) {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.projeAsama.deleteMany({ where: { id: asamaId, projeId, tenantId } }),
    );
    if (silinen.count === 0) throw new NotFoundException("Proje aşaması bulunamadı");
  }

  // ─── ALT KIRILIMLAR (ANALİTİK YEVMİYE / MALİYET MERKEZLERİ) ───────────
  async altKirilimEkle(projeId: string, girdi: z.infer<typeof projeAltKirilimSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(projeId);

    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.projeAltKirilim.create({
          data: {
            tenantId,
            projeId,
            kod: girdi.kod.trim().toUpperCase(),
            ad: girdi.ad.trim(),
            tip: (girdi.tip as any) ?? "gider",
            butceTutari: girdi.butceTutari ? D(girdi.butceTutari) : undefined,
            aciklama: girdi.aciklama || undefined,
          },
        }),
      );
    } catch (hata) {
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") {
        throw new ConflictException(`'${girdi.kod}' analitik kırılım kodu bu projede zaten tanımlı`);
      }
      throw hata;
    }
  }

  async altKirilimSil(projeId: string, kirilimId: string) {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.projeAltKirilim.deleteMany({ where: { id: kirilimId, projeId, tenantId } }),
    );
    if (silinen.count === 0) throw new NotFoundException("Analitik alt kırılım bulunamadı");
  }

  // ─── NOTLAR ───────────────────────────────────────────────────────────
  async notEkle(projeId: string, girdi: z.infer<typeof projeNotSemasi>) {
    const ctx = aktifBaglam();
    await this.getir(projeId);

    return this.prisma.tenantIslem(ctx.tenantId, (tx) =>
      tx.projeNot.create({
        data: {
          tenantId: ctx.tenantId,
          projeId,
          userId: ctx.userId,
          icerik: girdi.icerik.trim(),
        },
        include: { user: { select: { id: true, adSoyad: true } } },
      }),
    );
  }
}
