import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PlatformRolleri, PlatformUcu } from "../auth/public.decorator";
import { PlatformPrismaService } from "./platform-prisma.service";

const girdiSemasi = z.object({ kod: z.string().regex(/^\d{5}$/, "Vergi dairesi kodu 5 haneli olmalıdır"), ilKodu: z.string().regex(/^\d{2}$/), il: z.string().trim().min(2).max(80), ilce: z.string().trim().min(2).max(80), ad: z.string().trim().min(2).max(160) }).strict();
const ayristir = (v: unknown) => { const r = girdiSemasi.safeParse(v); if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join("; ")); return r.data; };

@PlatformUcu()
@PlatformRolleri("yonetici")
@Controller("platform/vergi-daireleri")
export class PlatformVergiDaireleriController {
  constructor(private readonly platform: PlatformPrismaService) {}
  @Get() listele() { return this.platform.db.vergiDairesi.findMany({ orderBy: [{ ilKodu: "asc" }, { ilce: "asc" }, { ad: "asc" }] }); }
  @Post() async kaydet(@Body() govde: unknown) { const g = ayristir(govde); return this.platform.db.vergiDairesi.upsert({ where: { kod: g.kod }, create: g, update: { ilKodu: g.ilKodu, il: g.il, ilce: g.ilce, ad: g.ad } }); }
  @Post("ice-aktar") async iceAktar(@Body() govde: unknown) {
    const r = z.array(girdiSemasi).min(1).max(2000).safeParse(govde);
    if (!r.success) throw new BadRequestException(r.error.issues.slice(0, 10).map((i) => i.message).join("; "));
    if (new Set(r.data.map((x) => x.kod)).size !== r.data.length) throw new BadRequestException("İçe aktarma dosyasında tekrar eden vergi dairesi kodu var");
    const values = r.data.map((g) => Prisma.sql`(${g.kod}, ${g.ilKodu}, ${g.il}, ${g.ilce}, ${g.ad}, true)`);
    await this.platform.db.$executeRaw(Prisma.sql`
      INSERT INTO vergi_daireleri (kod, il_kodu, il, ilce, ad, aktif)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (kod) DO UPDATE SET il_kodu = EXCLUDED.il_kodu, il = EXCLUDED.il,
        ilce = EXCLUDED.ilce, ad = EXCLUDED.ad, aktif = true`);
    return { kaydedilen: r.data.length };
  }
  @Patch(":kod") async etkinlik(@Param("kod") kod: string, @Body() govde: unknown) {
    const r = z.object({ aktif: z.boolean() }).safeParse(govde); if (!r.success) throw new BadRequestException("aktif alanı zorunludur");
    return this.platform.db.vergiDairesi.update({ where: { kod }, data: { aktif: r.data.aktif } });
  }
}
