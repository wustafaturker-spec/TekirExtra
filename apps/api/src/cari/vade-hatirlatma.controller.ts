import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { VadeHatirlatmaService } from "./vade-hatirlatma.service";
import { TahsilatRiskiService } from "./tahsilat-riski";

const kademe = z.enum(["hatirlatma", "ihtar"]);
const onizlemeSemasi = z.object({ cariId: z.string().uuid(), kademe, not: z.string().max(1000).optional().nullable() });
const gonderimSemasi = z.object({
  cariIdler: z.array(z.string().uuid()).min(1, "En az bir cari seçin").max(200, "Tek seferde en çok 200 cariye gönderilir"),
  kademe,
  not: z.string().max(1000).optional().nullable(),
  siklikSiniriniAs: z.boolean().optional(),
  /** KSB-23: faturaya bağlanmamış tahsilatı olan cariye de gönder. */
  baglanmamisOnayi: z.boolean().optional(),
});

const ayristir = <T>(sema: z.ZodType<T>, govde: unknown): T => {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
  return sonuc.data;
};

/** CARI-38: vadesi geçmiş alacak için hatırlatma / ihtar e-postası. */
@Controller("cari/vade-hatirlatma")
export class VadeHatirlatmaController {
  constructor(
    private readonly servis: VadeHatirlatmaService,
    private readonly risk: TahsilatRiskiService,
  ) {}

  /** AI-20: ek not için yapay zekâ taslağı (gönderim ayrı ve onaylı). */
  @Post("ai-not")
  @Roller("muhasebe", "satis")
  yapayZekaNotu(@Body() govde: unknown) {
    return this.servis.yapayZekaNotu(ayristir(z.object({ cariIdler: z.array(z.string().uuid()).min(1).max(200), kademe }), govde));
  }

  /** AI-18: "bugün kimi aramalı" — vadesi geçmiş/7 gün içinde dolacak alacaklar, öncelik puanıyla. */
  @Get("oncelikler")
  @Roller("muhasebe", "satis")
  oncelikler(@Query("adet") adet?: string) {
    const n = Number(adet ?? 50);
    return this.risk.oncelikler(Number.isInteger(n) && n > 0 && n <= 500 ? n : 50);
  }

  /** AI-17: carinin gecikme riski ve açık faturalarının beklenen ödeme tarihleri. */
  @Get("risk/:cariId")
  @Roller("muhasebe", "satis")
  cariRiski(@Param("cariId", ParseUUIDPipe) cariId: string) {
    return this.risk.cariRiski(cariId);
  }

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
