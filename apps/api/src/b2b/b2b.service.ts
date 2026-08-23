import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { b2bSiparisOlusturSemasi } from "./b2b.semalar";
import { z } from "zod";

@Injectable()
export class B2bService {
  constructor(private readonly prisma: PrismaService) {}

  async bayiKatalogGetir(tenantId: string, cariId: string) {
    const cari = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.findFirst({
        where: { id: cariId, tenantId },
        include: { fiyatListesi: { include: { kalemler: true } } }
      })
    );

    if (!cari) throw new NotFoundException("Bayi / Cari hesap bulunamadı");

    const ürünler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.findMany({
        where: { tenantId, aktif: true, tip: "urun" },
        select: {
          id: true,
          kod: true,
          ad: true,
          anaBirim: true,
          gorselUrl: true,
          satisFiyati: true,
          kdvOrani: true,
        }
      })
    );

    // Cari hesaba bağlı özel Fiyat Listesi varsa fiyatları override et
    const özelFiyatMap = new Map<string, number>();
    if (cari.fiyatListesi) {
      for (const k of cari.fiyatListesi.kalemler) {
        özelFiyatMap.set(k.stokId, Number(k.fiyat));
      }
    }

    return ürünler.map((u) => {
      const ozelFiyat = özelFiyatMap.get(u.id);
      const nihaiFiyat = ozelFiyat !== undefined ? ozelFiyat : Number(u.satisFiyati || 0);

      // Cari özel iskontosunu uygula
      const iskontoPayi = cari.varsayilanIskonto ? (nihaiFiyat * Number(cari.varsayilanIskonto)) / 100 : 0;
      const netBirimFiyati = Math.max(0, nihaiFiyat - iskontoPayi);

      return {
        ...u,
        listeFiyati: u.satisFiyati,
        bayiBirimFiyati: netBirimFiyati,
        iskontoYuzdesi: cari.varsayilanIskonto || 0,
      };
    });
  }

  async bayiEkstreGetir(tenantId: string, cariId: string) {
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHareket.findMany({
        where: { tenantId, cariId },
        orderBy: { tarih: "desc" },
        take: 50
      })
    );
  }

  async siparisOlustur(tenantId: string, girdi: z.infer<typeof b2bSiparisOlusturSemasi>) {
    const veri = b2bSiparisOlusturSemasi.parse(girdi);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const cari = await tx.cariHesap.findFirst({
        where: { id: veri.cariId, tenantId }
      });

      if (!cari) throw new NotFoundException("Cari hesap bulunamadı");

      // Belge Numarası Sayacı
      const yil = new Date().getFullYear();
      const sayac = await tx.belgeSayac.upsert({
        where: { tenantId_tur_yil: { tenantId, tur: "siparis", yil } },
        create: { tenantId, tur: "siparis", yil, sonSira: 1 },
        update: { sonSira: { increment: 1 } },
      });

      const no = `SIP${yil}${String(sayac.sonSira).padStart(6, "0")}`;

      // Kalemlerin fiyat hesaplaması
      let genelToplam = 0;
      const belgeSatirlari: any[] = [];

      for (const k of veri.kalemler) {
        const stok = await tx.stokKart.findFirst({ where: { id: k.stokId, tenantId } });
        if (!stok) continue;

        const birimFiyat = Number(stok.satisFiyati || 0);
        const matrah = birimFiyat * k.miktar;
        const kdvTutari = (matrah * Number(stok.kdvOrani)) / 100;
        const toplamTutar = matrah + kdvTutari;

        genelToplam += toplamTutar;

        belgeSatirlari.push({
          tenantId,
          stokId: stok.id,
          miktar: k.miktar,
          birim: stok.anaBirim,
          birimFiyat,
          matrah,
          kdvOrani: stok.kdvOrani,
          kdvTutari,
          netKdvTutari: kdvTutari,
          toplamTutar,
        });
      }

      return tx.belge.create({
        data: {
          tenantId,
          tur: "siparis",
          yon: "satis",
          durum: "onaylandi",
          no,
          tarih: new Date(),
          cariId: cari.id,
          toplamBrut: genelToplam / 1.2,
          toplamSatirIskontosu: 0,
          genelIskontoToplam: 0,
          toplamMatrah: genelToplam / 1.2,
          toplamKdv: genelToplam - (genelToplam / 1.2),
          toplamNetKdv: genelToplam - (genelToplam / 1.2),
          genelToplam,
          aciklama: veri.aciklama || "B2B Bayi Portalı Siparişi",
          satirlar: { create: belgeSatirlari }
        },
        include: { satirlar: true }
      });
    });
  }
}
