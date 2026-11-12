import { BadRequestException, Body, Controller, Get, HttpCode, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MasrafBelgeService } from "../asistan-soru/masraf-belge.service";
import { BELGE_AZAMI_BAYT } from "../asistan-soru/masraf-belge.kurallari";
import { Roller } from "../auth/roller.decorator";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { sahaUrunleri } from "./saha-urun";

/**
 * SAH: mobil saha ekranlarının uçları. Sayım gönderimi mevcut `POST /stok/sayimlar` ucuyla,
 * kategori sorusunun yanıtı `POST /ai/sorular/:id/yanit` ile yapılır. Uçlar yetki modülüne
 * bağlıdır: ürün listesi Stok, fiş Masraf ve Gelir (+ yol adındaki "ai" ile Yapay Zekâ paketi).
 */
@Controller("saha/urunler")
export class SahaUrunController {
  constructor(private readonly prisma: PrismaService) {}

  /** SAH-05: barkodla bulma çevrimdışı da çalışsın diye ürün ve barkod listesi (fiyatsız). */
  @Get()
  @Roller("muhasebe", "depo", "uretim_planlama", "salt_okunur")
  async urunler() {
    const { tenantId } = aktifBaglam();
    const veri = await this.prisma.tenantIslem(tenantId, (tx) => sahaUrunleri(tx));
    return { ...veri, alindi: new Date().toISOString() };
  }
}

@Controller("saha/ai-fis")
export class SahaFisController {
  constructor(private readonly masrafBelge: MasrafBelgeService) {}

  /** SAH-08: kameradan masraf fişi; OCR ve taslak CNL-16 hattıyla (kategori belirsizse soru döner). */
  @Post()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("dosya", { limits: { fileSize: BELGE_AZAMI_BAYT, files: 1 } }))
  async masrafFisi(@UploadedFile() dosya: { originalname?: string; buffer?: Buffer } | undefined, @Body("not") not?: string) {
    if (!dosya?.buffer?.length) throw new BadRequestException("Fiş fotoğrafı gönderilmedi.");
    const aciklama = typeof not === "string" && not.trim() ? not.trim().slice(0, 300) : null;
    return this.masrafBelge.belgedenMasraf({ ad: (dosya.originalname || "saha-fis").slice(0, 80), buffer: dosya.buffer }, aciklama, "WEB");
  }
}
