import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { PlatformRolleri, PlatformUcu } from "../auth/public.decorator";
import { PlatformGorevService } from "./platform-gorev.service";

const sonTarih = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !v.startsWith("0000") && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "Son tarih geçerli bir takvim tarihi olmalı.").nullable();
const alanlar = z.object({
  baslik: z.string().trim().min(3, "Başlık en az 3 karakter olmalı.").max(200),
  aciklama: z.string().trim().max(4000).nullable(),
  oncelik: z.enum(["dusuk", "normal", "yuksek"]),
  sonTarih, sorumluId: z.uuid().nullable(), degisiklikId: z.uuid().nullable(),
});
export const gorevOlusturmaSemasi = alanlar.extend({ kapsam: z.enum(["mevzuat", "platform"]) }).strict();
export const gorevGuncellemeSemasi = alanlar.partial().extend({ surum: z.number().int().positive(), durum: z.enum(["acik", "devam_ediyor", "tamamlandi", "iptal"]).optional() }).strict().refine((v) => Object.keys(v).some((k) => k !== "surum"), "Değiştirilecek en az bir alan gönderin.");
const filtre = z.object({
  durum: z.enum(["hepsi", "acik_isler", "acik", "devam_ediyor", "tamamlandi", "iptal"]).default("acik_isler"),
  arama: z.string().trim().max(200).default(""),
  benim: z.enum(["0", "1"]).default("0").transform((v) => v === "1"),
  geciken: z.enum(["0", "1"]).default("0").transform((v) => v === "1"),
  sayfa: z.coerce.number().int().min(1).max(100000).default(1),
});
function ayristir<T>(sema: z.ZodType<T>, veri: unknown): T {
  const s = sema.safeParse(veri);
  if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
  return s.data;
}

@PlatformUcu()
@PlatformRolleri("yonetici", "mevzuat_editoru")
@Controller("platform/gorevler")
export class PlatformGorevController {
  constructor(private readonly gorevler: PlatformGorevService) {}
  @Get() listele(@Query() sorgu: unknown) { return this.gorevler.listele(ayristir(filtre, sorgu)); }
  @Get("katilimcilar") katilimcilar() { return this.gorevler.katilimcilar(); }
  @Get(":id") getir(@Param("id", ParseUUIDPipe) id: string) { return this.gorevler.getir(id); }
  @Post() olustur(@Body() govde: unknown) { return this.gorevler.olustur(ayristir(gorevOlusturmaSemasi, govde)); }
  @Patch(":id") guncelle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) { return this.gorevler.guncelle(id, ayristir(gorevGuncellemeSemasi, govde)); }
}
