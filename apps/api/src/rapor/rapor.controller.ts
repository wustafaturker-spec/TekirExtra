import { Body, Controller, Get, Header, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
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

  @Get("maliyet-eksikleri/izleme")
  @Header("Cache-Control", "no-store")
  @Roller("muhasebe", "mali_musavir", "salt_okunur", "maliyet_muhasebesi")
  maliyetIzleme(@Query() sorgu: Record<string, unknown>) { return this.raporService.maliyetIzleme(sorgu); }

  @Get("maliyet-eksikleri/:satirId/takip/dogrulama")
  @Roller("muhasebe", "mali_musavir", "salt_okunur", "maliyet_muhasebesi")
  maliyetDogrulamasi(@Param("satirId") id: string) { return this.raporService.maliyetDogrulamasi(id); }

  @Post("maliyet-eksikleri/:satirId/takip/kapat")
  @Roller("muhasebe")
  maliyetIncelemesiniKapat(@Param("satirId") id: string, @Body() govde: unknown) { return this.raporService.maliyetIncelemesiniKapat(id, govde); }

  @Get("maliyet-eksikleri/:satirId/takip")
  @Roller("muhasebe", "mali_musavir", "salt_okunur", "maliyet_muhasebesi")
  maliyetTakibi(@Param("satirId") id: string) { return this.raporService.maliyetTakibi(id); }

  @Post("maliyet-eksikleri/:satirId/takip")
  @Roller("muhasebe")
  maliyetTakibiBaslat(@Param("satirId") id: string, @Body() govde: unknown) { return this.raporService.maliyetTakibiKaydet(id, govde); }

  @Patch("maliyet-eksikleri/:satirId/takip")
  @Roller("muhasebe")
  maliyetTakibiGuncelle(@Param("satirId") id: string, @Body() govde: unknown) { return this.raporService.maliyetTakibiKaydet(id, govde, true); }

  @Get("maliyet-eksikleri")
  @Roller("muhasebe", "mali_musavir", "salt_okunur", "maliyet_muhasebesi")
  async maliyetEksikleri(@Query() sorgu: Record<string, unknown>) {
    return this.raporService.maliyetEksikleri(sorgu);
  }

  @Get("maliyet-eksikleri/excel")
  @Roller("muhasebe", "mali_musavir", "salt_okunur", "maliyet_muhasebesi")
  async maliyetEksikleriExcel(@Query() sorgu: Record<string, unknown>, @Res() res: Response) {
    const { dosya, dosyaAdi } = await this.raporService.maliyetEksikleriExcel(sorgu);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${dosyaAdi}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(dosya);
  }

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
