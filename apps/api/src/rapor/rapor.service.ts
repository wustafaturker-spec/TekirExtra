import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);

@Injectable()
export class RaporService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── SATIŞ / KAR-ZARAR ANALİZİ (RPR-05) ───────────────────────────────────

  async karZararRaporu() {
    const { tenantId } = aktifBaglam();

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // Kesinleşmiş satış faturalarının satırlarını ve ürün ortalama maliyetlerini çek
      const satirlar = await tx.faturaSatir.findMany({
        where: {
          tenantId,
          fatura: { tip: "satis", durum: "kesin" },
        },
        include: {
          stok: { select: { kod: true, ad: true, ortalamaMaliyet: true } },
        },
      });

      const urunMap = new Map<
        string,
        {
          kod: string;
          ad: string;
          satilanMiktar: number;
          toplamCiro: number;
          toplamMaliyet: number;
          kar: number;
        }
      >();

      let genelCiro = D(0);
      let genelMaliyet = D(0);

      satirlar.forEach((s) => {
        const miktar = Number(s.miktar);
        const ciro = s.matrah; // fatura satır net matrahı
        const maliyetBirim = s.stok.ortalamaMaliyet;
        const maliyet = maliyetBirim.mul(s.miktar).toDecimalPlaces(2);

        genelCiro = genelCiro.add(ciro);
        genelMaliyet = genelMaliyet.add(maliyet);

        const mevcut = urunMap.get(s.stokId) ?? {
          kod: s.stok.kod,
          ad: s.stok.ad,
          satilanMiktar: 0,
          toplamCiro: 0,
          toplamMaliyet: 0,
          kar: 0,
        };

        mevcut.satilanMiktar += miktar;
        mevcut.toplamCiro = D(mevcut.toplamCiro).add(ciro).toNumber();
        mevcut.toplamMaliyet = D(mevcut.toplamMaliyet).add(maliyet).toNumber();
        mevcut.kar = D(mevcut.toplamCiro).sub(mevcut.toplamMaliyet).toNumber();

        urunMap.set(s.stokId, mevcut);
      });

      const urunKarlar = [...urunMap.values()].map((u) => {
        const karlilikYuzdesi =
          u.toplamCiro > 0 ? (u.kar / u.toplamCiro) * 100 : 0;
        return {
          ...u,
          toplamCiro: u.toplamCiro.toFixed(2),
          toplamMaliyet: u.toplamMaliyet.toFixed(2),
          kar: u.kar.toFixed(2),
          karlilikYuzdesi: karlilikYuzdesi.toFixed(2),
        };
      });

      const genelKar = genelCiro.sub(genelMaliyet);
      const genelKarlilikYuzdesi =
        genelCiro.greaterThan(0)
          ? genelKar.div(genelCiro).mul(100).toNumber()
          : 0;

      return {
        genelCiro: genelCiro.toFixed(2),
        genelMaliyet: genelMaliyet.toFixed(2),
        genelKar: genelKar.toFixed(2),
        genelKarlilikYuzdesi: genelKarlilikYuzdesi.toFixed(2),
        urunAnalizleri: urunKarlar,
      };
    });
  }

  // ─── FİNANSAL DURUM ÖZETİ (RPR-04) ────────────────────────────────────────

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
