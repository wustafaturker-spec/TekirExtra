import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { StokMaliyetService } from "./stok-maliyet.service";

const kapsamSemasi = z.object({ stokId: z.string().uuid().optional() });
const kapsam = (v: unknown) => {
  const s = kapsamSemasi.safeParse(v ?? {});
  if (!s.success) throw new BadRequestException("Geçersiz stok kartı");
  return s.data.stokId;
};

/** STK-28: maliyeti yeniden hesapla (yalnız yönetici); önce önizleme, sonra uygulama. */
@Controller("stok/maliyet")
@Roller("yonetici")
export class StokMaliyetController {
  constructor(private readonly servis: StokMaliyetService) {}

  @Get("yeniden-hesapla")
  onizle(@Query() q: unknown) { return this.servis.onizle(kapsam(q)); }

  @Post("yeniden-hesapla")
  uygula(@Body() govde: unknown) { return this.servis.uygula(kapsam(govde)); }
}
