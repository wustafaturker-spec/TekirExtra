import { Injectable, NotImplementedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../core/prisma.service";
import { ocrTaramaSemasi, aiTahminSemasi } from "./ai.semalar";
import { z } from "zod";

@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fiş / Fatura Görselinden KDV, Tutar, Tarih ve VKN Okuma (Simüle OCR Motoru)
   */
  async fisFaturaOcrTara(tenantId: string, girdi: z.infer<typeof ocrTaramaSemasi>) {
    ocrTaramaSemasi.parse(girdi);
    throw new NotImplementedException("OCR özelliği doğrulanmış bir sağlayıcı bağlanana kadar kullanıma kapalıdır");
  }

  /**
   * AI Nakit Akış Tahmincisi
   * Gelecek N gündeki alacak, borç ve tahmini kasa bakiyesi projeksiyonu
   */
  async nakitAkisTahmini(tenantId: string, girdi: z.infer<typeof aiTahminSemasi>) {
    const { tarihAraligiGun } = aiTahminSemasi.parse(girdi);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // 1. Mevcut Toplam Kasa/Banka Bakiyesi
      const kasalar = await tx.kasa.findMany({ where: { tenantId, aktif: true } });
      const bankalar = await tx.bankaHesap.findMany({ where: { tenantId, aktif: true } });
      const mevcutBakiye = kasalar.reduce((sum: number, k: any) => sum + Number(k.bakiye), 0) +
                           bankalar.reduce((sum: number, b: any) => sum + Number(b.bakiye), 0);

      const ufuk = new Date();
      ufuk.setDate(ufuk.getDate() + tarihAraligiGun);
      const faturalar = await tx.fatura.findMany({
        where: { tenantId, tip: { in: ["satis", "alis"] }, durum: "kesin", vadeTarihi: { lte: ufuk } },
        select: { tip: true, genelToplam: true, kur: true, kasaBankaHarekets: { select: { tutarTry: true } }, krediKartiHareketleri: { select: { cariOdemeTutari: true } } },
      });
      let toplamAlacak = new Prisma.Decimal(0), toplamBorc = new Prisma.Decimal(0);
      for (const fatura of faturalar) {
        const toplamTry = new Prisma.Decimal(fatura.genelToplam).mul(fatura.kur);
        const odenenTry = fatura.kasaBankaHarekets.reduce((toplam, h) => toplam.add(new Prisma.Decimal(h.tutarTry)), new Prisma.Decimal(0))
          .add(fatura.krediKartiHareketleri.reduce((toplam, h) => toplam.add(new Prisma.Decimal(h.cariOdemeTutari ?? 0).mul(fatura.kur)), new Prisma.Decimal(0)));
        const kalan = Prisma.Decimal.max(toplamTry.sub(odenenTry), 0);
        if (fatura.tip === "satis") toplamAlacak = toplamAlacak.add(kalan); else toplamBorc = toplamBorc.add(kalan);
      }
      const tahminiNetNakit = mevcutBakiye + toplamAlacak.toNumber() - toplamBorc.toNumber();
      const riskSeviyesi = tahminiNetNakit < 0 ? "YÜKSEK_RİSK" : tahminiNetNakit < 50000 ? "ORTA_RİSK" : "DÜŞÜK_RİSK";

      return {
        tarihAraligiGun,
        mevcutBakiye,
        beklenenAlacaklar: toplamAlacak.toNumber(),
        beklenenBorclar: toplamBorc.toNumber(),
        tahminiSonBakiye: tahminiNetNakit,
        riskSeviyesi,
        hesaplamaYontemi: "Vadesi ufuk tarihine kadar gelen kesin faturaların kayıtlı ödemeler düşüldükten sonraki TRY bakiyesi; olasılık katsayısı uygulanmaz.",
        tavsiyeler: [
          tahminiNetNakit < 0
            ? `⚠️ Dikkat: Önümüzdeki ${tarihAraligiGun} günde nakit eksiye düşebilir. Alacak tahsilatlarını hızlandırın.`
            : "✅ Nakit akışınız dengeli görünmektedir.",
          "💡 Tedarikçi ödemelerinizde erken ödeme iskontoları talep edebilirsiniz."
        ]
      };
    });
  }
}
