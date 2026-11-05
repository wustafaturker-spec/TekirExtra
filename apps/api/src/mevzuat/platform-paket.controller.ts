import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { PlatformUcu } from "../auth/public.decorator";
import { PlatformPaketService } from "./platform-paket.service";
import { paketFiyatSemasi } from "./platform-paket-fiyat";
import { paketKapsamSemasi } from "@tekirextra/shared";

export const paketIcerikSemasi = z.object({
  ad: z.string().trim().min(1).max(100), aciklama: z.string().trim().max(2000),
  ozellikler: z.array(z.string().trim().min(1).max(200)).max(30),
  siralama: z.number().int().min(0).max(10000),
  fiyatlandirma: paketFiyatSemasi.nullable().optional(),
  kapsamSozlesmesi: paketKapsamSemasi.nullable().optional(),
  denemeGunSayisi: z.number().int().min(0).max(365).optional(),
}).strict();
export const paketOlusturSemasi = paketIcerikSemasi.extend({ kod: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).refine((s) => s !== "v1", "v1 mevcut Profesyonel paketinin eski kodudur.") });
const kilitSemasi = z.object({ kilitSurumu: z.number().int().min(1) }).strict();
const taslakSemasi = z.object({ kaynakSurumId: z.uuid() }).strict();
const sayfa = z.coerce.number().int().min(1).max(100000).default(1);
const listeSemasi = z.object({ arama: z.string().trim().max(100).default(""), sayfa }).strict();
const etkiSemasi = z.object({ surumId: z.uuid(), sayfa }).strict();
const atamaSemasi = z.object({ surumId: z.uuid(), tenantIds: z.array(z.uuid()).min(1).max(25).refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, "Firmalar tekrar edemez."),
  uygulamaTarihi: z.iso.date().refine((g) => !g.startsWith("0000-")).nullable(), neden: z.string().trim().min(5).max(1000),
  uygulamaTuru: z.enum(["bugun", "tarih", "donem_sonu"]).optional(),
  atamaKapsami: z.enum(["fiyat", "kapsam"]).optional(),
}).strict().superRefine((g, c) => {
  if (g.uygulamaTuru === "donem_sonu" ? g.uygulamaTarihi !== null || g.tenantIds.length !== 1 : g.uygulamaTarihi === null) c.addIssue({ code: "custom", message: "Tarih seçin; dönem sonunda uygulama için tek firma ve boş tarih gerekir." });
});
const atamaOnaySemasi = z.object({ onizlemeId: z.uuid() }).strict();
const planListeSemasi = z.object({ surumId: z.uuid().optional(), sayfa }).strict();
const iptalSemasi = z.object({ neden: z.string().trim().min(5).max(1000) }).strict();
export const paketSatisSemasi = z.object({
  acik: z.boolean(), surumId: z.uuid().nullable(), kilitSurumu: z.number().int().min(1),
  surumKilitSurumu: z.number().int().min(1).nullable(), neden: z.string().trim().min(5).max(1000),
}).strict().superRefine((g, c) => {
  if (g.acik ? g.surumId === null || g.surumKilitSurumu === null : g.surumId !== null || g.surumKilitSurumu !== null)
    c.addIssue({ code: "custom", message: "Satışı açarken hedef sürüm ve revizyon seçin; durdururken hedef göndermeyin." });
});
function coz<T>(sema: z.ZodType<T>, veri: unknown): T {
  const r = sema.safeParse(veri);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join("; "));
  return r.data;
}
@PlatformUcu()
@Controller("platform/paketler")
export class PlatformPaketController {
  constructor(private readonly paket: PlatformPaketService) {}
  @Get() listele(@Query() q: unknown) { return this.paket.listele(coz(listeSemasi, q)); }
  @Post() olustur(@Body() g: unknown) { return this.paket.olustur(coz(paketOlusturSemasi, g)); }
  @Get("gecis-durumu") gecisDurumu(@Query("sayfa") p?: string) { return this.paket.gecisDurumu(coz(sayfa, p)); }
  @Get("fiyat-etkisi") fiyatEtkisi(@Query() q: unknown) {
    const g = coz(etkiSemasi, q);
    return this.paket.fiyatEtkisi(g.surumId, g.sayfa);
  }
  @Get("planli-atamalar") planliAtamalar(@Query() q: unknown) { return this.paket.planliAtamalar(coz(planListeSemasi, q)); }
  @Get(":id") getir(@Param("id", ParseUUIDPipe) id: string, @Query("sayfa") p?: string) { return this.paket.getir(id, coz(sayfa, p)); }
  @Get(":id/satis") satisGetir(@Param("id", ParseUUIDPipe) id: string, @Query("sayfa") p?: string) { return this.paket.satisGetir(id, coz(sayfa, p)); }
  @Post(":id/satis") satisDegistir(@Param("id", ParseUUIDPipe) id: string, @Body() g: unknown) { return this.paket.satisDegistir(id, coz(paketSatisSemasi, g)); }
  @Post("atama-onizle") atamaOnizle(@Body() g: unknown) { return this.paket.atamaOnizle(coz(atamaSemasi, g)); }
  @Post("atama-uygula") atamaUygula(@Body() g: unknown) { return this.paket.atamaUygula(coz(atamaOnaySemasi, g).onizlemeId); }
  @Post("planli-atamalar/:id/iptal") planIptal(@Param("id", ParseUUIDPipe) id: string, @Body() g: unknown) { return this.paket.planIptal(id, coz(iptalSemasi, g).neden); }
  @Post(":id/taslak") taslak(@Param("id", ParseUUIDPipe) id: string, @Body() g: unknown) { return this.paket.taslakAc(id, coz(taslakSemasi, g).kaynakSurumId); }
  @Patch(":id/surumler/:surumId") guncelle(@Param("id", ParseUUIDPipe) id: string, @Param("surumId", ParseUUIDPipe) surumId: string, @Body() g: unknown) {
    return this.paket.guncelle(id, surumId, coz(paketIcerikSemasi.extend(kilitSemasi.shape), g));
  }
  @Post(":id/surumler/:surumId/yayinla") yayinla(@Param("id", ParseUUIDPipe) id: string, @Param("surumId", ParseUUIDPipe) surumId: string, @Body() g: unknown) {
    return this.paket.yayinla(id, surumId, coz(kilitSemasi, g).kilitSurumu);
  }
  @Post(":id/surumler/:surumId/arsivle") arsivle(@Param("id", ParseUUIDPipe) id: string, @Param("surumId", ParseUUIDPipe) surumId: string, @Body() g: unknown) {
    return this.paket.arsivle(id, surumId, coz(kilitSemasi, g).kilitSurumu);
  }
}
