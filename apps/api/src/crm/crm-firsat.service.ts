import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { firsatOlusturSemasi, firsatGuncelleSemasi, firsatAsamaDegistirSemasi } from "./crm-firsat.semalar";
import { z } from "zod";

@Injectable()
export class CrmFirsatService {
  constructor(private readonly prisma: PrismaService) {}

  async listele(tenantId: string, asama?: string) {
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.crmFirsat.findMany({
        where: {
          tenantId,
          ...(asama ? { asama: asama as any } : {})
        },
        include: {
          cari: { select: { id: true, kod: true, unvan: true } },
          sorumlu: { select: { id: true, adSoyad: true, eposta: true } }
        },
        orderBy: { createdAt: "desc" }
      })
    );
  }

  async getir(tenantId: string, id: string) {
    const firsat = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.crmFirsat.findFirst({
        where: { id, tenantId },
        include: {
          cari: true,
          sorumlu: { select: { id: true, adSoyad: true, eposta: true } }
        }
      })
    );
    if (!firsat) throw new NotFoundException("CRM Fırsatı bulunamadı");
    return firsat;
  }

  async olustur(tenantId: string, girdi: z.infer<typeof firsatOlusturSemasi>) {
    const veri = firsatOlusturSemasi.parse(girdi);

    const cari = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.findFirst({ where: { id: veri.cariId, tenantId }, select: { id: true } }));
    if (!cari) throw new NotFoundException("Cari hesap bulunamadı veya bu firmaya ait değil");
    const sorumluUserId = veri.sorumluUserId || undefined;
    if (sorumluUserId) {
      const user = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findFirst({ where: { id: sorumluUserId, tenantId }, select: { id: true } }));
      if (!user) throw new NotFoundException("Sorumlu kullanıcı bulunamadı veya bu firmaya ait değil");
    }

    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.crmFirsat.create({
        data: {
          tenantId,
          baslik: veri.baslik,
          cariId: veri.cariId,
          tahminiTutar: veri.tahminiTutar,
          asama: veri.asama,
          kapanisTarihi: veri.kapanisTarihi || null,
          sorumluUserId: veri.sorumluUserId || null,
          notlar: veri.notlar || null,
        },
        include: {
          cari: { select: { id: true, kod: true, unvan: true } }
        }
      })
    );
  }

  async guncelle(tenantId: string, id: string, girdi: z.infer<typeof firsatGuncelleSemasi>) {
    const veri = firsatGuncelleSemasi.parse(girdi);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM crm_firsatlari WHERE id=${id}::uuid AND tenant_id=${tenantId}::uuid FOR UPDATE`;
      const mevcut = await tx.crmFirsat.findFirst({ where: { id, tenantId }, select: { cariId: true } });
      if (!mevcut) throw new NotFoundException("CRM Fırsatı bulunamadı");
      if (veri.cariId) {
        if (!await tx.cariHesap.findFirst({ where: { id: veri.cariId, tenantId }, select: { id: true } })) throw new NotFoundException("Cari hesap bulunamadı veya bu firmaya ait değil");
        if (veri.cariId !== mevcut.cariId && await tx.firsatBelgeBagi.count({ where: { tenantId, firsatId: id } })) throw new ConflictException("Teklif bağı geçmişi olan fırsatın carisi değiştirilemez");
      }
      if (veri.sorumluUserId && !await tx.user.findFirst({ where: { id: veri.sorumluUserId, tenantId, aktif: true }, select: { id: true } })) throw new NotFoundException("Aktif sorumlu kullanıcı bulunamadı");
      return tx.crmFirsat.update({
        where: { id, tenantId },
        data: {
          ...(veri.baslik && { baslik: veri.baslik }),
          ...(veri.cariId && { cariId: veri.cariId }),
          ...(veri.tahminiTutar && { tahminiTutar: veri.tahminiTutar }),
          ...(veri.asama && { asama: veri.asama }),
          ...(veri.kapanisTarihi !== undefined && { kapanisTarihi: veri.kapanisTarihi || null }),
          ...(veri.sorumluUserId !== undefined && { sorumluUserId: veri.sorumluUserId || null }),
          ...(veri.notlar !== undefined && { notlar: veri.notlar || null }),
        },
        include: {
          cari: { select: { id: true, kod: true, unvan: true } }
        }
      });
    });
  }

  async asamaDegistir(tenantId: string, id: string, girdi: z.infer<typeof firsatAsamaDegistirSemasi>) {
    const { asama } = firsatAsamaDegistirSemasi.parse(girdi);
    await this.getir(tenantId, id);

    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.crmFirsat.update({
        where: { id, tenantId },
        data: { asama },
        include: {
          cari: { select: { id: true, kod: true, unvan: true } }
        }
      })
    );
  }
}
