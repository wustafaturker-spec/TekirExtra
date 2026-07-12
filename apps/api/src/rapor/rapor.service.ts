import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);

@Injectable()
export class RaporService {
  constructor(private readonly prisma: PrismaService) {}

  // Kar-zarar analizi RPR-06 araç setine taşındı: fatura.kar-marji (FTR-15).

  // ─── FİNANSAL DURUM ÖZETİ (RPR-01/04) ─────────────────────────────────────

  async finansalOzet() {
    const { tenantId } = aktifBaglam();

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // 1. Kasa ve Banka Toplam Bakiyesi (TRY Karşılığı)
      const hareketler = await tx.kasaBankaHareket.groupBy({
        by: ["tip"],
        where: { tenantId },
        _sum: { tutarTry: true },
      });

      let kasaBankaBorc = D(0);
      let kasaBankaAlacak = D(0);

      hareketler.forEach((h) => {
        const sumVal = D(h._sum.tutarTry ?? 0);
        if (h.tip === "tahsilat" || h.tip === "virman_gelis") {
          kasaBankaBorc = kasaBankaBorc.add(sumVal);
        } else {
          kasaBankaAlacak = kasaBankaAlacak.add(sumVal);
        }
      });

      const nakitVarliklar = kasaBankaBorc.sub(kasaBankaAlacak);

      // 2. Toplam Stok Envanter Değeri
      const stoklar = await tx.stokKart.findMany({
        where: { tenantId, aktif: true },
        select: { mevcutMiktar: true, ortalamaMaliyet: true },
      });

      let envanterDegeri = D(0);
      stoklar.forEach((s) => {
        envanterDegeri = envanterDegeri.add(s.mevcutMiktar.mul(s.ortalamaMaliyet));
      });

      // 3. Cari Borç ve Alacak Toplamları (Alacaklar & Borçlar)
      const cariler = await tx.cariHesap.findMany({
        where: { tenantId, aktif: true },
        include: {
          hareketler: { select: { tip: true, tutarTry: true } },
        },
      });

      let toplamAlacaklar = D(0); // Müşterilerden alacağımız (pozitif bakiye)
      let toplamBorclar = D(0);    // Satıcılara borcumuz (negatif bakiye)

      cariler.forEach((c) => {
        let borcSum = D(0);
        let alacakSum = D(0);

        c.hareketler.forEach((h) => {
          if (h.tip === "borc") {
            borcSum = borcSum.add(h.tutarTry);
          } else {
            alacakSum = alacakSum.add(h.tutarTry);
          }
        });

        const cariBakiye = borcSum.sub(alacakSum); // borç > alacak ise müşteri borçludur (bizim alacağımız)
        if (cariBakiye.greaterThan(0)) {
          toplamAlacaklar = toplamAlacaklar.add(cariBakiye);
        } else if (cariBakiye.lessThan(0)) {
          toplamBorclar = toplamBorclar.add(cariBakiye.abs());
        }
      });

      return {
        nakitVarliklar: nakitVarliklar.toFixed(2),
        envanterDegeri: envanterDegeri.toFixed(2),
        toplamAlacaklar: toplamAlacaklar.toFixed(2),
        toplamBorclar: toplamBorclar.toFixed(2),
        netVarlikDegeri: nakitVarliklar
          .add(envanterDegeri)
          .add(toplamAlacaklar)
          .sub(toplamBorclar)
          .toFixed(2),
      };
    });
  }
}
