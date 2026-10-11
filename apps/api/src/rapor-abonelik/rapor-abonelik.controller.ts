import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { DONEMLER, SIKLIKLAR } from "../core/raporlar/rapor-abonelik-zaman";
import { RaporAbonelikService, type AbonelikGirdisi } from "./rapor-abonelik.service";

const abonelikSemasi = z.object({
  gorunumId: z.string().uuid(),
  siklik: z.enum(SIKLIKLAR as [string, ...string[]]),
  gun: z.number().int().nullable().default(null),
  saat: z.string(),
  donem: z.enum(DONEMLER as [string, ...string[]]),
  bicim: z.enum(["excel", "pdf", "ikisi"]),
  bosGonder: z.boolean().default(false),
  aliciIdler: z.array(z.string().uuid()).max(50),
});

function ayristir(govde: unknown): AbonelikGirdisi {
  const sonuc = abonelikSemasi.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => `${s.path.join(".")}: ${s.message}`).join("; "));
  return sonuc.data as AbonelikGirdisi;
}

/**
 * RPR-24: zamanlanmış rapor aboneliği. Rol denetimi serviste raporun kendi
 * rolüyle yapılır (kayıtlı görünüm uçlarıyla aynı); burada ayrıca @Roller yok.
 */
@Controller("rapor-abonelikleri")
export class RaporAbonelikController {
  constructor(private readonly servis: RaporAbonelikService) {}

  @Get()
  listele() { return this.servis.listele(); }

  @Get("alici-adaylari")
  aliciAdaylari(@Query("rapor") rapor: string) { return this.servis.aliciAdaylari(rapor); }

  @Post()
  olustur(@Body() govde: unknown) { return this.servis.olustur(ayristir(govde)); }

  @Put(":id")
  guncelle(@Param("id") id: string, @Body() govde: unknown) { return this.servis.guncelle(id, ayristir(govde)); }

  @Post(":id/duraklat")
  duraklat(@Param("id") id: string) { return this.servis.aktiflikDegistir(id, false); }

  @Post(":id/devam")
  devam(@Param("id") id: string) { return this.servis.aktiflikDegistir(id, true); }

  @Post(":id/simdi-gonder")
  simdiGonder(@Param("id") id: string) { return this.servis.simdiGonder(id); }

  @Delete(":id")
  @HttpCode(204)
  async sil(@Param("id") id: string) { await this.servis.sil(id); }
}
