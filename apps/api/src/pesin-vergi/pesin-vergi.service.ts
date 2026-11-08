import { BadRequestException, Injectable } from "@nestjs/common";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { pesinVergiSatirlari } from "./pesin-vergi-kaynaklari";
import { pesinVergiOzeti, satirAnahtari, satirEtiketi } from "./pesin-vergi.hesap";
import type { pesinVergiGeriAlSemasi, pesinVergiMahsupSemasi } from "./pesin-vergi.semalar";

/** GLR-06: peşin ödenen vergiler; işaret dışında kayıt üretmez, fişe dokunmaz. */
@Injectable()
export class PesinVergiService {
  constructor(private readonly prisma: PrismaService) {}

  async ozet(baslangic: string, bitis: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [satirlar, mahsuplar, bekleyen] = await Promise.all([
        pesinVergiSatirlari(tx),
        tx.pesinVergiMahsup.findMany(),
        tx.pazaryeriKesinti.groupBy({
          by: ["dovizCinsi"],
          where: { sinif: "stopaj", durum: "bekliyor", tarih: { gte: new Date(baslangic), lte: new Date(`${bitis}T23:59:59.999Z`) } },
          _count: { _all: true }, _sum: { tutar: true },
        }),
      ]);
      return {
        ...pesinVergiOzeti(satirlar, mahsuplar, baslangic, bitis),
        // Kaydedilmemiş kesinti 193'te yok; ekrandan ayrı tutulur, kullanıcı uyarılır.
        bekleyenPazaryeri: {
          adet: bekleyen.reduce((t, b) => t + b._count._all, 0),
          tutarlar: Object.fromEntries(bekleyen.map((b) => [String(b.dovizCinsi), (b._sum.tutar ?? 0).toString()])),
        },
      };
    });
  }

  async mahsupEt(girdi: z.infer<typeof pesinVergiMahsupSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    const kalemler = [...new Map(girdi.kalemler.map((k) => [satirAnahtari(k), k])).values()];
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const satirlar = new Map((await pesinVergiSatirlari(tx)).map((s) => [satirAnahtari(s), s]));
      const bulunanlar = kalemler.map((k) => satirlar.get(satirAnahtari(k)));
      if (bulunanlar.some((s) => !s)) throw new BadRequestException("Seçilen kayıtlardan biri iptal edilmiş ya da geri alınmış; listeyi yenileyin");
      const { count } = await tx.pesinVergiMahsup.createMany({
        skipDuplicates: true,
        data: bulunanlar.map((s) => ({
          tenantId, kaynakTur: s!.kaynakTur, kaynakId: s!.kaynakId, beyannameTuru: girdi.beyannameTuru, yil: girdi.yil, donem: girdi.donem ?? null,
          not: girdi.not || null, tutarTry: s!.tutarTry, belgeTarihi: new Date(s!.tarih), etiket: satirEtiketi(s!), isaretleyenId: userId,
        })),
      });
      if (count !== kalemler.length) throw new BadRequestException("Seçilen kayıtlardan biri zaten mahsup edildi olarak işaretli; listeyi yenileyin");
      return { isaretlenen: count };
    });
  }

  async geriAl(girdi: z.infer<typeof pesinVergiGeriAlSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const { count } = await tx.pesinVergiMahsup.deleteMany({ where: { id: { in: girdi.mahsupIdleri } } });
      return { geriAlinan: count };
    });
  }
}
