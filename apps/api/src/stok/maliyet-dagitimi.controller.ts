import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { MaliyetDagitimiService, type DagitimGirdisi } from "./maliyet-dagitimi.service";

const girdiSemasi = z.object({
  kaynakTur: z.enum(["masraf", "fatura_satiri"]),
  kaynakId: z.uuid("Gider seçin"),
  hedefFaturaIdler: z.array(z.uuid()).min(1, "En az bir alış faturası seçin").max(100),
  yontem: z.enum(["tutar", "miktar"]),
  aciklama: z.string().max(500).nullish(),
});
const girdi = (v: unknown): DagitimGirdisi => {
  const s = girdiSemasi.safeParse(v ?? {});
  if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
  return s.data;
};

/** STK-40: giderin (masraf / alış hizmet satırı) alış faturalarının stok maliyetine dağıtılması. */
@Controller("stok/maliyet-dagitimi")
@Roller("muhasebe")
export class MaliyetDagitimiController {
  constructor(private readonly servis: MaliyetDagitimiService) {}

  @Get()
  listele() { return this.servis.listele(); }

  @Get("adaylar")
  adaylar() { return this.servis.adaylar(); }

  @Post("onizle")
  onizle(@Body() govde: unknown) { return this.servis.onizle(girdi(govde)); }

  @Post()
  olustur(@Body() govde: unknown) { return this.servis.olustur(girdi(govde)); }

  @Post(":id/geri-al")
  geriAl(@Param("id", ParseUUIDPipe) id: string) { return this.servis.geriAl(id); }
}
