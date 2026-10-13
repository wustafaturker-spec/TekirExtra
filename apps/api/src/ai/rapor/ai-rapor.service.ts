import { Injectable, Logger } from "@nestjs/common";
import { aktifBaglam } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import { UC } from "../ajan/araclar/uclar";
import { UcCagirici } from "../ajan/uc-cagirici";
import { kiraciSaglayicisi } from "../saglayici/kiraci-saglayici";
import type { IAiProvider } from "../saglayici/ai-provider.interface";

export interface YoneticiOzeti {
  tarih: string;
  donem: { baslangic: string; bitis: string };
  metrikler: {
    netSatis: number;
    brutKar: number;
    netKar: number;
    nakitVarliklar: number;
    toplamAlacaklar: number;
    toplamBorclar: number;
    netVarlik: number;
    vadesiGecenAlacak: number;
    vadesiGecenAlacakSayisi: number;
    vadesiGecenBorc: number;
  };
  uyarilar: string[];
  /** Dil modelinin yalnız yukarıdaki rakamlardan yaptığı yorum; sağlayıcı yoksa null. */
  yorum: string | null;
}

const sayi = (v: unknown) => Number(v ?? 0);

/** Yorum ekranda düz metin: biçim işaretleri temizlenir, en çok 4 cümle (model sınırı aşabiliyor). */
export function yorumuSadelestir(metin: string): string {
  const duz = metin
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^-{3,}$/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Cümle sonu: noktalama + boşluk/son; "611.640,44" gibi binlik ayraçlarında bölmez.
  const cumleler = duz.match(/.+?[.!?](?=\s|$)/g) ?? [duz];
  return cumleler.slice(0, 4).map((c) => c.trim()).join(" ");
}
const tl = (v: number) => `${v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;

/**
 * AI-08: yönetici özeti rapor modülünün kendi hesaplarından gelir — finansal
 * özet (RPR-15), gelir-gider/kâr (RPR-12), vadesi geçenler (RPR-17). Çağrılar
 * ekranın uçlarından yapılır; rol kuralı aynıdır. Dil modeli rakam üretmez,
 * yalnız bu rakamları yorumlar. Soru-cevap asistan üzerinden yapılır
 * (rapor_katalogu / rapor_calistir araçları).
 */
@Injectable()
export class AiRaporService {
  private readonly logger = new Logger(AiRaporService.name);
  /** Testlerde sağlayıcıyı değiştirmek için. */
  saglayiciBul: (tenantId: string) => Promise<{ saglayici: IAiProvider }> = (tenantId) => kiraciSaglayicisi(this.prisma, tenantId, { ozellik: "ozet" });

  constructor(
    private readonly prisma: PrismaService,
    private readonly uc: UcCagirici,
  ) {}

  async yoneticiOzeti(): Promise<YoneticiOzeti> {
    const bugun = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
    const donem = { baslangic: `${bugun.slice(0, 8)}01`, bitis: bugun };
    const [ozet, gg, vade] = await Promise.all([
      this.uc.cagir<any>(UC.finansalOzet, []),
      this.uc.cagir<any>(UC.gelirGider, [donem.baslangic, donem.bitis]),
      this.uc.cagir<any>(UC.vadesiGecenler, []),
    ]);
    const kz = gg.karZarar ?? {};
    const metrikler = {
      netSatis: sayi(kz.netSatis),
      brutKar: sayi(kz.brutKar),
      netKar: sayi(kz.netKar),
      nakitVarliklar: sayi(ozet.nakitVarliklar),
      toplamAlacaklar: sayi(ozet.toplamAlacaklar),
      toplamBorclar: sayi(ozet.toplamBorclar),
      netVarlik: sayi(ozet.netVarlikDegeri),
      vadesiGecenAlacak: sayi(vade.toplamAlacak),
      vadesiGecenAlacakSayisi: sayi(vade.alacakSayisi),
      vadesiGecenBorc: sayi(vade.toplamBorc),
    };
    const uyarilar = [
      ...(metrikler.vadesiGecenAlacak > 0 ? [`${metrikler.vadesiGecenAlacakSayisi} faturada vadesi geçmiş ${tl(metrikler.vadesiGecenAlacak)} alacak var.`] : []),
      ...(metrikler.vadesiGecenBorc > 0 ? [`Vadesi geçmiş ${tl(metrikler.vadesiGecenBorc)} borç var.`] : []),
      ...(metrikler.netKar < 0 ? [`Dönemde net zarar: ${tl(metrikler.netKar)}.`] : []),
      ...(sayi(ozet.eksiStokSayisi) > 0 ? [`${ozet.eksiStokSayisi} üründe eksi stok var; stok değeri eksik hesaplanmış olabilir.`] : []),
      ...(Array.isArray(ozet.kurEksik) && ozet.kurEksik.length ? [`Kuru bulunamayan dövizler: ${ozet.kurEksik.join(", ")}.`] : []),
      ...((gg.uyarilar ?? []) as unknown[]).filter((u): u is string => typeof u === "string"),
    ];
    return { tarih: bugun, donem, metrikler, uyarilar, yorum: await this.yorumla(donem, metrikler, uyarilar) };
  }

  private async yorumla(donem: YoneticiOzeti["donem"], metrikler: YoneticiOzeti["metrikler"], uyarilar: string[]): Promise<string | null> {
    try {
      const { saglayici } = await this.saglayiciBul(aktifBaglam().tenantId);
      if (saglayici.saglayiciAdi === "tanimsiz") return null;
      const metin = await saglayici.metinUret({
        sistemRol:
          "Sen bir ön muhasebe uygulamasında yöneticiye kısa finansal yorum yazan asistansın. Yalnız verilen rakamları kullan; yeni rakam, oran, tahmin ya da sektör karşılaştırması üretme. Rakamları tekrar sıralama, ne anlama geldiklerini yorumla. Düz metin, başlık ve madde işareti yok, en çok 4 cümle, Türkçe.",
        prompt: `Dönem: ${donem.baslangic} – ${donem.bitis} (kâr rakamları bu dönem için; bakiyeler bugün itibarıyla).\nRakamlar (TL): ${JSON.stringify(metrikler)}\nUyarılar: ${uyarilar.join(" ") || "yok"}`,
      });
      return yorumuSadelestir(metin) || null;
    } catch (hata) {
      this.logger.warn(`Yönetici özeti yorumu üretilemedi: ${String(hata)}`);
      return null;
    }
  }
}
