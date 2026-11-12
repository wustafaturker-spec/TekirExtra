import { Body, Controller, Delete, Get, HttpCode, Post, Put } from "@nestjs/common";
import { TelegramService } from "./telegram.service";

/**
 * CNL-02/20: her kullanıcı kendi Telegram bağını yönetir; ürün ayarını yalnız yönetici
 * değiştirir (serviste denetlenir). Asistan yetkisi mesaj başına ayrıca uygulanır.
 */
@Controller("telegram")
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Get("durum")
  durum() {
    return this.telegram.durumGetir();
  }

  @Post("baglanti-kodu")
  @HttpCode(200)
  kod(@Body() govde: unknown) {
    return this.telegram.kodUret(govde);
  }

  @Delete("bag")
  bagKaldir() {
    return this.telegram.bagKaldir();
  }

  @Put("urun")
  urun(@Body() govde: unknown) {
    return this.telegram.urunAyarla(govde);
  }
}
