import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { VadeHatirlatmaService } from "./vade-hatirlatma.service";

const kademe = z.enum(["hatirlatma", "ihtar"]);
const onizlemeSemasi = z.object({ cariId: z.string().uuid(), kademe, not: z.string().max(1000).optional().nullable() });
const gonderimSemasi = z.object({
  cariIdler: z.array(z.string().uuid()).min(1, "En az bir cari seçin").max(200, "Tek seferde en çok 200 cariye gönderilir"),
  kademe,
  not: z.string().max(1000).optional().nullable(),
  siklikSiniriniAs: z.boolean().optional(),
});

const ayristir = <T>(sema: z.ZodType<T>, govde: unknown): T => {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
  return sonuc.data;
};

/** CARI-38: vadesi geçmiş alacak için hatırlatma / ihtar e-postası. */
@Controller("cari/vade-hatirlatma")
export class VadeHatirlatmaController {
  constructor(private readonly servis: VadeHatirlatmaService) {}

  @Get("adaylar")
  @Roller("muhasebe", "satis")
  adaylar() {
    return this.servis.adaylar();
  }

  @Post("onizle")
  @Roller("muhasebe", "satis")
  onizle(@Body() govde: unknown) {
    const g = ayristir(onizlemeSemasi, govde);
    return this.servis.onizle(g.cariId, g.kademe, g.not);
  }

  @Post("gonder")
  @Roller("muhasebe")
  gonder(@Body() govde: unknown) {
    return this.servis.gonder(ayristir(gonderimSemasi, govde));
  }
}
