import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import type { krediKartiHareketSemasi, krediKartiOlusturSemasi } from "./kredi-karti.semalar";
@Injectable()
export class KrediKartiService {
  constructor(private readonly prisma: PrismaService) {}
  async listele() { const { tenantId } = aktifBaglam(); const kartlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.krediKarti.findMany({ orderBy: [{ aktif: "desc" }, { ad: "asc" }], include: { bagliBankaHesap: { select: { id: true, ad: true } }, hareketler: { orderBy: [{ tarih: "desc" }, { createdAt: "desc" }] } } })); return kartlar.map((kart) => { const borc = kart.hareketler.reduce((t, h) => t.add(["harcama", "faiz", "aidat"].includes(h.tip) ? h.tutar : h.tutar.negated()), new Prisma.Decimal(0)); const net = Prisma.Decimal.max(0, borc); return { ...kart, borc: net, kullanilabilirLimit: Prisma.Decimal.max(0, kart.limit.sub(net)), kullanimOrani: kart.limit.gt(0) ? net.div(kart.limit).mul(100).toDecimalPlaces(1) : new Prisma.Decimal(0) }; }); }
  async olustur(girdi: z.infer<typeof krediKartiOlusturSemasi>) { const { tenantId } = aktifBaglam(); return this.prisma.tenantIslem(tenantId, async (tx) => { if (girdi.bagliBankaHesapId && !await tx.bankaHesap.findUnique({ where: { id: girdi.bagliBankaHesapId } })) throw new BadRequestException("Bağlı banka hesabı bulunamadı"); return tx.krediKarti.create({ data: { ...girdi, tenantId, limit: new Prisma.Decimal(girdi.limit) } }); }); }
  async hareketEkle(girdi: z.infer<typeof krediKartiHareketSemasi>) { const { tenantId } = aktifBaglam(); return this.prisma.tenantIslem(tenantId, async (tx) => { const kart = await tx.krediKarti.findUnique({ where: { id: girdi.krediKartiId } }); if (!kart?.aktif) throw new NotFoundException("Aktif kredi kartı hesabı bulunamadı"); return tx.krediKartiHareket.create({ data: { ...girdi, tenantId, tarih: new Date(girdi.tarih), tutar: new Prisma.Decimal(girdi.tutar) } }); }); }
}
