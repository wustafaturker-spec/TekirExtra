import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../core/prisma.service";
import {
  semantikCiroVeKarlilik,
  semantikEnCokSatanMusteriler,
  semantikVadesiGecmisAlacaklar,
  semantikMasrafKirilimi,
  semantikNakitDurumu,
  SemantikSorguSonucu,
} from "./ai-rapor.semantik";

export interface AiRaporYaniti {
  soru: string;
  baslik: string;
  raporTuru: string;
  donem: string;
  metrikler: Record<string, number | string>;
  tablo?: Array<Record<string, unknown>>;
  grafikTuru?: "bar" | "pie" | "metric" | "line";
  icgoruler: string[];
  cevapMetni: string;
}

export interface AiYoneticiBrifingi {
  tarih: string;
  finansalSaglikSkoru: number; // 0 - 100
  saglikDurumu: "Mükemmel" | "Güçlü" | "Dikkat Gerektirir" | "Kritik";
  yoneticiNotu: string;
  metrikler: {
    aylikCiro: number;
    brutKarMarji: number;
    vadesiGecmisAlacak: number;
    nakitMevcudu: number;
    enBuyukGider: string;
  };
  oncelikliRiskler: string[];
  cfoTavsiyeleri: string[];
}

@Injectable()
export class AiRaporService {
  private readonly logger = new Logger(AiRaporService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Doğal dille sorulan finansal soruyu güvenli semantik katmanda sorgular ve yanıtlar
   */
  async soruCevapla(tenantId: string, soru: string): Promise<AiRaporYaniti> {
    const s = soru.trim().toLowerCase();

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      let sonuc: SemantikSorguSonucu;

      if (s.includes("müşteri") || s.includes("musteri") || s.includes("en çok satan") || s.includes("en buyuk satis")) {
        sonuc = await semantikEnCokSatanMusteriler(tx, tenantId, 5);
      } else if (s.includes("alacak") || s.includes("vade") || s.includes("gecik") || s.includes("borçlu")) {
        sonuc = await semantikVadesiGecmisAlacaklar(tx, tenantId);
      } else if (s.includes("masraf") || s.includes("gider") || s.includes("harcama")) {
        sonuc = await semantikMasrafKirilimi(tx, tenantId);
      } else if (s.includes("nakit") || s.includes("kasa") || s.includes("banka") || s.includes("para")) {
        sonuc = await semantikNakitDurumu(tx, tenantId);
      } else {
        // Varsayılan: Ciro ve Kârlılık Analizi
        sonuc = await semantikCiroVeKarlilik(tx, tenantId);
      }

      // Doğal dilde açıklama metni oluştur
      const cevapMetni = this.cevapMetniOlustur(soru, sonuc);

      return {
        soru,
        baslik: sonuc.baslik,
        raporTuru: sonuc.raporTuru,
        donem: sonuc.donem,
        metrikler: sonuc.metrikler,
        tablo: sonuc.tablo,
        grafikTuru: sonuc.grafikTuru,
        icgoruler: sonuc.icgoruler,
        cevapMetni,
      };
    });
  }

  /**
   * Haftalık / Aylık AI CFO Yönetici Brifingi Üretir
   */
  async yoneticiBrifingiUret(tenantId: string): Promise<AiYoneticiBrifingi> {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [ciro, alacaklar, nakit, masraflar] = await Promise.all([
        semantikCiroVeKarlilik(tx, tenantId),
        semantikVadesiGecmisAlacaklar(tx, tenantId),
        semantikNakitDurumu(tx, tenantId),
        semantikMasrafKirilimi(tx, tenantId),
      ]);

      const aylikCiro = Number(ciro.metrikler.toplamCiro || 0);
      const brutKarMarji = Number(ciro.metrikler.karMarjiYuzde || 0);
      const gecikenAlacak = Number(alacaklar.metrikler.toplamGecikenTutar || 0);
      const nakitMevcudu = Number(nakit.metrikler.toplamTryNakit || 0);
      const enBuyukGider = masraflar.tablo?.[0]?.kategori as string || "Operasyonel Giderler";

      // Finansal Sağlık Skoru Hesaplama (0 - 100)
      let skor = 60; // Taban skor

      // Kârlılık katkısı (0 - 25)
      if (brutKarMarji >= 25) skor += 20;
      else if (brutKarMarji >= 15) skor += 10;
      else skor -= 10;

      // Alacak tahsilat oranı katkısı (0 - 25)
      const alacakOrani = aylikCiro > 0 ? (gecikenAlacak / aylikCiro) * 100 : 0;
      if (gecikenAlacak === 0) skor += 20;
      else if (alacakOrani < 15) skor += 10;
      else if (alacakOrani > 35) skor -= 20;

      // Nakit karşılama katkısı
      if (nakitMevcudu > 50000) skor += 10;

      skor = Math.max(10, Math.min(100, skor));

      let saglikDurumu: "Mükemmel" | "Güçlü" | "Dikkat Gerektirir" | "Kritik" = "Güçlü";
      if (skor >= 85) saglikDurumu = "Mükemmel";
      else if (skor >= 70) saglikDurumu = "Güçlü";
      else if (skor >= 50) saglikDurumu = "Dikkat Gerektirir";
      else saglikDurumu = "Kritik";

      // Riskler ve Tavsiyeler
      const oncelikliRiskler: string[] = [];
      const cfoTavsiyeleri: string[] = [];

      if (gecikenAlacak > 0) {
        oncelikliRiskler.push(
          `Vadesi geçmiş alacaklarınız toplam ${gecikenAlacak.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL seviyesine ulaştı.`,
        );
        cfoTavsiyeleri.push(
          "Riskli carilere sistem üzerinden otomatik ödeme hatırlatması WhatsApp/E-posta ile gönderilmelidir.",
        );
      }

      if (brutKarMarji < 18) {
        oncelikliRiskler.push("Brüt kâr marjınız %18 kritik seviyesinin altında seyrediyor.");
        cfoTavsiyeleri.push("Maliyet artışlarına karşı dinamik vade fiyatlandırma motoru aktif kullanılmalıdır.");
      }

      if (nakitMevcudu < 20000) {
        oncelikliRiskler.push("Kısa vadeli nakit tamponu zayıflamıştır.");
        cfoTavsiyeleri.push("Bekleyen tahsilatların hızlandırılması veya vadeli alımların dengelenmesi önerilir.");
      } else {
        cfoTavsiyeleri.push("Mevcut nakit akışı kısa vadeli yükümlülükleri karşılamak için yeterli seviyededir.");
      }

      const yoneticiNotu = `Sayın Yönetici, bu hafta şirketinizin finansal sağlık skoru 100 üzerinden ${skor} (${saglikDurumu}) olarak ölçülmüştür. Toplam ${aylikCiro.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL ciro ve %${brutKarMarji} brüt marj elde edilmiştir. ${oncelikliRiskler.length > 0 ? "Özellikle alacak tahsilatlarına odaklanılması önerilmektedir." : "Tüm operasyonel göstergeler dengelidir."}`;

      return {
        tarih: new Date().toISOString().slice(0, 10),
        finansalSaglikSkoru: skor,
        saglikDurumu,
        yoneticiNotu,
        metrikler: {
          aylikCiro,
          brutKarMarji,
          vadesiGecmisAlacak: gecikenAlacak,
          nakitMevcudu,
          enBuyukGider,
        },
        oncelikliRiskler,
        cfoTavsiyeleri,
      };
    });
  }

  private cevapMetniOlustur(soru: string, sonuc: SemantikSorguSonucu): string {
    const baslik = `📊 **${sonuc.baslik}** (${sonuc.donem})\n\n`;
    const icgoruMetni = sonuc.icgoruler.map((i) => `• ${i}`).join("\n");
    return `${baslik}${icgoruMetni}`;
  }
}
