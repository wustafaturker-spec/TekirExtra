import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { IsKutusuKapanisService } from "./is-kutusu-kapanis.service";
import { kapatSemasi } from "./is-kutusu.kurallari";
import { IsKutusuService, type Kapsam } from "./is-kutusu.service";

const kapsamCoz = (kapsam?: string): Kapsam => {
  if (kapsam !== undefined && kapsam !== "bana" && kapsam !== "firma") throw new BadRequestException("Kapsam bana ya da firma olmalı");
  return (kapsam as Kapsam | undefined) ?? "bana";
};
const uuidMu = (x: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);

/** AI-48…51, AI-66…70: teklif iş kutusu (yönetici, muhasebe, satış). */
@Controller("is-kutusu")
@Roller("muhasebe", "satis")
export class IsKutusuController {
  constructor(private readonly service: IsKutusuService, private readonly kapanislar: IsKutusuKapanisService) {}

  @Get()
  listele(@Query("kapsam") kapsam?: string) {
    return this.service.listele(kapsamCoz(kapsam));
  }

  @Get("sayac")
  sayac() { return this.service.sayac(); }

  @Post("kapat")
  kapat(@Body() govde: unknown) {
    const s = kapatSemasi.safeParse(govde ?? {});
    if (!s.success) throw new BadRequestException(s.error.issues[0]?.message ?? "Geçersiz istek");
    return this.kapanislar.kapat(s.data);
  }

  @Get("kapatilanlar")
  kapatilanlar(@Query("kapsam") kapsam?: string) {
    return this.kapanislar.kapatilanlar(kapsamCoz(kapsam));
  }

  @Post("kapatilanlar/:id/geri-al")
  geriAl(@Param("id", ParseUUIDPipe) id: string) {
    return this.kapanislar.geriAl(id);
  }

  @Get("teklif-adaylari")
  teklifAdaylari(@Query("cariId") cariId?: string, @Query("arama") arama?: string, @Query("haric") haric?: string) {
    if ((cariId && !uuidMu(cariId)) || (haric && !uuidMu(haric))) throw new BadRequestException("Geçersiz kimlik");
    return this.kapanislar.teklifAdaylari({ cariId, arama: arama?.slice(0, 100), haric });
  }
}
