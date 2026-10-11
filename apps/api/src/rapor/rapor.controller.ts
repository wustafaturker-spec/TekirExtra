import { Controller, Get, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { RaporService } from "./rapor.service";

/**
 * Panel özet göstergeleri (RPR-01). Modül raporları RPR-06 ortak araç
 * setindedir (/raporlar); eski kar-zarar ucu fatura.kar-marji olarak taşındı.
 */
/*
 * RPR-11 (inceleme P0-1): @Roller'sız uç çalışan dışı her role açıktı; depo
 * rolü panel özetinden şirketin nakit, alacak ve net varlığını alabiliyordu.
 * Yönetici her zaman geçer. Liste web'deki panel kartlarıyla uyumlu.
 */
@Controller("rapor")
export class RaporController {
  constructor(private readonly raporService: RaporService) {}

  @Get("ozet")
  @Roller("muhasebe", "mali_musavir", "salt_okunur")
  async finansalOzet() {
    return this.raporService.finansalOzet();
  }

  @Get("gunluk")
  @Roller("muhasebe", "mali_musavir", "salt_okunur", "satis")
  async gunlukOzet(@Query("tarih") tarih?: string) {
    return this.raporService.gunlukOzet(tarih);
  }

  @Get("vadesi-gecenler")
  @Roller("muhasebe", "mali_musavir", "salt_okunur")
  async vadesiGecenler() {
    return this.raporService.vadesiGecenler();
  }

  @Get("smm")
  @Roller("muhasebe", "mali_musavir", "salt_okunur", "maliyet_muhasebesi")
  async smmAnalizi(@Query("yontem") yontem?: string, @Query("baslangic") baslangic?: string, @Query("bitis") bitis?: string) {
    const tarih = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    return this.raporService.smmAnalizi(yontem === "fifo" ? "fifo" : "agirlikli_ortalama", tarih(baslangic), tarih(bitis));
  }

  /** RPR-14: fatura satır pivotu; tutarlar kayıtlı TL değerler, iptal dışarıda. */
  @Get("fatura-pivot")
  @Roller("muhasebe", "mali_musavir", "salt_okunur", "satis")
  async faturaPivotu(@Query() sorgu: Record<string, string | undefined>) {
    return this.raporService.faturaPivotu(sorgu);
  }

  @Get("fatura-pivot/detay")
  @Roller("muhasebe", "mali_musavir", "salt_okunur", "satis")
  async faturaPivotDetayi(@Query() sorgu: Record<string, string | undefined>) {
    return this.raporService.faturaPivotDetayi(sorgu);
  }

  @Get("gelir-gider")
  @Roller("muhasebe", "mali_musavir", "salt_okunur")
  async gelirGiderRaporu(
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string,
  ) {
    return this.raporService.gelirGiderRaporu(baslangic, bitis);
  }
}
