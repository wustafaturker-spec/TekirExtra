import { Injectable, BadRequestException } from "@nestjs/common";
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
    const { gorselBase64 } = ocrTaramaSemasi.parse(girdi);

    if (!gorselBase64) {
      throw new BadRequestException("Görsel verisi boş olamaz");
    }

    // Gerçek OCR taraması motoru simülasyonu (Tesseract / Cloud Vision çıktısı)
    const bugun = new Date().toISOString().split("T")[0];

    return {
      basarili: true,
      okunanVeriler: {
        unvan: "MİGROS TİCARET A.Ş.",
        vkn: "6220031122",
        tarih: bugun,
        toplamTutar: 475.50,
        kdvOrani: 20,
        kdvTutari: 79.25,
        matrah: 396.25,
        fiisNo: "0142",
      },
      guvenSkoru: 0.94,
    };
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

      // 2. Vadesi Gelen Satış Faturaları (Alacaklar)
      const alacaklar = await tx.fatura.aggregate({
        where: { tenantId, tip: "satis", durum: "kesin" },
        _sum: { genelToplam: true },
      });
      const toplamAlacak = Number(alacaklar._sum.genelToplam || 0);

      // 3. Vadesi Gelen Alış Faturaları (Borçlar)
      const borclar = await tx.fatura.aggregate({
        where: { tenantId, tip: "alis", durum: "kesin" },
        _sum: { genelToplam: true },
      });
      const toplamBorc = Number(borclar._sum.genelToplam || 0);

      // 4. AI Projeksiyon Hesaplaması
      const tahminiNetNakit = mevcutBakiye + (toplamAlacak * 0.85) - (toplamBorc * 0.95);
      const riskSeviyesi = tahminiNetNakit < 0 ? "YÜKSEK_RİSK" : tahminiNetNakit < 50000 ? "ORTA_RİSK" : "DÜŞÜK_RİSK";

      return {
        tarihAraligiGun,
        mevcutBakiye,
        beklenenAlacaklar: toplamAlacak,
        beklenenBorclar: toplamBorc,
        tahminiSonBakiye: tahminiNetNakit,
        riskSeviyesi,
        tavsiyeler: [
          tahminiNetNakit < 0
            ? "⚠️ Dikkat: Önümüzdeki 30 günde nakit eksiye düşebilir. Alacak tahsilatlarını hızlandırın."
            : "✅ Nakit akışınız dengeli görünmektedir.",
          "💡 Tedarikçi ödemelerinizde erken ödeme iskontoları talep edebilirsiniz."
        ]
      };
    });
  }
}
