import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { REFRESH_COOKIE } from "../auth/auth.controller";
import { IkiAdimKurulumundaAcik, Public } from "../auth/public.decorator";
import { EpostaDegisimiService } from "./eposta-degisimi.service";
import { ParolaService } from "./parola.service";

/**
 * Parola uçları (KLN-11, KLN-12). `/auth` altında durur: yenileme çerezi
 * yalnız bu yolda gönderildiğinden değiştirme bu oturumu açık tutabilir.
 */
@Controller("auth/parola")
export class ParolaController {
  constructor(private readonly parola: ParolaService) {}

  @IkiAdimKurulumundaAcik()
  @Post("degistir")
  @HttpCode(200)
  degistir(@Body() govde: unknown, @Req() req: Request) {
    return this.parola.degistir(govde, (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]);
  }

  @Public()
  @Post("sifirlama-iste")
  @HttpCode(200)
  sifirlamaIste(@Body() govde: unknown) {
    return this.parola.sifirlamaIste(govde);
  }

  @Public()
  @Post("sms-sifirla")
  @HttpCode(200)
  smsSifirla(@Body() govde: unknown) {
    return this.parola.smsIleSifirla(govde);
  }

  @Public()
  @Post("sifirla")
  @HttpCode(200)
  sifirla(@Body() govde: unknown) {
    return this.parola.sifirla(govde);
  }
}

/** KLN-23: giriş e-postası değişikliği; onay bağlantısı oturum gerektirmez. */
@Controller("auth/eposta")
export class EpostaDegisimiController {
  constructor(private readonly degisim: EpostaDegisimiService) {}

  @IkiAdimKurulumundaAcik()
  @Post("degistir")
  @HttpCode(200)
  degistir(@Body() govde: unknown) {
    return this.degisim.kendiBaslat(govde);
  }

  @Public()
  @Post("onayla")
  @HttpCode(200)
  onayla(@Body() govde: unknown) {
    return this.degisim.onayla(govde);
  }
}
