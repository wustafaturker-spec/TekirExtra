import { Injectable, NotFoundException } from "@nestjs/common";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { pazaryeriSiparisSemasi } from "./pazaryeri.semalar";

@Injectable()
export class PazaryeriService {
  constructor(private readonly prisma: PrismaService) {}

  async listele(durum?: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.pazaryeriSiparis.findMany({
      where: durum ? { durum: durum as never } : undefined,
      orderBy: { siparisTarihi: "desc" }, include: { satirlar: true, baglanti: { select: { saglayici: true } }, cari: { select: { kod: true, unvan: true } }, fatura: { select: { id: true, no: true } } },
    }));
  }

  /** Adaptörlerin ortak biçime çevirdiği siparişi idempotent olarak kutuya alır. */
  async iceAktar(girdi: z.infer<typeof pazaryeriSiparisSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const baglanti = await tx.baglanti.findFirst({ where: { id: girdi.baglantiId, aile: "pazaryeri" } });
      if (!baglanti) throw new NotFoundException("Pazaryeri bağlantısı bulunamadı");
      const mevcut = await tx.pazaryeriSiparis.findUnique({ where: { tenantId_baglantiId_hariciId: { tenantId, baglantiId: girdi.baglantiId, hariciId: girdi.hariciId } } });
      if (mevcut) return mevcut;

      const eslenen = await Promise.all(girdi.satirlar.map(async (satir) => {
        const varyant = await tx.stokVaryant.findFirst({ where: { aktif: true, OR: [{ kod: satir.sku }, ...(satir.barkod ? [{ barkod: satir.barkod }] : [])] }, select: { id: true, stokId: true } });
        if (varyant) return { ...satir, stokId: varyant.stokId, varyantId: varyant.id };
        const stok = await tx.stokKart.findFirst({ where: { aktif: true, OR: [{ kod: satir.sku }, ...(satir.barkod ? [{ barkod: satir.barkod }, { barkodlar: { some: { barkod: satir.barkod } } }] : [])] }, select: { id: true } });
        return { ...satir, stokId: stok?.id ?? null, varyantId: null };
      }));
      const tumuEslesti = eslenen.every((s) => s.stokId);
      return tx.pazaryeriSiparis.create({ data: {
        tenantId, baglantiId: girdi.baglantiId, hariciId: girdi.hariciId, siparisNo: girdi.siparisNo,
        hariciDurum: girdi.hariciDurum, siparisTarihi: new Date(girdi.siparisTarihi), musteriUnvani: girdi.musteriUnvani,
        musteriEposta: girdi.musteriEposta, musteriTelefon: girdi.musteriTelefon, vknTckn: girdi.vknTckn,
        dovizCinsi: girdi.dovizCinsi, toplam: girdi.toplam, teslimatAdresi: girdi.teslimatAdresi as never,
        durum: tumuEslesti ? "faturalanmaya_hazir" : "esleme_bekliyor", hamVeri: girdi as never,
        satirlar: { create: eslenen.map((s) => ({ tenantId, hariciSatirId: s.hariciSatirId, sku: s.sku, barkod: s.barkod, urunAdi: s.urunAdi, miktar: s.miktar, birimFiyat: s.birimFiyat, kdvOrani: s.kdvOrani, stokId: s.stokId, varyantId: s.varyantId })) },
      }, include: { satirlar: true } });
    });
  }
}
