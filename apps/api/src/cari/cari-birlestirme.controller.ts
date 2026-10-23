import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { CariBirlestirmeService } from "./cari-birlestirme.service";

const kimlik = z.uuid("Geçersiz cari");
const istisnaSemasi = z.object({ cariIdler: z.array(kimlik).min(2, "En az iki cari seçin").max(20) });
const birlestirmeSemasi = z.object({ anaCariId: kimlik, tasinanCariIdler: z.array(kimlik).min(1, "Taşınacak cari seçin").max(20) });

const ayristir = <T>(sema: z.ZodType<T>, govde: unknown): T => {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
  return sonuc.data;
};

/** CARI-56…62: mükerrer cari raporu ve birleştirme. Rapor muhasebeye açık, değişiklik yalnız yöneticide. */
@Controller("cari/mukerrer")
export class CariBirlestirmeController {
  constructor(private readonly servis: CariBirlestirmeService) {}

  @Get()
  @Roller("muhasebe")
  rapor() {
    return this.servis.rapor();
  }

  @Get("istisnalar")
  @Roller("muhasebe")
  istisnalar() {
    return this.servis.istisnalar();
  }

  @Post("istisnalar")
  @Roller("yonetici")
  istisnaEkle(@Body() govde: unknown) {
    return this.servis.istisnaEkle(ayristir(istisnaSemasi, govde).cariIdler);
  }

  @Delete("istisnalar/:id")
  @Roller("yonetici")
  istisnaKaldir(@Param("id", ParseUUIDPipe) id: string) {
    return this.servis.istisnaKaldir(id);
  }

  /** Salt okuma: GET, ki tekrar anahtarı eski önizlemeyi geri vermesin. `tasinan` virgülle ayrılır. */
  @Get("onizleme")
  @Roller("yonetici")
  onizleme(@Query("ana") ana?: string, @Query("tasinan") tasinan?: string) {
    const g = ayristir(birlestirmeSemasi, { anaCariId: ana, tasinanCariIdler: (tasinan ?? "").split(",").filter(Boolean) });
    return this.servis.onizleme(g.anaCariId, g.tasinanCariIdler);
  }

  @Post("birlestir")
  @Roller("yonetici")
  birlestir(@Body() govde: unknown) {
    const g = ayristir(birlestirmeSemasi, govde);
    return this.servis.birlestir(g.anaCariId, g.tasinanCariIdler);
  }
}
