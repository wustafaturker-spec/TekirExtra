import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { REFRESH_COOKIE } from "../auth/auth.controller";
import { Public } from "../auth/public.decorator";
import { ParolaService } from "./parola.service";

/**
 * Parola uçları (KLN-11, KLN-12). `/auth` altında durur: yenileme çerezi
 * yalnız bu yolda gönderildiğinden değiştirme bu oturumu açık tutabilir.
 */
@Controller("auth/parola")
export class ParolaController {
  constructor(private readonly parola: ParolaService) {}

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
  @Post("sifirla")
  @HttpCode(200)
  sifirla(@Body() govde: unknown) {
    return this.parola.sifirla(govde);
  }
}
