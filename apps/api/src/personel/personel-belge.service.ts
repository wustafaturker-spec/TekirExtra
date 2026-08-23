import { Injectable, NotFoundException } from "@nestjs/common";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { EklerService, type YuklenenDosya } from "../ekler/ekler.service";
import type { z } from "zod";
import type { personelBelgeMetaSemasi } from "./personel-belge.semalar";

type BelgeMeta = z.infer<typeof personelBelgeMetaSemasi>;

@Injectable()
export class PersonelBelgeService {
  constructor(private readonly prisma: PrismaService, private readonly ekler: EklerService) {}

  async listele(personelId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const personel = await tx.personel.findUnique({ where: { id: personelId }, select: { id: true } });
      if (!personel) throw new NotFoundException("Personel bulunamadı");
      return tx.personelBelgesi.findMany({
        where: { personelId }, include: { ek: { select: { dosyaAdi: true, mimeTip: true, boyut: true } } },
        orderBy: { createdAt: "desc" },
      });
    });
  }

  async yukle(personelId: string, meta: BelgeMeta, dosya: YuklenenDosya) {
    const { tenantId } = aktifBaglam();
    const ek = await this.ekler.yukle("personel", personelId, dosya);
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBelgesi.create({
        data: {
          tenantId, personelId, ekId: ek.id, tur: meta.tur,
          aciklama: meta.aciklama || null,
          belgeTarihi: meta.belgeTarihi ? new Date(`${meta.belgeTarihi}T00:00:00.000Z`) : null,
          gecerlilikTarihi: meta.gecerlilikTarihi ? new Date(`${meta.gecerlilikTarihi}T00:00:00.000Z`) : null,
        },
        include: { ek: { select: { dosyaAdi: true, mimeTip: true, boyut: true } } },
      }));
    } catch (hata) {
      await this.ekler.sil(ek.id).catch(() => undefined);
      throw hata;
    }
  }

  async sil(personelId: string, belgeId: string) {
    const { tenantId } = aktifBaglam();
    const belge = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBelgesi.findFirst({ where: { id: belgeId, personelId } }));
    if (!belge) throw new NotFoundException("Personel belgesi bulunamadı");
    await this.ekler.sil(belge.ekId);
  }
}
